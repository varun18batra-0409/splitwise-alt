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
