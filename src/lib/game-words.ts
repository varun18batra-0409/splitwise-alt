// Game night: the words people see, in one place, so one word means one thing everywhere
// (app-store wording: Loopin keeps the score of games, it never runs betting).
//
//   Chips in    = money a player puts in to play (a first amount or a top-up)
//   Took home   = what a player leaves the table with
//   came out ahead / came out behind / even = the result for a player (never won, lost or winnings)
//
// The internal names (kind "pot", the /pot/ routes, the stored game values "poker" and
// "teenpatti", the move kinds "take" and "return") stay as they are: only the labels change.

export const GAME_NIGHT = "Game night";
export const GAME_NIGHT_LOWER = "game night";
export const GAME_NOTE = "Loopin keeps the score of games you play together. No betting happens in the app.";

// What the game is. Old stored values still work and show a neutral label.
export type GameKind = "cards" | "board" | "any" | "poker" | "teenpatti";
export const GAME_CHOICES: { id: "cards" | "board" | "any"; label: string; emoji: string }[] = [
  { id: "cards", label: "Cards", emoji: "🃏" },
  { id: "board", label: "Board game", emoji: "🎲" },
  { id: "any", label: "Any game", emoji: "🎮" },
];
const OLD_VALUES: Record<string, string> = { poker: "cards", teenpatti: "cards" };
export const isGameKind = (x: string): x is GameKind => GAME_CHOICES.some((g) => g.id === x) || Object.hasOwn(OLD_VALUES, x);
// The neutral choice a stored value stands for ("poker" and "teenpatti" were card games).
export const gameChoiceOf = (x: string) => GAME_CHOICES.find((g) => g.id === ((Object.hasOwn(OLD_VALUES, x) ? OLD_VALUES[x] : x))) ?? GAME_CHOICES[0];
export const gameLabel = (x: string) => gameChoiceOf(x).label;
export const gameEmoji = (x: string) => gameChoiceOf(x).emoji;

// Words that must never be shown on the game screens or the group-type chips.
export const BANNED_GAME_WORDS = /poker|teen\s?patti|teenpatti|buy[\s-]?ins?\b|cash(ed)?[\s-]?outs?|cashed out|winnings?|\bbets?\b|\bbetting\b|gambl/i;
// "No betting happens in the app" is the one allowed use of the word.
export const stripAllowedLine = (text: string) => text.replace(/no betting happens in the app\.?/gi, "");

// How a "took home" line was saved: older games saved it as "cashed out". Both are read; new ones are "took home".
export const TOOK_HOME_NOTES = ["took home", "cashed out"];
export const hasBannedGameWord = (text: string) => BANNED_GAME_WORDS.test(stripAllowedLine(text));

// Older games were saved with the old words ("Teen Patti · 26 Oct", "Asha won ₹600", "(Poker, 4 players)",
// "Missing from the pot"). Stored data is never changed: this rewrites those patterns only when shown.
// New games and events are saved with the neutral words already.
export function neutralGameText(s: string): string {
  return String(s ?? "")
    .replace(/\b(teen\s?patti|poker)\s*·/gi, "Game night ·")
    .replace(/\((teen\s?patti|poker),/gi, "(Cards,")
    .replace(/\bwon (?=[^\s\d]{0,4}\s?[\d.,]+\b(?! rounds?| games?| hands?))/g, "came out ahead ")
    .replace(/\bMissing from the pot\b/g, "Missing from the count")
    .replace(/\bExtra in the pot\b/g, "Extra in the count")
    .replace(/\bcashed out\b/g, "took home");
}
