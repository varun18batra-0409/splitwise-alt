// The line under "Your passport". It changes every 5 countries, so the header grows with you. It never repeats the number
// (the count sits just below it, founder rule B1) and stays short enough for two lines on a 320 px phone.
const LINES: string[] = [
  "The first stamps. Plenty of pages to fill.", // 1–4
  "The pages are starting to fill up.", // 5–9
  "Well travelled, and it shows.", // 10–14
  "Friends ask you where to go next.", // 15–19
  "A seasoned traveller, still curious.", // 20–24
  "Your passport has stories to tell.", // 25–29
  "Few passports look like this one.", // 30–34
  "The world feels a little smaller now.", // 35–39
  "A true globetrotter.", // 40–44
  "More stamps than most will ever see.", // 45–49
  "A passport worth framing.", // 50 and up
];

export const PASSPORT_LINE_EMPTY = "A personal travel log of your trips and places.";

export function passportLine(countries: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(countries) ? countries : 0));
  if (n === 0) return PASSPORT_LINE_EMPTY;
  return LINES[Math.min(LINES.length - 1, Math.floor(n / 5))];
}
