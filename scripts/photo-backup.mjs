// Weekly copy of the photo store.
//
// Loopin keeps photos (group covers, postcards, receipts, moments) as files in a private Vercel Blob store; the database only holds
// each photo's file name ("blobKey"). A database backup alone therefore cannot bring the photos back. This copies every file the
// database points to into a SECOND Blob store, then opens a sample of the copies to prove they work (the photo restore drill).
//
//   node scripts/photo-backup.mjs
//
// Needs (the workflow passes them only to this step), and does nothing, clearly, until all five exist:
//   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN      the live database and a READ-ONLY key for it (only reads)
//   LIVE_BLOB_READ_WRITE_TOKEN                the live photo store (only read from: files are fetched, never changed)
//   BACKUP_BLOB_READ_WRITE_TOKEN              the second, separate photo store (written to)
// Files are named by a random id and never change once saved, so a file already in the copy is skipped. Nothing is ever deleted
// from the copy (a photo removed in the app stays in the copy until you clear the second store yourself).
// Only counts and the first characters of file names are printed. No keys, no addresses, no photo contents.

import { pathToFileURL } from "node:url";

export const REQUIRED = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "LIVE_BLOB_READ_WRITE_TOKEN", "BACKUP_BLOB_READ_WRITE_TOKEN"];
export const SAMPLE_SIZE = 20;
export const FOLDERS = ["group", "postcard", "receipt", "moment"];

/** Names of the settings that are missing (empty counts as missing). */
export const missingSettings = (env) => REQUIRED.filter((k) => !String(env[k] ?? "").trim());

/** One file name per line of the database's references: every non-empty key, once. */
export const uniqueKeys = (lists) => [...new Set(lists.flat().filter((k) => typeof k === "string" && k.trim() !== ""))].sort();

/** What still has to be copied: the referenced files that are not yet in the copy. */
export const toCopy = (referenced, inCopy) => referenced.filter((k) => !inCopy.has(k));

