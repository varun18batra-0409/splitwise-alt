import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import { db } from "./db";

// Retry-safe saving. Every form that changes money carries a one-time key
// (made when the page is shown). The key is stored in the same transaction as
// the change, so the change happens exactly once even if the request arrives
// twice — at the same moment or minutes apart.

export const newRequestKey = () => randomUUID();

export function cleanKey(raw: unknown): string | undefined {
  const k = String(raw ?? "");
  return /^[A-Za-z0-9-]{16,64}$/.test(k) ? k : undefined;
}

// Inside a transaction: claim the key (throws if it was already used).
// `fingerprint` says what the form was for (see fingerprintOf); "" = not checked.
export async function claimKey(tx: Prisma.TransactionClient, key: string | undefined, result: string, fingerprint = "") {
  if (key) await tx.requestKey.create({ data: { key, result, fingerprint } });
}

// What the first request with this key produced, or null if it's new.
// (No fingerprint check: kept for callers that don't pass one.)
export async function previousResult(key: string | undefined): Promise<string | null> {
  if (!key) return null;
  const row = await db.requestKey.findUnique({ where: { key } });
  return row ? row.result : null;
}

// The Back button can bring back a screen that still holds a key already used by
// an earlier save. So a key counts as "the same request again" only when the
// request is for the same thing (same action, amount and people: its fingerprint)
// AND the key is under 2 minutes old (a retry comes within seconds). Anything
// else is a stale screen: nothing is saved and the person is told to check.
export const KEY_FRESH_MS = 2 * 60_000;
export const STALE_KEY_ERROR = "This screen was out of date, so nothing new was saved. Check the list, and tap again if it’s missing.";

// A short fingerprint of what a request is for. Parts are joined with a separator
// that can't appear inside an id or number, so ("ab","c") and ("a","bc") differ.
export function fingerprintOf(...parts: (string | number | boolean | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((p) => String(p ?? "")).join("\u001f")).digest("hex").slice(0, 24);
}

export type KeyState = { state: "new" } | { state: "done"; result: string } | { state: "stale" };

// Where a key stands for a request with this fingerprint. Without a fingerprint
// (""), or for a key saved without one, this is the old behaviour: used = done.
export async function keyState(key: string | undefined, fingerprint = "", now = new Date()): Promise<KeyState> {
  if (!key) return { state: "new" };
  const row = await db.requestKey.findUnique({ where: { key } });
  if (!row) return { state: "new" };
  if (!fingerprint || !row.fingerprint) return { state: "done", result: row.result };
  if (row.fingerprint === fingerprint && now.getTime() - row.createdAt.getTime() < KEY_FRESH_MS) return { state: "done", result: row.result };
  return { state: "stale" };
}

export function isDuplicateKey(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "P2002" || /UNIQUE constraint failed: RequestKey/i.test(String(e?.message ?? ""));
}

// The database was busy with another change at the same instant: wait a
// moment and try again (the retry then sees what the other change did).
export function isBusy(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "P2034" || e?.code === "P2028" || e?.code === "P1008" || /database is locked|SQLITE_BUSY|write conflict|deadlock|Unable to start a transaction|Socket timeout/i.test(String(e?.message ?? ""));
}
// Within one server, money changes are written one after another (SQLite
// allows one writer at a time; queueing them here avoids two transactions
// waiting on each other). Across servers, busy errors are retried.
let queue: Promise<unknown> = Promise.resolve();
const inside = new AsyncLocalStorage<boolean>();
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  if (inside.getStore()) return fn(); // already in the queue (e.g. undo → delete): run now
  const job = () => inside.run(true, fn);
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

export async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await serial(fn);
    } catch (err) {
      if (!isBusy(err) || i >= tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 120 * (i + 1)));
    }
  }
}
