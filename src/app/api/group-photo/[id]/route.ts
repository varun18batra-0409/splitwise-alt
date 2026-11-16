import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { allow, clientIp } from "@/lib/rate-limit";
import { MAX_PHOTO_BYTES, photoAfterCut, photoType } from "@/lib/covers";
import { cleanPhoto } from "@/lib/strip-meta";
import { tagMatches } from "@/lib/http-cache";
import { flushPhotoDeletes, readPhoto, removePhotos, replaceGroupPhoto, storePhoto } from "@/lib/photo-store";

// A group's own photo: shown only to people in the group; anyone in it can
// replace it. The phone makes the photo small before sending it.
export const dynamic = "force-dynamic";

async function memberOf(groupId: string) {
  const myId = await getMyMemberId(groupId);
  if (!myId) return null;
  return db.member.findFirst({ where: { id: myId, groupId, leftAt: null, group: { deletedAt: null } }, select: { id: true } });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Who's asking comes first: nothing is read from storage for anyone else.
  // Someone who left still sees the group's picture on its (read-only) pages, as it was on the day they left (below).
  const myId = await getMyMemberId(id);
  const me = myId ? await db.member.findFirst({ where: { id: myId, groupId: id, group: { deletedAt: null } }, select: { id: true, leftAt: true, removedAt: true } }) : null;
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (!me) return notFound();
  // Only the photo's version first (no picture bytes).
  const head = await db.groupPhoto.findUnique({ where: { groupId: id }, select: { updatedAt: true, type: true } });
  if (!head) return notFound();
  // A photo put up after they left (or were removed) is not theirs to see (the pages show the default cover instead, see coverForViewer).
  if (photoAfterCut(head.updatedAt, me)) return notFound();
  const etag = `"g-${id}-${head.updatedAt.getTime()}"`;
  // Access is settled above; only now may "not changed" be said (and still nothing is read from storage).
  if (tagMatches(req.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } });
  }
  const photo = await db.groupPhoto.findUnique({ where: { groupId: id } });
  const bytes = photo ? await readPhoto(photo) : null;
  if (!photo || !bytes) return notFound();
  // Kept on the phone only as "ask first": the check above runs every time, so someone who is removed stops getting it.
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": photo.type, "Cache-Control": "private, no-cache", ETag: `"g-${id}-${photo.updatedAt.getTime()}"`, Vary: "Cookie", "X-Content-Type-Options": "nosniff" },
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
  const old = await db.groupPhoto.findUnique({ where: { groupId: id }, select: { updatedAt: true } });
  const stored = await storePhoto("group", clean, type);
  const data = { data: stored.data, blobKey: stored.blobKey, type, createdById: me.id, updatedAt: now };
  // Replace only the photo we saw when we started: if someone else uploaded one in the
  // meantime, ours is the one that loses and its file goes on the to-delete list
  // (so two uploads at once can never leave a file behind that nothing points to).
  let replaced = false;
  try {
    replaced = await replaceGroupPhoto(id, old ? { updatedAt: old.updatedAt } : null, data, now);
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
