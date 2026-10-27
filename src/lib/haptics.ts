// A small buzz on the taps that matter (Android; iPhones ignore it).
// "tap": a light tick. "success": saved, paid, all square. "warn": something removed.
export type Buzz = "tap" | "success" | "warn";

const PATTERNS: Record<Buzz, number | number[]> = {
  tap: 8,
  success: [12, 60, 22],
  warn: [24, 50, 24],
};

export function buzz(kind: Buzz = "tap") {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(PATTERNS[kind]);
  } catch {
    // Some browsers refuse vibration in certain states (e.g. before any tap); that's fine.
  }
}

export function isBuzz(v: string | undefined | null): v is Buzz {
  return v === "tap" || v === "success" || v === "warn";
}
