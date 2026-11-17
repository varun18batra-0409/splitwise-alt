import { db } from "./db";

// Daily tidy-up of the small scrambled notes kept in the settings table (no emails are in them):
//  - "removed:<groupId>:" notes (removal-marks.ts) go when their group is gone (erasing a group does this too; this catches the rest).
// Block notes ("blockfp:", block-marks.ts) are NOT touched here: a block has no expiry (founder decision D-2).
// Rows are read in pages in key order, so every row is looked at over time, never just the first few.
const PAGE = 500;

export async function cleanMarks(limit = 5000): Promise<{ removed: number }> {
  let removed = 0;
  let after = "";
  for (let seen = 0; seen < limit; ) {
    const rows = await db.appSetting.findMany({ where: { key: { startsWith: "removed:", gt: after } }, select: { key: true }, orderBy: { key: "asc" }, take: PAGE });
    if (!rows.length) break;
    after = rows[rows.length - 1].key;
    seen += rows.length;
    const groupOf = (key: string) => key.split(":")[1] ?? "";
    const ids = [...new Set(rows.map((r) => groupOf(r.key)).filter(Boolean))];
    const alive = new Set((await db.group.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((g) => g.id));
    const gone = rows.filter((r) => !alive.has(groupOf(r.key))).map((r) => r.key);
    if (gone.length) removed += (await db.appSetting.deleteMany({ where: { key: { in: gone } } })).count;
    if (rows.length < PAGE) break;
  }
  return { removed };
}
