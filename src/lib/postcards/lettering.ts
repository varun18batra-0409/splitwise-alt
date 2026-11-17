import type { Fit } from "./format";

// Where the lettering on the front sits, and what keeps it readable. Pure, so the card on screen (Card.tsx) and the picture that is
// sent (render.ts) agree. All sizes are in "cqw": a share of the card's width (the card is 3:2, so its height is 66.667).
//
//  - Full photo: light words get a soft dark scrim behind them, only where the words are.
//  - White border or taped print: the words go on the card's margin, under the photo (or above it, if the words are set to the top),
//    so they never cross the photo's edge. The margin is light paper, so light lettering is drawn in navy there.

export const CARD_H = 100 * (2 / 3);

// Does this fit put the words on the card's margin (not over the photo)?
export const wordsOnMargin = (fit: Fit | string): boolean => fit === "border" || fit === "taped";

// The size of the title, in cqw (the same numbers the card has always used).
export const titleSizeCqw = (caps: boolean, long: boolean, scale: number) => (caps ? (long ? 11 : 15) : long ? 9.5 : 13.5) * scale;

// The height the words need on the margin: the small "Greetings from" line, the title and some air.
export const KICKER_CQW = 3.2;
export const bandCqw = (titleCqw: number) => Math.round((KICKER_CQW + titleCqw + 2.6) * 100) / 100;

// Which edge the margin band is on: the top when the words are set to the top, otherwise the bottom.
export const bandSide = (at: string): "top" | "bottom" => (at === "top" ? "top" : "bottom");

// The room left for the print once the band is taken out, and the print's size in it. Prints are 4:3 (photos) or 3:2 (drawn scenes),
// with a white border of PAD on three sides and PAD_BOTTOM under the picture. Room is left around it for the tape and the tilt.
export const PRINT_PAD = 1.6;
export const PRINT_PAD_BOTTOM = 6;
export const PRINT_AIR = 7;
export const PRINT_W_FULL = 62;
export function printBox(band: number, aspect: number) {
  const area = CARD_H - band;
  const h = Math.max(20, area - PRINT_AIR);
  const w = Math.min(PRINT_W_FULL, (h - PRINT_PAD - PRINT_PAD_BOTTOM) * aspect + PRINT_PAD * 2);
  return { area, w, h: (w - PRINT_PAD * 2) / aspect + PRINT_PAD + PRINT_PAD_BOTTOM };
}

// A soft dark band behind light words (full photo only): where it is, as shares of the card's height.
export const scrimWanted = (fit: Fit | string, darkTone: boolean, hasWords: boolean) => hasWords && !darkTone && fit === "full";
export const SCRIM_ALPHA = 0.55;
export const SCRIM_HEIGHT = 0.4; // of the card's height
export const scrimTop = (at: string) => (at === "top" ? 0 : at === "middle" ? (1 - SCRIM_HEIGHT) / 2 : 1 - SCRIM_HEIGHT);

// Light lettering would vanish on the light margin: it is drawn in navy there (the editor also switches to navy the first time).
export const MARGIN_INK = "#1d2a52";
export const marginInk = (tone: { c: string; dark: boolean }) => (tone.dark ? tone.c : MARGIN_INK);
