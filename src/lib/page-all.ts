// "Download my data" reads each section a page at a time, ordered by (createdAt, id), until there is no more, up to a ceiling per
// section. Nothing is cut silently: when the ceiling is reached with more behind it, `capped` is true and the file says so.

export const MY_DATA_CEILING = 20_000;
const PAGE = 1000;

export type Cursor = { createdAt: Date; id: string };

// The "after this row" part of a where, for rows ordered by createdAt then id (both ascending).
export const afterCursor = (c: Cursor | null) => (c ? { OR: [{ createdAt: { gt: c.createdAt } }, { createdAt: c.createdAt, id: { gt: c.id } }] } : {});

export async function pageAll<T extends Cursor>(fetchPage: (after: Cursor | null, take: number) => Promise<T[]>, ceiling = MY_DATA_CEILING, pageSize = PAGE): Promise<{ rows: T[]; capped: boolean }> {
  const rows: T[] = [];
  let after: Cursor | null = null;
  for (;;) {
    const take = Math.min(pageSize, ceiling + 1 - rows.length); // one more than the ceiling, to know whether there is more
    const got: T[] = await fetchPage(after, take);
    rows.push(...got);
    if (rows.length > ceiling) return { rows: rows.slice(0, ceiling), capped: true };
    if (got.length < take) return { rows, capped: false };
    const last: T = got[got.length - 1];
    after = { createdAt: last.createdAt, id: last.id };
  }
}
