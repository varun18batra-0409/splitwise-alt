// "Show older": a list that starts with `base` items and grows by `step` each time, up to `max`.
// `want` is what the address asked for (the "?n=" part). Read one extra row to know whether there is more.
export function windowFor(want: unknown, base = 60, step = 60, max = 600): { shown: number; take: number; next: number | null } {
  const n = Number(want);
  const shown = Number.isFinite(n) && n > base ? Math.min(max, Math.floor(n)) : base;
  return { shown, take: shown + 1, next: shown < max ? Math.min(max, shown + step) : null };
}

// Given the rows read (shown + 1 at most), what to display and whether to offer "Show older".
export function trimWindow<T>(rows: T[], w: { shown: number; next: number | null }): { rows: T[]; more: number | null } {
  return rows.length > w.shown ? { rows: rows.slice(0, w.shown), more: w.next } : { rows, more: null };
}
