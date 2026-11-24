// How far a wheel turn should move a sideways row on a computer: the vertical turn becomes a sideways move, unless the row is already at
// that end (then the page scrolls on as usual) or the person is already moving sideways (a trackpad). Pure numbers, so it can be tested.
// Returns the row's new scrollLeft, or null to leave the wheel alone.
export function wheelMove(o: { deltaX: number; deltaY: number; scrollLeft: number; max: number }): number | null {
  if (o.max <= 0) return null; // nothing to scroll
  if (Math.abs(o.deltaY) <= Math.abs(o.deltaX)) return null; // already sideways: the browser does it
  if (o.deltaY < 0 && o.scrollLeft <= 0) return null; // at the start: let the page go up
  if (o.deltaY > 0 && o.scrollLeft >= o.max - 1) return null; // at the end: let the page go down
  return Math.max(0, Math.min(o.max, o.scrollLeft + o.deltaY));
}
