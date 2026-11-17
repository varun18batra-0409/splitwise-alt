// A row that scrolls sideways (chips, tools): bring the picked item fully into view, with a little room for the edge fade.
// Only the row itself moves (never the page). `gap` is the room kept from each edge.
export function revealSelected(row: HTMLElement | null, gap = 12): void {
  if (!row) return;
  const on = row.querySelector<HTMLElement>('[aria-pressed="true"],[aria-selected="true"],[aria-current="page"],[aria-current="true"]');
  if (!on) return;
  const r = row.getBoundingClientRect();
  const c = on.getBoundingClientRect();
  const fade = 28; // the soft fade at the right edge
  if (c.left < r.left + gap) row.scrollLeft += c.left - r.left - gap;
  else if (c.right > r.right - fade - gap) row.scrollLeft += c.right - r.right + fade + gap;
}
