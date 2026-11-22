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

// Like revealSelected, but only when the picked item is a different one from last time (or the row has just opened). A row must never
// jump back to the picked item while someone is swiping through it (founder, 22 Nov: rows "start from the beginning" when swiped
// to the end, because every redraw scrolled the picked item back into view). `last` remembers the item already shown.
export function revealIfNewPick(row: HTMLElement | null, last: { current: Element | null }, gap = 12): void {
  if (!row) return;
  const on = row.querySelector('[aria-pressed="true"],[aria-selected="true"],[aria-current="page"],[aria-current="true"]');
  if (!on || on === last.current) return;
  last.current = on;
  revealSelected(row, gap);
}

// How far a sideways row should move so its last visible item is never sliced to a bare letter: the item cut by the right edge
// must be fully shown or clearly peeking (at least `min` of it). Pure numbers in, one number out (px to add to scrollLeft).
// `items` are the items' [left, right] edges and `edge` is the row's right edge, in the same coordinates.
export function peekFix(items: Array<[number, number]>, edge: number, min = 0.4): number {
  for (const [l, r] of items) {
    if (l >= edge || r <= edge) continue; // fully hidden or fully shown
    const width = r - l;
    const shown = edge - l;
    if (shown / width >= min) return 0;
    return Math.ceil(min * width - shown) + 1; // nudge forward until 40% of it shows
  }
  return 0;
}

// Keeps a sideways row tidy once the finger lifts: nudges it with `peekFix`. Returns a function that stops listening.
// `fade` is the width of the soft edge fade on the right, which does not count as showing.
export function keepPeeking(row: HTMLElement | null, fade = 0): () => void {
  if (!row) return () => {};
  let t: ReturnType<typeof setTimeout> | undefined;
  const settle = () => {
    const rr = row.getBoundingClientRect();
    const kids = Array.from(row.children) as HTMLElement[];
    const items = kids.map((k) => {
      const b = k.getBoundingClientRect();
      return [b.left, b.right] as [number, number];
    });
    const d = peekFix(items, rr.right - fade);
    if (d) row.scrollBy({ left: d, behavior: "smooth" });
  };
  const onScroll = () => {
    if (t) clearTimeout(t);
    t = setTimeout(settle, 140);
  };
  row.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    if (t) clearTimeout(t);
    row.removeEventListener("scroll", onScroll);
  };
}
