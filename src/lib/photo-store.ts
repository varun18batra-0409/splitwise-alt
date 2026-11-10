// Where user photos live: Vercel Blob (a private store: nothing is reachable
// without Loopin's own access checks) when it's connected, otherwise the
// database as before. Rows keep a `blobKey`; an empty key means the bytes are in
// `data`. If file storage hiccups, the photo is kept in the database instead, so
// an upload never fails because of it.

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

export async function removePhotos(keys: (string | null | undefined)[]) {
  const list = keys.filter((k): k is string => Boolean(k));
  if (!list.length || !blobOn()) return;
  try {
    const { del } = await import("@vercel/blob");
    await del(list);
  } catch (err) {
    console.error("photo store: delete failed", String(err).slice(0, 160));
  }
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
    const rows: { data: Uint8Array; type: string; blobKey: string; id?: string; groupId?: string }[] = await model.findMany({ where: { blobKey: "" }, take: limit });
    for (const r of rows) {
      if (!r.data?.length) continue;
      const s = await storePhoto(folder, r.data, r.type);
      if (!s.blobKey) return moved; // file storage not answering: try again tomorrow
      const where = table === "groupPhoto" ? { groupId: r.groupId } : { id: r.id };
      await model.update({ where, data: { blobKey: s.blobKey, data: s.data } });
      moved++;
    }
  }
  return moved;
}
