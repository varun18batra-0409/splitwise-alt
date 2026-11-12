// One shared way to keep Tab inside an open sheet or dialog (taken from GroupTypeSheet).

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

// Where Tab should go next, or null to let the browser carry on.
// - index: position of the focused item among the dialog's items (-1 when focus is outside or on the heading).
export function tabTarget(opts: { shift: boolean; index: number; count: number; inside: boolean; onHeading?: boolean }): "first" | "last" | null {
  const { shift, index, count, inside, onHeading = false } = opts;
  if (count === 0) return null;
  if (shift) return !inside || onHeading || index === 0 ? "last" : null;
  return !inside || index === count - 1 ? "first" : null;
}

// While `box` is open: focus moves in (to `start`, or the first item), Tab stays inside, Escape calls onEscape,
// and focus goes back to where it was. Returns a clean-up function.
export function trapFocus(box: HTMLElement | null, opts: { onEscape?: () => void; start?: HTMLElement | null } = {}): () => void {
  if (typeof document === "undefined") return () => {};
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const items = () => Array.from(box?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
  (opts.start ?? items()[0])?.focus({ preventScroll: true });
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape" && opts.onEscape) {
      opts.onEscape();
      return;
    }
    if (e.key !== "Tab") return;
    const list = items();
    const now = document.activeElement;
    const go = tabTarget({
      shift: e.shiftKey,
      index: now instanceof HTMLElement ? list.indexOf(now) : -1,
      count: list.length,
      inside: box?.contains(now) ?? false,
      onHeading: !!opts.start && now === opts.start,
    });
    if (!go) return;
    e.preventDefault();
    (go === "first" ? list[0] : list[list.length - 1]).focus();
  };
  window.addEventListener("keydown", keys);
  return () => {
    window.removeEventListener("keydown", keys);
    if (before && document.contains(before)) before.focus({ preventScroll: true });
  };
}
