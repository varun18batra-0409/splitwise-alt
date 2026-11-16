// The "Custom" card-fee box on the Add screen. The chips 2%, 3% and 4% and the box share one saved value, so a box that
// showed "whatever the value is, unless it equals a chip" blanked itself as soon as someone typed "3" (on the way to
// "3.5"). The box keeps its own text: it shows what was typed, and nothing after a chip is tapped.
//
// Hand-worked: type "3" -> custom "3", box "3" (still shown); type "3." -> box "3."; type "3.5" -> custom "3.5" = 350 basis
// points. Tap the 3% chip -> custom "3", box "" (the chip is lit, the box is empty). Tap None -> only the choice changes.

export type MarkupChoice = "group" | "none" | "custom";
export type MarkupBoxState = { choice: MarkupChoice; custom: string; box: string };
export type MarkupBoxAction = { type: "chip"; percent: string } | { type: "type"; text: string } | { type: "group" } | { type: "none" };

export const MARKUP_CHIPS = ["2", "3", "4"];

// The state to start from: a saved custom value that isn't one of the chips belongs in the box.
export function markupBoxStart(choice: MarkupChoice, custom: string): MarkupBoxState {
  return { choice, custom, box: choice === "custom" && !MARKUP_CHIPS.includes(custom) ? custom : "" };
}

export function markupBox(state: MarkupBoxState, action: MarkupBoxAction): MarkupBoxState {
  switch (action.type) {
    case "chip":
      return { choice: "custom", custom: action.percent, box: "" };
    case "type":
      return { choice: "custom", custom: action.text, box: action.text };
    case "group":
      return { ...state, choice: "group" };
    case "none":
      return { ...state, choice: "none" };
  }
}

// What the box shows.
export const markupBoxValue = (state: MarkupBoxState): string => (state.choice === "custom" ? state.box : "");
