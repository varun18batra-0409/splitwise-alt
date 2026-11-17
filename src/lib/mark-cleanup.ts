import { db } from "./db";

// Daily tidy-up of the small scrambled notes kept in the settings table (no emails are in them):
//  - "blockfp:" notes (block-marks.ts) are kept 2 years, counted from the day they were made. An older note, or one with no readable day
//    (made before the day was recorded), starts its two years today.
//  - "removed:<groupId>:" notes (removal-marks.ts) go when their group is gone (erasing a group does this too; this catches the rest).
export const BLOCK_NOTE_YEARS = 2;

export async function cleanMarks(now = new Date(), limit = 2000): Promise<{ blocks: number; removed: number }> {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - BLOCK_NOTE_YEARS);
  let blocks = 0;
  const blockRows = await db.appSetting.findMany({ where: { key: { startsWith: "blockfp:" } }, take: limit });
  const old: string[] = [];
  for (const r of blockRows) {
    const at = /^\d{4}-\d{2}-\d{2}T/.test(r.value) ? new Date(r.value) : new Date(NaN);
    if (Number.isNaN(at.getTime())) await db.appSetting.updateMany({ where: { key: r.key }, data: { value: now.toISOString() } });
    else if (at < cutoff) old.push(r.key);
  }
  if (old.length) blocks = (await db.appSetting.deleteMany({ where: { key: { in: old } } })).count;

  const removedRows = await db.appSetting.findMany({ where: { key: { startsWith: "removed:" } }, select: { key: true }, take: limit });
  const groupOf = (key: string) => key.split(":")[1] ?? "";
  const ids = [...new Set(removedRows.map((r) => groupOf(r.key)).filter(Boolean))];
  const alive = new Set((await db.group.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((g) => g.id));
  const gone = removedRows.filter((r) => !alive.has(groupOf(r.key))).map((r) => r.key);
  const removed = gone.length ? (await db.appSetting.deleteMany({ where: { key: { in: gone } } })).count : 0;
  return { blocks, removed };
}
