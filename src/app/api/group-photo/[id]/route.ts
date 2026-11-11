import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { allow, clientIp } from "@/lib/rate-limit";
import { MAX_PHOTO_BYTES, photoType } from "@/lib/covers";
import { cleanPhoto } from "@/lib/strip-meta";
import { flushPhotoDeletes, queuePhotoDeletes, readPhoto, removePhotos, storePhoto } from "@/lib/photo-store";

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
  // Who's asking comes first: nothing is read from storage for anyone else.
  // Someone who left still sees the group's picture on its (read-only) pages.
  const myId = await getMyMemberId(id);
  const me = myId ? await db.member.findFirst({ where: { id: myId, groupId: id, group: { deletedAt: null } }, select: { id: true } }) : null;
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (!me) return notFound();
  const photo = await db.groupPhoto.findUnique({ where: { groupId: id } });
  const bytes = photo ? await readPhoto(photo) : null;
  if (!photo || !bytes) return notFound();
  // The address carries the photo's version (?v=…), so the phone can keep it for good.
  return new Response(new Uint8Array(bytes), {
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
  const clean = cleanPhoto(bytes); // no camera details or location
  if (!clean) return Response.json({ ok: false, error: "We couldn’t check that photo for hidden details (like where it was taken). Try another one, or a screenshot of it." }, { status: 415 });
  const now = new Date();
  const old = await db.groupPhoto.findUnique({ where: { groupId: id }, select: { blobKey: true, updatedAt: true } });
  const stored = await storePhoto("group", clean, type);
  const data = { data: stored.data, blobKey: stored.blobKey, type, createdById: me.id, updatedAt: now };
  // Replace only the photo we saw when we started: if someone else uploaded one in the
  // meantime, ours is the one that loses and its file goes on the to-delete list
  // (so two uploads at once can never leave a file behind that nothing points to).
  let replaced = false;
  try {
    replaced = await db.$transaction(async (tx) => {
      if (old) {
        const r = await tx.groupPhoto.updateMany({ where: { groupId: id, updatedAt: old.updatedAt }, data });
        if (r.count !== 1) return false;
      } else {
        await tx.groupPhoto.create({ data: { groupId: id, ...data } });
      }
      await tx.group.update({ where: { id }, data: { cover: "own", coverAt: now } });
      await queuePhotoDeletes(tx, [old?.blobKey]); // the old file, in the same step that replaces it
      return true;
    });
  } catch (err) {
    console.error("group photo: save failed", String(err).slice(0, 160));
  }
  if (!replaced) {
    // Ours wasn't saved (someone else's photo got there first, or the save failed).
    await removePhotos([stored.blobKey]);
    return Response.json({ ok: false, error: "The group photo was just changed by someone else. Have a look, and pick yours again if you still want it." }, { status: 409 });
  }
  await flushPhotoDeletes();
  return Response.json({ ok: true });
}
