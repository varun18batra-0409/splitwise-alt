import { db } from "./db";

// Fixed-window request counter kept in the database (the hosting runs many
// short-lived copies of the app, so memory alone wouldn't work).
// Returns false when the limit for this window is used up.
export async function allow(key: string, limit: number, windowSeconds: number, now = new Date()): Promise<boolean> {
  try {
    const row = await db.rateLimit.findUnique({ where: { key } });
    if (!row || row.resetAt <= now) {
      await db.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, resetAt: new Date(now.getTime() + windowSeconds * 1000) },
        update: { count: 1, resetAt: new Date(now.getTime() + windowSeconds * 1000) },
      });
      return true;
    }
    if (row.count >= limit) return false;
    await db.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
    return true;
  } catch {
    return true; // never block people because the counter failed
  }
}

// The visitor's network address, as told by the hosting.
export function clientIp(h: { get(name: string): string | null }): string {
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}
