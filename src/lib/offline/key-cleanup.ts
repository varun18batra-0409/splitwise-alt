import { db } from "../db";
import { OFFLINE_KEY_KEEP_DAYS, OFFLINE_KEY_PREFIX } from "./words";

// The daily clean-up of one-time keys. An ordinary key is only needed for a retry, so it goes after 30 days. An expense added offline
// ("off-" keys) can be sent weeks late; if its key were gone it could be saved a second time, so those are kept 400 days.
const DAY = 86_400_000;

export async function cleanOldKeys(now = new Date()): Promise<{ ordinary: number; offline: number }> {
  const ordinary = await db.requestKey.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * DAY) }, NOT: [{ key: { startsWith: OFFLINE_KEY_PREFIX } }, { key: { startsWith: "bill-replaced:" } }, { key: { startsWith: "home-cleared:" } }] } }); // (these two are lasting facts, not retry keys)
  const offline = await db.requestKey.deleteMany({ where: { key: { startsWith: OFFLINE_KEY_PREFIX }, createdAt: { lt: new Date(now.getTime() - OFFLINE_KEY_KEEP_DAYS * DAY) } } });
  return { ordinary: ordinary.count, offline: offline.count };
}
