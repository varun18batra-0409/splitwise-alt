import { ONESIDE, type PhotoSize } from "./format";

// Does the message fit on the back of the card? The writing area is 47% of the card wide and 73% of its height
// (card 3:2), the writing is 4.1% of the card's width times the hand's size, with 1.28 line spacing, and the sign-off
// ("— Name") sits under the message after a small gap. All sizes below are in "card widths".
const BOX_W = 0.47;
const BOX_H = 0.73 * (2 / 3);
const FONT = 0.041;
const LEADING = 1.28;
const GAP = 0.4; // in lines of text, before the sign-off

export const MESSAGE_MAX = 500;

// Width of a piece of text in "em" (1 = the font size). The default is a rough average for handwriting fonts;
// the composer passes a real measure from the font in use.
export type MeasureEm = (text: string) => number;
export const roughMeasure: MeasureEm = (t) => t.length * 0.45;

// Break into lines the way the drawn card does: on spaces, a long word stays whole, and newlines are kept.
export function wrapLines(text: string, maxEm: number, measure: MeasureEm = roughMeasure): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (measure(t) > maxEm && line) {
        out.push(line);
        line = word;
      } else line = t;
    }
    out.push(line);
  }
  return out;
}

export function maxMessageLines(handSize: number): number {
  const fs = FONT * handSize;
  return Math.max(1, Math.floor((BOX_H / fs - GAP) / LEADING - 1));
}

// over is how many lines too many (0 when it fits).
export function messageFit(message: string, handSize: number, measure: MeasureEm = roughMeasure): { lines: number; max: number; over: number } {
  const fs = FONT * handSize;
  const lines = message.trim() ? wrapLines(message, BOX_W / fs, measure).length : 0;
  const max = maxMessageLines(handSize);
  return { lines, max, over: Math.max(0, lines - max) };
}

export function overText(over: number): string {
  return `Too long for the card: trim about ${over} ${over === 1 ? "line" : "lines"}.`;
}

// Adding a starter phrase in front of what's written, never beyond the limit.
export function withOpener(message: string, opener: string): string {
  const base = message.trim() ? `${opener.trim()} ${message}` : opener;
  return base.slice(0, MESSAGE_MAX);
}

// ---------- One side ----------
// The note on a one-side card gets smaller until it fits its box (never silently cut). f is in card widths.
// Box width = note.w (card widths); height = (note.bottom - note.top) of the card's height, and the card is 2/3 as tall as wide.
// Lines are 1.12 × the font tall. The writing starts at `base` (for a hand of size 1.12, scaled by handSize / 1.12) and steps
// down 2% at a time, 20 times; if even that is too big the answer is 60% of base and over = true.
const ONESIDE_STEP = 0.02;
const ONESIDE_STEPS = 20;
const ONESIDE_LINE = 1.12;
export function oneSideFont(message: string, handSize: number, size: PhotoSize, measure: MeasureEm = roughMeasure): { f: number; over: boolean } {
  const g = ONESIDE[size];
  const base = g.font * (handSize / 1.12);
  const boxH = (g.note.bottom - g.note.top) * (2 / 3);
  for (let k = 0; k <= ONESIDE_STEPS; k++) {
    const f = base * (1 - ONESIDE_STEP * k);
    const lines = wrapLines(message, g.note.w / f, measure).length;
    if (lines * ONESIDE_LINE * f <= boxH) return { f, over: false };
  }
  return { f: base * 0.6, over: true };
}
