import { db } from "./db";

// Fixed-window request counter kept in the database (the hosting runs many
// short-lived copies of the app, so memory alone wouldn't work).
// Returns false when the limit for this window is used up. Each step is a
// single conditional write, so many requests at the same moment can't slip
// past the limit.
// `cost`: how many places this request uses (a postcard sent to 20 people costs 20). It is refused, using nothing, when it
// would pass the limit; a cost above the limit can never be allowed.
export async function allow(key: string, limit: number, windowSeconds: number, now = new Date(), cost = 1): Promise<boolean> {
  if (cost > limit) return false;
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);
  try {
    // 1. Count this request if the window is still open and has room for it.
    const counted = await db.rateLimit.updateMany({ where: { key, resetAt: { gt: now }, count: { lte: limit - cost } }, data: { count: { increment: cost } } });
    if (counted.count === 1) return true;
    // 2. Start a new window if the old one ended (only one request can win this).
    const restarted = await db.rateLimit.updateMany({ where: { key, resetAt: { lte: now } }, data: { count: cost, resetAt } });
    if (restarted.count === 1) return true;
    // 3. First request ever for this key.
    try {
      await db.rateLimit.create({ data: { key, count: cost, resetAt } });
      return true;
    } catch {
      // Someone else created it at the same moment: try to count against it.
      const again = await db.rateLimit.updateMany({ where: { key, resetAt: { gt: now }, count: { lte: limit - cost } }, data: { count: { increment: cost } } });
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
