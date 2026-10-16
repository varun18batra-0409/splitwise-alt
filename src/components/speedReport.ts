"use client";

// Collects how long taps take on this phone and sends them a few at a time
// (numbers only; the server strips ids from the screen names).
const queue: { k: string; r: string; ms: number }[] = [];
let started = false;

function flush() {
  if (!queue.length) return;
  const body = JSON.stringify(queue.splice(0, 30));
  try {
    if (navigator.sendBeacon?.("/api/speed", new Blob([body], { type: "application/json" }))) return;
  } catch {}
  fetch("/api/speed", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
}

export function reportSpeed(kind: "nav" | "submit" | "search" | "load", path: string, ms: number) {
  if (!started && typeof window !== "undefined") {
    started = true;
    window.setInterval(flush, 20_000);
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  }
  queue.push({ k: kind, r: path, ms: Math.round(ms) });
  if (queue.length >= 10) flush();
}
