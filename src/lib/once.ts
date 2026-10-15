import { randomUUID } from "node:crypto";
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
export async function claimKey(tx: Prisma.TransactionClient, key: string | undefined, result: string) {
  if (key) await tx.requestKey.create({ data: { key, result } });
}

// What the first request with this key produced, or null if it's new.
export async function previousResult(key: string | undefined): Promise<string | null> {
  if (!key) return null;
  const row = await db.requestKey.findUnique({ where: { key } });
  return row ? row.result : null;
}

export function isDuplicateKey(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "P2002" || /UNIQUE constraint failed: RequestKey/i.test(String(e?.message ?? ""));
}

// The database was busy with another change at the same instant: wait a
// moment and try again (the retry then sees what the other change did).
export function isBusy(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "P2034" || e?.code === "P2028" || /database is locked|SQLITE_BUSY|write conflict|deadlock|Unable to start a transaction/i.test(String(e?.message ?? ""));
}
export async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isBusy(err) || i >= tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 120 * (i + 1)));
    }
  }
}
