import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { allow, clientIp } from "@/lib/rate-limit";
import { MAX_PHOTO_BYTES, photoType } from "@/lib/covers";

// A group's own photo: shown only to people in the group; anyone in it can
// replace it. The phone makes the photo small before sending it.
export const dynamic = "force-dynamic";

async function memberOf(groupId: string) {
  const myId = await getMyMemberId(groupId);
  if (!myId) return null;
  return db.member.findFirst({ where: { id: myId, groupId, leftAt: null, group: { deletedAt: null } }, select: { id: true } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, photo] = await Promise.all([memberOf(id), db.groupPhoto.findUnique({ where: { groupId: id } })]);
  if (!me || !photo) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  // The address carries the photo's version (?v=…), so the phone can keep it for good.
  return new Response(new Uint8Array(photo.data), {
    headers: { "Content-Type": photo.type, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await headers();
  // Only from Loopin's own pages (another site can't send a photo in your name).
  const origin = h.get("origin");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ ok: false, error: "Not allowed." }, { status: 403 });
  const me = await memberOf(id);
  if (!me) return Response.json({ ok: false, error: "Only people in this group can change its photo." }, { status: 403 });
  if (!(await allow(`photo:${clientIp(h)}`, 30, 3600))) return Response.json({ ok: false, error: "Lots of photos from here in the last hour. Try again later." }, { status: 429 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > MAX_PHOTO_BYTES) return Response.json({ ok: false, error: "That photo is too big." }, { status: 413 });
  const type = photoType(bytes);
  if (!type) return Response.json({ ok: false, error: "Pick a photo (JPEG, PNG or WebP)." }, { status: 415 });
  const now = new Date();
  await db.$transaction([
    db.groupPhoto.upsert({
      where: { groupId: id },
      create: { groupId: id, data: bytes, type, createdById: me.id, updatedAt: now },
      update: { data: bytes, type, createdById: me.id, updatedAt: now },
    }),
    db.group.update({ where: { id }, data: { cover: "own", coverAt: now } }),
  ]);
  return Response.json({ ok: true });
}
