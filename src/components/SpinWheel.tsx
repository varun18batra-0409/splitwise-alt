"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Spin the wheel: can't decide who pays tonight? Spin, and whoever it lands on
// becomes the payer of this expense (you can still change it). Pure fun; the
// pick is random and fair, worked out before the wheel starts turning.
const COLORS = ["#6fe3a8", "#ffab6b", "#7cc4ff", "#ff8fc7", "#b79cff", "#ffd66b", "#8fe0d6", "#f0a0a0"];
const SPIN_MS = 3600;

export function SpinWheel({ people, onPick }: { people: { id: string; label: string }[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const still = useRef(false);
  useEffect(() => {
    still.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  if (people.length < 2) return null;

  const n = people.length;
  const label = (id: string) => people.find((p) => p.id === id)?.label ?? "";
  const slice = 360 / n;
  function spin() {
    if (spinning) return;
    const pick = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 * n);
    // The pointer is at the top: land the middle of the picked slice there.
    const target = 360 - (pick * slice + slice / 2);
    const turns = still.current ? 0 : 360 * 5;
    const next = angle - (angle % 360) + turns + target;
    setWinner(null);
    setSpinning(true);
    setAngle(next);
    setTimeout(
      () => {
        setSpinning(false);
        setWinner(people[pick].id);
        if ("vibrate" in navigator) navigator.vibrate?.(30);
      },
      still.current ? 50 : SPIN_MS,
    );
  }

  const r = 140;
  const point = (deg: number) => [r + r * Math.sin((deg * Math.PI) / 180), r - r * Math.cos((deg * Math.PI) / 180)];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-full border border-line px-3 py-1 text-xs font-semibold active:bg-mist" aria-haspopup="dialog">
        🎡 Spin for it
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 px-6" onClick={() => !spinning && setOpen(false)}>
            <div role="dialog" aria-modal="true" aria-label="Spin the wheel" onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-[28px] border border-line bg-canvas px-5 pb-6 pt-5 text-center text-fg">
              <p className="font-display text-2xl font-semibold">Who pays tonight?</p>
              <div className="relative mx-auto mt-5 h-[280px] w-[280px]">
                {/* The pointer */}
                <span aria-hidden className="absolute left-1/2 top-[-6px] z-10 h-0 w-0 -translate-x-1/2 border-x-[12px] border-t-[20px] border-x-transparent border-t-fg" />
                <svg
                  viewBox={`0 0 ${2 * r} ${2 * r}`}
                  className="h-full w-full"
                  style={{ transform: `rotate(${angle}deg)`, transition: spinning && !still.current ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.8, 0.18, 1)` : "none" }}
                  aria-hidden
                >
                  {people.map((p, i) => {
                    const [x1, y1] = point(i * slice);
                    const [x2, y2] = point((i + 1) * slice);
                    const mid = (i + 0.5) * slice;
                    const [tx, ty] = [r + r * 0.62 * Math.sin((mid * Math.PI) / 180), r - r * 0.62 * Math.cos((mid * Math.PI) / 180)];
                    return (
                      <g key={p.id}>
                        <path d={`M${r},${r} L${x1},${y1} A${r},${r} 0 ${slice > 180 ? 1 : 0},1 ${x2},${y2} Z`} fill={COLORS[i % COLORS.length]} stroke="#14130f" strokeWidth="2" />
                        <text x={tx} y={ty} transform={`rotate(${mid} ${tx} ${ty})`} textAnchor="middle" dominantBaseline="middle" fontSize={n > 6 ? 13 : 16} fontWeight="700" fill="#14130f">
                          {p.label.slice(0, 10)}
                        </text>
                      </g>
                    );
                  })}
                  <circle cx={r} cy={r} r="16" fill="#14130f" stroke="#f4f1e8" strokeWidth="3" />
                </svg>
              </div>
              <p className="mt-4 min-h-[32px] font-hand text-[26px] font-bold text-[#ffd9a8]" role="status" data-spin-winner={winner ?? ""}>
                {winner ? (label(winner) === "You" ? "You pay! 🎉" : `${label(winner)} pays! 🎉`) : spinning ? "Round and round…" : "Tap spin. No take-backs 😏"}
              </p>
              {winner ? (
                <button
                  type="button"
                  onClick={() => {
                    onPick(winner);
                    setOpen(false);
                  }}
                  className="pop mt-3 block w-full bg-fg px-4 py-3 text-center font-semibold text-canvas [--pop-edge:#6e6b63]"
                >
                  {label(winner) === "You" ? "Set yourself as payer" : `Set ${label(winner)} as payer`}
                </button>
              ) : (
                <button type="button" onClick={spin} disabled={spinning} className="pop mt-3 block w-full bg-fg px-4 py-3 text-center font-semibold text-canvas [--pop-edge:#6e6b63] disabled:opacity-60">
                  {spinning ? "Spinning…" : "Spin"}
                </button>
              )}
              {winner && (
                <button type="button" onClick={spin} className="mt-2 text-sm font-medium text-fg/60 underline">
                  Spin again
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
