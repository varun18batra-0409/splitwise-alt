// Where user photos live: Vercel Blob (a private store: nothing is reachable
// without Loopin's own access checks) when it's connected, otherwise the
// database as before. Rows keep a `blobKey`; an empty key means the bytes are in
// `data`. If file storage hiccups, the photo is kept in the database instead, so
// an upload never fails because of it.

import type { Prisma } from "@prisma/client";

export const blobOn = () => Boolean(process.env.VERCEL && (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID));

const EMPTY = () => new Uint8Array(new ArrayBuffer(0));

export async function storePhoto(folder: "group" | "postcard" | "receipt", bytes: Uint8Array, type: string): Promise<{ blobKey: string; data: Uint8Array<ArrayBuffer> }> {
  const asDb = () => {
    const data = new Uint8Array(new ArrayBuffer(bytes.length));
    data.set(bytes);
    return { blobKey: "", data };
  };
  if (!blobOn()) return asDb();
  try {
    const { put } = await import("@vercel/blob");
    const key = `${folder}/${crypto.randomUUID()}`;
    await put(key, Buffer.from(bytes), { access: "private", contentType: type, addRandomSuffix: false });
    return { blobKey: key, data: EMPTY() };
  } catch (err) {
    console.error("photo store: kept in the database", String(err).slice(0, 160));
    return asDb();
  }
}

export async function readPhoto(row: { data: Uint8Array; blobKey?: string | null }): Promise<Uint8Array | null> {
  if (!row.blobKey) return row.data.length ? row.data : null;
  try {
    const { get } = await import("@vercel/blob");
    const r = await get(row.blobKey, { access: "private" });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return new Uint8Array(await new Response(r.stream).arrayBuffer());
  } catch (err) {
    console.error("photo store: read failed", String(err).slice(0, 160));
    return null;
  }
}

// ---------- Photos that need deleting ----------
// A photo file is never forgotten until storage confirms it's gone. Wherever
// rows are deleted, their keys are written to BlobTrash in the same step (so a
// crash can't lose them); the daily job (and removePhotos) then deletes the
// files and only then drops the keys. A failed delete is tried again later,
// waiting a little longer each time (2 h, 4 h, 8 h … at most 48 h).

type TrashWriter = Pick<Prisma.TransactionClient, "blobTrash">;
const keysOf = (keys: (string | null | undefined)[]) => [...new Set(keys.filter((k): k is string => Boolean(k)))];

// Write keys to the to-delete list inside the caller's transaction (a key already there is left alone).
export async function queuePhotoDeletes(tx: TrashWriter, keys: (string | null | undefined)[]): Promise<void> {
  for (const key of keysOf(keys)) await tx.blobTrash.upsert({ where: { key }, create: { key }, update: {} });
}

// The same, for callers that use the list form of db.$transaction([...]): add these to the list.
export async function photoTrashOps(keys: (string | null | undefined)[]) {
  const { db } = await import("./db");
  return keysOf(keys).map((key) => db.blobTrash.upsert({ where: { key }, create: { key }, update: {} }));
}

export const TRASH_STUCK_AFTER = 3; // tries after which the daily check mentions it

export const trashDelay = (tries: number) => Math.min(2 ** tries, 48) * 3_600_000;

// (By its name only: a vague message match could mistake a real problem for "already gone".)
const notFound = (err: unknown) => (err as { name?: string })?.name === "BlobNotFoundError";

// Delete what's due from the to-delete list. Keys still used by a photo row are dropped
// from the list without being touched. Never throws. `now` is for tests.
export async function flushPhotoDeletes(limit = 50, now = new Date()): Promise<{ deleted: number; failed: number; kept: number }> {
  const result = { deleted: 0, failed: 0, kept: 0 };
  try {
    if (!blobOn()) return result; // storage not connected: the keys wait
    const { db } = await import("./db");
    const due = await db.blobTrash.findMany({ where: { nextAt: { lte: now } }, orderBy: { nextAt: "asc" }, take: limit });
    if (!due.length) return result;
    const keys = due.map((d) => d.key);
    // A file a photo row still points at must never be deleted.
    const [g, r, p] = await Promise.all([
      db.groupPhoto.findMany({ where: { blobKey: { in: keys } }, select: { blobKey: true } }),
      db.receipt.findMany({ where: { blobKey: { in: keys } }, select: { blobKey: true } }),
      db.postcardPhoto.findMany({ where: { blobKey: { in: keys } }, select: { blobKey: true } }),
    ]);
    const used = new Set([...g, ...r, ...p].map((x) => x.blobKey));
    if (used.size) {
      await db.blobTrash.deleteMany({ where: { key: { in: [...used] } } });
      result.kept = used.size;
    }
    const todo = due.filter((d) => !used.has(d.key));
    if (!todo.length) return result;
    let error = "";
    try {
      const { del } = await import("@vercel/blob");
      await del(todo.map((d) => d.key));
    } catch (err) {
      // "Not found" means it's already gone, which is what we wanted.
      if (!notFound(err)) error = String(err).slice(0, 160);
    }
    if (!error) {
      await db.blobTrash.deleteMany({ where: { key: { in: todo.map((d) => d.key) } } });
      result.deleted = todo.length;
      return result;
    }
    console.error("photo store: delete failed", error);
    for (const d of todo) {
      const tries = d.tries + 1;
      await db.blobTrash.update({ where: { key: d.key }, data: { tries, lastError: error, nextAt: new Date(now.getTime() + trashDelay(tries)) } });
    }
    result.failed = todo.length;
  } catch (err) {
    console.error("photo store: clean-up failed", String(err).slice(0, 160));
  }
  return result;
}

