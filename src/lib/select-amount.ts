// Select the whole amount in a box the moment it gets focus. Dropping the commas on focus rewrites the box, which loses the
// selection, so the next digits would land after the old ones ("1,500" then 2000 → 15002000). iOS Safari also puts the caret
// after focus has finished, so the selection is made again on the next frame and the next tick. Only called on focus-in, never on a keystroke.
export function selectWholeAmount(el: HTMLInputElement | null): void {
  if (!el) return;
  const all = () => {
    if (typeof document !== "undefined" && document.activeElement !== el) return; // focus moved on: leave it alone
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
}
