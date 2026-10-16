import { db } from "./db";

// Fixed-window request counter kept in the database (the hosting runs many
// short-lived copies of the app, so memory alone wouldn't work).
// Returns false when the limit for this window is used up. Each step is a
// single conditional write, so many requests at the same moment can't slip
// past the limit.
export async function allow(key: string, limit: number, windowSeconds: number, now = new Date()): Promise<boolean> {
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);
  try {
    // 1. Count this request if the window is still open and not full.
    const counted = await db.rateLimit.updateMany({ where: { key, resetAt: { gt: now }, count: { lt: limit } }, data: { count: { increment: 1 } } });
    if (counted.count === 1) return true;
    // 2. Start a new window if the old one ended (only one request can win this).
    const restarted = await db.rateLimit.updateMany({ where: { key, resetAt: { lte: now } }, data: { count: 1, resetAt } });
    if (restarted.count === 1) return true;
    // 3. First request ever for this key.
    try {
      await db.rateLimit.create({ data: { key, count: 1, resetAt } });
      return true;
    } catch {
      // Someone else created it at the same moment: try to count against it.
      const again = await db.rateLimit.updateMany({ where: { key, resetAt: { gt: now }, count: { lt: limit } }, data: { count: { increment: 1 } } });
      return again.count === 1;
    }
  } catch {
    return true; // never block people because the counter itself failed
  }
}

// The visitor's network address, as told by the hosting.
export function clientIp(h: { get(name: string): string | null }): string {
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}
