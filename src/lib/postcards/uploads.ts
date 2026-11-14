import { db } from "@/lib/db";

// Photos a person uploaded for their own postcards, so they can use one again. Only the uploader ever sees or reuses one:
// both functions below look at what THIS account sent, and the photo row's owner (accountId, "" for photos from before owners were kept).

const PHOTO_ID = /^[A-Za-z0-9_-]{6,40}$/;

export type MyUpload = { id: string; url: string; label: string };

// The last few different photos this account put on cards it sent, newest first (up to `take`).
export async function myPostcardUploads(accountId: string, take = 8): Promise<MyUpload[]> {
  if (!accountId) return [];
  const cards = await db.postcard.findMany({
    where: { fromId: accountId, front: "own", photoId: { not: "" } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { photoId: true, place: true, words: true },
  });
  const seen = new Map<string, { place: string; words: string }>();
  for (const c of cards) if (!seen.has(c.photoId)) seen.set(c.photoId, { place: c.place, words: c.words });
  if (!seen.size) return [];
  const mine = new Set(
    (await db.postcardPhoto.findMany({ where: { id: { in: [...seen.keys()] }, accountId: { in: [accountId, ""] } }, select: { id: true } })).map((p) => p.id),
  );
  return [...seen.entries()]
    .filter(([id]) => mine.has(id))
    .slice(0, take)
    .map(([id, c]) => ({ id, url: `/api/postcard-photo/${id}`, label: `Your upload: ${c.place || c.words || "photo"}` }));
}

// May this account put this stored photo on a new card? Only if they sent a card with it AND the photo is theirs (or from before owners were kept).
export async function ownsPostcardPhoto(accountId: string, id: string): Promise<boolean> {
  if (!accountId || !PHOTO_ID.test(id)) return false;
  const [card, photo] = await Promise.all([
    db.postcard.findFirst({ where: { fromId: accountId, photoId: id }, select: { id: true } }),
    db.postcardPhoto.findFirst({ where: { id, accountId: { in: [accountId, ""] } }, select: { id: true } }),
  ]);
  return Boolean(card && photo);
}
