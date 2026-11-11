import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { allow, clientIp } from "@/lib/rate-limit";
import { photoType } from "@/lib/covers";
import { cleanPhoto } from "@/lib/strip-meta";
import { aiAllowed, readBill } from "@/lib/ai";

// A bill photo while adding an expense: kept (camera details and location
// removed) to attach to the expense when it's saved, and, if asked, read so
// the form fills itself in. Only people in the group.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_RECEIPT_BYTES = 1_500_000;

export async function POST(req: Request) {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ ok: false, error: "Not allowed." }, { status: 403 });
  const url = new URL(req.url);
  const groupId = url.searchParams.get("group") ?? "";
  const myId = /^[A-Za-z0-9_-]{6,40}$/.test(groupId) ? await getMyMemberId(groupId) : null;
  const me = myId ? await db.member.findFirst({ where: { id: myId, groupId, leftAt: null, group: { deletedAt: null } }, select: { id: true, accountId: true } }) : null;
  if (!me) return Response.json({ ok: false, error: "Only people in this group can add a bill photo." }, { status: 403 });
  if (!(await allow(`receipt:${clientIp(h)}`, 60, 3600))) return Response.json({ ok: false, error: "Lots of photos from here in the last hour. Try again later." }, { status: 429 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > MAX_RECEIPT_BYTES) return Response.json({ ok: false, error: "That photo is too big." }, { status: 413 });
  const type = photoType(bytes);
  if (!type) return Response.json({ ok: false, error: "Pick a photo (JPEG, PNG or WebP)." }, { status: 415 });
  const clean = cleanPhoto(bytes);
  if (!clean) return Response.json({ ok: false, error: "We couldn’t check that photo for hidden details (like where it was taken). Try another one, or a screenshot of it." }, { status: 415 });
  const { storePhoto } = await import("@/lib/photo-store");
  const stored = await storePhoto("receipt", clean, type);
  const saved = await db.receipt.create({ data: { groupId, data: stored.data, blobKey: stored.blobKey, type, createdById: me.id }, select: { id: true } });

  if (url.searchParams.get("read") !== "1") return Response.json({ ok: true, id: saved.id });
  const blocked = await aiAllowed(me.accountId ?? me.id);
  if (blocked) return Response.json({ ok: true, id: saved.id, note: blocked });
  const bill = await readBill(clean, type);
  if (!bill) return Response.json({ ok: true, id: saved.id, note: "Couldn’t read that bill. The photo is attached; fill in the rest." });
  return Response.json({ ok: true, id: saved.id, bill });
}
