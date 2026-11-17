// Where the emoji picker opens from the "+" button. Pure, so it can be tested without a browser. All sizes in css px.
//
// Rules: open right under the button. If the picker is taller than the room under it, scroll the page to make room (never so far that
// the button leaves the top of the screen, and never beyond the end of the page). If there is still not enough room, open above the
// button only when that has clearly more room, and keep it short (it scrolls inside itself). It never grows past the room it has.

export const PICKER_GAP = 8; // between the button and the picker
export const PICKER_BAR = 96; // the floating bar at the bottom of the screen
export const PICKER_TOP_KEEP = 72; // keep the button at least this far from the top of the screen
export const PICKER_MIN = 160; // the smallest room worth opening into
export const PICKER_SHORT = 184; // the tallest the picker gets when it opens above (about four rows of emoji)

export type PickerPlace = { above: boolean; scrollBy: number; maxHeight: number };

export function placePicker(i: { buttonTop: number; buttonBottom: number; viewHeight: number; panelHeight: number; scrollRoom: number }): PickerPlace {
  const below = Math.max(0, i.viewHeight - PICKER_BAR - i.buttonBottom - PICKER_GAP);
  if (i.panelHeight <= below) return { above: false, scrollBy: 0, maxHeight: i.panelHeight };
  const canScroll = Math.max(0, Math.min(i.scrollRoom, i.buttonTop - PICKER_TOP_KEEP));
  const need = i.panelHeight - below;
  if (need <= canScroll) return { above: false, scrollBy: Math.ceil(need), maxHeight: i.panelHeight };
  const belowAfter = below + canScroll;
  const above = Math.max(0, i.buttonTop - PICKER_GAP - PICKER_TOP_KEEP);
  if (belowAfter >= PICKER_MIN || belowAfter >= above) return { above: false, scrollBy: Math.floor(canScroll), maxHeight: Math.max(0, Math.floor(belowAfter)) };
  return { above: true, scrollBy: 0, maxHeight: Math.min(i.panelHeight, PICKER_SHORT, Math.floor(above)) };
}
