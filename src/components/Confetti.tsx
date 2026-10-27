"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { buzz } from "@/lib/haptics";

const COLOURS = ["#6fe3a8", "#f4f2ec", "#ffab6b", "#e8c77a", "#c9c2ff"];
const COUNT = 46;

// Fixed, so the burst looks the same every time (and on the server).
const PIECES = Array.from({ length: COUNT }, (_, i) => {
  const r = (n: number) => {
    const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    left: r(1) * 100,
    w: 6 + r(2) * 6,
    h: 9 + r(3) * 8,
    round: r(4) > 0.7,
    delay: r(5) * 0.35,
    time: 1.7 + r(6) * 1.1,
    dx: (r(7) - 0.5) * 160,
    turn: (r(8) - 0.5) * 1440,
    colour: COLOURS[i % COLOURS.length],
  };
});

// A short burst of confetti the first time you see a group go all square (once per group per visit).
export function Confetti({ id }: { id: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const key = `lp-confetti:${id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Private mode: still celebrate.
    }
    setOn(true);
    buzz("success");
    const t = setTimeout(() => setOn(false), 3400);
    return () => clearTimeout(t);
  }, [id]);
  if (!on) return null;
  return (
    <div aria-hidden data-confetti className="pointer-events-none fixed inset-0 z-[80] overflow-hidden">
      {PIECES.map((p, i) => (
        <span
          key={i}
          className="lp-confetti"
          style={
            {
              left: `${p.left}%`,
              width: p.w,
              height: p.round ? p.w : p.h,
              borderRadius: p.round ? "50%" : 2,
              background: p.colour,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.time}s`,
              "--dx": `${p.dx}px`,
              "--turn": `${p.turn}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