// Photos that couldn't be deleted for a while (for the daily check).
export async function stuckPhotoDeletes(): Promise<number> {
  const { db } = await import("./db");
  return db.blobTrash.count({ where: { tries: { gte: TRASH_STUCK_AFTER } } });
}

// Delete these files: written to the to-delete list first, then tried at once.
export async function removePhotos(keys: (string | null | undefined)[]) {
  const list = keysOf(keys);
  if (!list.length) return;
  try {
    const { db } = await import("./db");
    await queuePhotoDeletes(db, list);
  } catch (err) {
    console.error("photo store: couldn't queue delete", String(err).slice(0, 160));
    return;
  }
  await flushPhotoDeletes();
}

// Put a new photo in a group's picture, only if the picture is still the one we saw (`seen`: its updatedAt, or null
// if there was none). The file to delete is the one the row points at right now, read inside the same step: a move
// of the old photo to file storage may have changed its key since we looked, and that must not leave a file behind.
// Returns false (nothing changed) if someone else's photo got there first.
export async function replaceGroupPhoto(
  groupId: string,
  seen: { updatedAt: Date } | null,
  data: { data: Uint8Array<ArrayBuffer>; blobKey: string; type: string; createdById: string; updatedAt: Date },
  now: Date,
): Promise<boolean> {
  const { db } = await import("./db");
  return db.$transaction(async (tx) => {
    let oldKey = "";
    if (seen) {
      const current = await tx.groupPhoto.findUnique({ where: { groupId }, select: { blobKey: true } });
      oldKey = current?.blobKey ?? "";
      // blobKey: oldKey too, so a move of the old photo to file storage that happened in between can't leave its file behind.
      const r = await tx.groupPhoto.updateMany({ where: { groupId, updatedAt: seen.updatedAt, blobKey: oldKey }, data });
      if (r.count !== 1) return false;
    } else {
      await tx.groupPhoto.create({ data: { groupId, ...data } });
    }
    await tx.group.update({ where: { id: groupId }, data: { cover: "own", coverAt: now } });
    await queuePhotoDeletes(tx, [oldKey]); // the old file, in the same step that replaces it
    return true;
  });
}

// Photos saved before file storage was connected: moved over a few at a time
// by the daily job (the database copy is cleared once the file copy exists).
export async function movePhotosToBlob(limit = 40): Promise<number> {
  if (!blobOn()) return 0;
  const { db } = await import("./db");
  let moved = 0;
  for (const [table, folder] of [["groupPhoto", "group"], ["postcardPhoto", "postcard"], ["receipt", "receipt"]] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (db as any)[table];
    const rows: { data: Uint8Array; type: string; blobKey: string; id?: string; groupId?: string; updatedAt?: Date }[] = await model.findMany({ where: { blobKey: "" }, take: limit });
    for (const r of rows) {
      if (!r.data?.length) continue;
      const s = await storePhoto(folder, r.data, r.type);
      if (!s.blobKey) return moved; // file storage not answering: try again tomorrow
      // Only if the row is still exactly as it was read: a photo uploaded while this
      // one was being copied must not be written over (the group photo's version is updatedAt).
      const where = table === "groupPhoto" ? { groupId: r.groupId, blobKey: "", updatedAt: r.updatedAt } : { id: r.id, blobKey: "" };
      const done: { count: number } = await model.updateMany({ where, data: { blobKey: s.blobKey, data: s.data } });
      if (done.count === 0) {
        await queuePhotoDeletes(db, [s.blobKey]); // the copy nobody needs
        continue;
      }
      moved++;
    }
  }
  return moved;
}
