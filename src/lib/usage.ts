import { db } from "./db";

// Usage against the free plans, for the owner's Stats page.
// Free-plan limits (checked Oct 2026):
//   Turso Free: 5 GB storage, 500 million rows read / month, 10 million rows written / month.
//   Vercel Hobby: 100 GB data transfer, 1 million function calls, 4 h active CPU / month.
// Both stop serving (no surprise bill) when a limit is hit, so the risk is an
// outage: warn well before (at 70%).
export const LIMITS = {
  tursoStorageBytes: 5 * 1024 ** 3,
  tursoRowsRead: 500_000_000,
  tursoRowsWritten: 10_000_000,
  vercelTransferGB: 100,
  vercelInvocations: 1_000_000,
};

// Pull a number out of the Turso usage answer, wherever it sits.
function findNumber(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === key && typeof v === "number") return v;
    const inner = findNumber(v, key);
    if (inner !== null) return inner;
  }
  return null;
}

// Real figures from Turso, if the owner added a read-only platform token.
export async function tursoUsage(): Promise<{ rowsRead: number | null; rowsWritten: number | null; storage: number | null } | null> {
  const token = process.env.TURSO_PLATFORM_TOKEN;
  const org = process.env.TURSO_ORG;
  if (!token || !org) return null;
  try {
    const r = await fetch(`https://api.turso.tech/v1/organizations/${encodeURIComponent(org)}/usage`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = await r.json();
    return { rowsRead: findNumber(j, "rows_read"), rowsWritten: findNumber(j, "rows_written"), storage: findNumber(j, "storage_bytes") };
  } catch {
    return null;
  }
}

// What we can see from inside the app: database size and rows, and how
// busy the last 30 days were.
export async function appUsage() {
  const size = await db.$queryRawUnsafe<{ page_count: bigint | number }[]>("PRAGMA page_count").catch(() => []);
  const pageSize = await db.$queryRawUnsafe<{ page_size: bigint | number }[]>("PRAGMA page_size").catch(() => []);
  const bytes = size[0] && pageSize[0] ? Number(size[0].page_count) * Number(pageSize[0].page_size) : null;
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [groups, members, expenses, shares, payments, events, events30, errors30] = await Promise.all([
    db.group.count(), db.member.count(), db.expense.count(), db.expenseShare.count(), db.payment.count(), db.groupEvent.count(),
    db.groupEvent.count({ where: { createdAt: { gte: since } } }), db.errorLog.count({ where: { createdAt: { gte: since } } }),
  ]);
  // Each change writes roughly 8 rows (the item, its shares, the history line, counters).
  const writes30 = events30 * 8;
  return { bytes, rows: { groups, members, expenses, shares, payments, events }, events30, writes30, errors30 };
}

export const pct = (used: number | null, limit: number) => (used === null ? null : Math.round((used / limit) * 1000) / 10);
