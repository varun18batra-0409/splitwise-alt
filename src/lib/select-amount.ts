// Select the whole amount in a box the moment it gets focus. Dropping the commas on focus rewrites the box, which loses the
// selection, so the next digits would land after the old ones ("1,500" then 2000 → 15002000). Called on focus-in only, never on a keystroke.
//
// Three extra guards:
// - iOS Safari puts the caret after focus has finished, so the selection is made again on the next frame and the next tick.
// - A mouse focuses on mousedown, and the mouseup that follows can collapse the selection: the first mouseup/pointerup right after
//   focus selects everything again if it was collapsed. Later clicks place the caret normally.
// - Fast typing: if the text has changed since focus (someone already typed), the later re-selects are skipped, so "2000" typed
//   quickly can never become "000".
const MOUSE_WINDOW_MS = 800; // how long after focus a mouseup still counts as part of the same tap

export function selectWholeAmount(el: HTMLInputElement | null): void {
  if (!el) return;
  const valueAtFocus = el.value;
  const all = () => {
    if (typeof document !== "undefined" && document.activeElement !== el) return; // focus moved on: leave it alone
    if (el.value !== valueAtFocus) return; // already typed into: never select over new digits
    try {
      el.select();
      el.setSelectionRange(0, el.value.length);
    } catch {
      // some input types refuse a selection range; select() above is enough
    }
  };
  all();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(all);
  setTimeout(all, 0);

  // The "just focused" flag: it lives only as these listeners, which remove themselves.
  if (typeof el.addEventListener !== "function") return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer) clearTimeout(timer);
    for (const type of ["mouseup", "pointerup"]) el.removeEventListener(type, onUp);
    for (const type of ["keydown", "input", "blur"]) el.removeEventListener(type, clear);
  };
  function onUp() {
    const collapsed = el!.selectionStart === el!.selectionEnd;
    clear(); // first mouseup/pointerup only
    if (collapsed) all();
  }
  for (const type of ["mouseup", "pointerup"]) el.addEventListener(type, onUp);
  for (const type of ["keydown", "input", "blur"]) el.addEventListener(type, clear);
  timer = setTimeout(clear, MOUSE_WINDOW_MS);
}