/** A sample of up to `n` names, chosen with `rand` (0..1) so a test can fix it. */
export function pickSample(keys, n = SAMPLE_SIZE, rand = Math.random) {
  const pool = [...keys];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

/** A name safe to print: the folder and the first 6 characters of the id. */
export const shortName = (k) => {
  const [folder, ...rest] = String(k).split("/");
  return `${folder}/${rest.join("/").slice(0, 6)}…`;
};

/**
 * The whole job, with its five actions handed in (so a test can run it without a network):
 *  referencedKeys() -> string[]            every file name the database points to
 *  listCopy() -> Map<name, size>           what the second store already holds
 *  readLive(name) -> { bytes, type }|null  the file from the live store (null = it is not there)
 *  writeCopy(name, bytes, type)            save it in the second store
 *  readCopy(name) -> { size }|null         open it from the second store (null = it does not open)
 */
export async function runPhotoBackup(deps, opts = {}) {
  const log = opts.log ?? (() => undefined);
  const referenced = uniqueKeys([await deps.referencedKeys()]);
  const inCopy = await deps.listCopy();
  const todo = toCopy(referenced, new Set(inCopy.keys()));
  const result = { referenced: referenced.length, alreadyThere: referenced.length - todo.length, copied: 0, missingInLive: [], failed: [], sampleChecked: 0, sampleFailed: [] };
  const gone = new Set();
  const queue = [...todo];
  const worker = async () => {
    for (let k = queue.shift(); k !== undefined; k = queue.shift()) {
      try {
        const file = await deps.readLive(k);
        if (!file) {
          result.missingInLive.push(k); // the database points to a file the live store does not have: needs a look
          gone.add(k);
          continue;
        }
        await deps.writeCopy(k, file.bytes, file.type);
        result.copied++;
      } catch {
        result.failed.push(k);
      }
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, worker));
  log(`${result.referenced} files are referenced; ${result.alreadyThere} were already copied, ${result.copied} copied now.`);

  // The photo restore drill: open a sample of the copies (not the ones the live store never had) and check each is a real, non-empty file.
  const sample = pickSample(referenced.filter((k) => !gone.has(k) && !result.failed.includes(k)), opts.sampleSize ?? SAMPLE_SIZE, opts.rand ?? Math.random);
  for (const k of sample) {
    let ok = false;
    try {
      const f = await deps.readCopy(k);
      ok = Boolean(f && f.size > 0);
    } catch {
      ok = false;
    }
    result.sampleChecked++;
    if (!ok) result.sampleFailed.push(k);
  }
  log(`Restore drill: ${result.sampleChecked - result.sampleFailed.length} of ${result.sampleChecked} sampled copies open.`);
  result.ok = result.failed.length === 0 && result.missingInLive.length === 0 && result.sampleFailed.length === 0;
  return result;
}

// ---------- the real actions (only used when run from the command line) ----------
async function realDeps(env) {
  const { createClient } = await import("@libsql/client");
  const blob = await import("@vercel/blob");
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const live = { token: env.LIVE_BLOB_READ_WRITE_TOKEN };
  const copy = { token: env.BACKUP_BLOB_READ_WRITE_TOKEN };
  const col = async (sql) => (await db.execute(sql)).rows.map((r) => r[0]);
  return {
    async referencedKeys() {
      const lists = [];
      for (const [table, c] of [["GroupPhoto", "blobKey"], ["Receipt", "blobKey"], ["PostcardPhoto", "blobKey"], ["Moment", "blobKey"], ["Moment", "thumbKey"]]) {
        lists.push(await col(`SELECT "${c}" FROM "${table}" WHERE "${c}" IS NOT NULL AND "${c}" <> ''`));
      }
      return lists.flat();
    },
    async listCopy() {
      const seen = new Map();
      for (const folder of FOLDERS) {
        let cursor;
        do {
          const page = await blob.list({ prefix: `${folder}/`, cursor, limit: 1000, ...copy });
          for (const b of page.blobs) seen.set(b.pathname, b.size);
          cursor = page.hasMore ? page.cursor : undefined;
        } while (cursor);
      }
      return seen;
    },
    async readLive(name) {
      const r = await blob.get(name, { access: "private", ...live });
      if (!r || r.statusCode !== 200 || !r.stream) return null;
      const bytes = Buffer.from(await new Response(r.stream).arrayBuffer());
      return { bytes, type: r.blob?.contentType ?? r.headers?.get?.("content-type") ?? "application/octet-stream" };
    },
    async writeCopy(name, bytes, type) {
      try {
        await blob.put(name, bytes, { access: "private", contentType: type, addRandomSuffix: false, ...copy });
      } catch (e) {
        if (!/already exists/i.test(String(e))) throw e; // a file that is already there is fine
      }
    },
    async readCopy(name) {
      const r = await blob.get(name, { access: "private", ...copy });
      if (!r || r.statusCode !== 200 || !r.stream) return null;
      return { size: (await new Response(r.stream).arrayBuffer()).byteLength };
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const missing = missingSettings(process.env);
  if (missing.length) {
    console.log(`Photo backup is not set up yet, so nothing was done. Missing settings: ${missing.join(", ")}. See ops/photo-backup/README.md.`);
    process.exit(0);
  }
  const r = await runPhotoBackup(await realDeps(process.env), { log: (s) => console.log(s) });
  for (const k of r.missingInLive.slice(0, 20)) console.log(`✗ the database points to ${shortName(k)} but the live store does not have it`);
  for (const k of r.failed.slice(0, 20)) console.log(`✗ could not copy ${shortName(k)}`);
  for (const k of r.sampleFailed.slice(0, 20)) console.log(`✗ the copy of ${shortName(k)} does not open`);
  if (!r.ok) {
    console.log("Photo backup finished with problems (listed above).");
    process.exit(1);
  }
  console.log("Photo backup finished: every referenced photo is copied, and the sample opens.");
}
