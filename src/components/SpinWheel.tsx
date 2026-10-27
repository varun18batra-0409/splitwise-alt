"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Spin the wheel: can't decide who pays tonight? Spin, and whoever it lands on
// becomes the payer of this expense (you can still change it). The pick is
// random and fair, worked out before the wheel starts turning.

// Jewel tones with gold between the slices, like a proper casino wheel.
const SLICES = ["#1d2a44", "#1f5c46", "#6e2a3a", "#1f5f68", "#4a2f6b", "#7a5226", "#2c3f63", "#2f6b52"];
const GOLD = "#d8bd7a";
const INK = "#f7f4ec";
const SPIN_MS = 4200;

// A small wheel with a pointer: the button's icon.
export function WheelIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="13" r="8.5" />
      <path d="M12 13 L12 4.5 M12 13 L19.4 17.2 M12 13 L4.6 17.2" />
      <circle cx="12" cy="13" r="1.6" fill="currentColor" stroke="none" />
      <path d="M9.6 1.6 h4.8 L12 4.6 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

// A name split over two lines when it's long ("Mary Ann" → "Mary" / "Ann").
function lines(label: string, max: number): string[] {
  const words = label.trim().split(/\s+/);
  if (label.length <= max || words.length === 1) return [label.length > max + 3 ? `${label.slice(0, max + 2)}…` : label];
  const first = words[0];
  const rest = words.slice(1).join(" ");
  return [first.length > max + 2 ? `${first.slice(0, max + 1)}…` : first, rest.length > max + 2 ? `${rest.slice(0, max + 1)}…` : rest];
}

export function SpinWheel({ people, onPick }: { people: { id: string; label: string }[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);
  const still = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    still.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return () => clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !spinning && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, spinning]);
  if (people.length < 2) return null;

  const n = people.length;
  const slice = 360 / n;
  function spin() {
    if (spinning) return;
    const pick = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * n);
    // The pointer is at the top: land somewhere inside the picked slice (not always dead centre).
    const wobble = (crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 - 0.5) * slice * 0.6;
    const target = 360 - (pick * slice + slice / 2 + wobble);
    const turns = still.current ? 0 : 360 * 6;
    const next = angle - (angle % 360) + turns + target;
    setWinner(null);
    setSpinning(true);
    setAngle(next);
    timer.current = setTimeout(
      () => {
        setSpinning(false);
        setWinner(pick);
        if ("vibrate" in navigator) navigator.vibrate?.([18, 40, 18]);
      },
      still.current ? 50 : SPIN_MS,
    );
  }

  const r = 150;
  const at = (deg: number, rr = r) => [r + rr * Math.sin((deg * Math.PI) / 180), r - rr * Math.cos((deg * Math.PI) / 180)];
  const win = winner === null ? null : people[winner];
  const you = win?.label === "You";
  const size = n > 8 ? 11 : n > 5 ? 13 : 15;
  const max = n > 8 ? 7 : 9;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex items-center gap-1.5 rounded-full border border-[#d8bd7a]/50 bg-[linear-gradient(180deg,rgba(216,189,122,0.16),rgba(216,189,122,0.06))] px-3 py-1.5 text-xs font-semibold text-[#e8d29a] active:bg-[#d8bd7a]/20"
      >
        <WheelIcon size={15} />
        Spin for it
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-5 backdrop-blur-[2px]" onClick={() => !spinning && setOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Spin the wheel"
              onClick={(e) => e.stopPropagation()}
              className="sheet-enter relative w-full max-w-sm overflow-hidden rounded-[28px] border border-[#d8bd7a]/25 bg-[radial-gradient(120%_70%_at_50%_0%,#24242a_0%,#141417_60%,#0d0d0f_100%)] px-5 pb-6 pt-6 text-center"
              style={{ color: INK }}
            >
              <button type="button" onClick={() => !spinning && setOpen(false)} aria-label="Close" className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-xl text-[#f7f4ec]/60 active:bg-white/10">
                ×
              </button>
              <p className="text-[12px] font-semibold tracking-[0.22em] text-[#d8bd7a]">WHO PAYS?</p>
              <p className="mt-1 font-display text-[26px] font-semibold leading-tight">Let the wheel decide</p>

              <div className="relative mx-auto mt-5 aspect-square w-full max-w-[300px]">
                {/* The glow behind the wheel. */}
                <span aria-hidden className="absolute inset-[-12%] rounded-full bg-[radial-gradient(closest-side,rgba(216,189,122,0.22),transparent)]" />
                {/* The pointer. */}
                <svg aria-hidden viewBox="0 0 40 46" className="absolute left-1/2 top-[-10px] z-10 h-[38px] w-[33px] -translate-x-1/2 drop-shadow-[0_4px_6px_rgba(0,0,0,0.6)]">
                  <path d="M20 44 L6 16 A15 15 0 1 1 34 16 Z" fill={GOLD} stroke="#8a6f35" strokeWidth="1.5" />
                  <circle cx="20" cy="15" r="5" fill="#0d0d0f" />
                </svg>
                <svg
                  viewBox={`-12 -12 ${2 * r + 24} ${2 * r + 24}`}
                  className="relative h-full w-full"
                  style={{ transform: `rotate(${angle}deg)`, transition: spinning && !still.current ? `transform ${SPIN_MS}ms cubic-bezier(0.1, 0.75, 0.12, 1)` : "none" }}
                  aria-hidden
                >
                  {/* The gold rim with its little lights. */}
                  <circle cx={r} cy={r} r={r + 9} fill="#0d0d0f" stroke={GOLD} strokeWidth="3" />
                  {Array.from({ length: 24 }, (_, k) => {
                    const [x, y] = at(k * 15, r + 4.5);
                    return <circle key={k} cx={x} cy={y} r="2" fill={k % 2 ? GOLD : "#fff4d6"} opacity={k % 2 ? 0.7 : 1} />;
                  })}
                  {people.map((p, i) => {
                    const [x1, y1] = at(i * slice);
                    const [x2, y2] = at((i + 1) * slice);
                    const mid = (i + 0.5) * slice;
                    const [tx, ty] = at(mid, r * 0.6);
                    const ls = lines(p.label, max);
                    const lost = winner !== null && winner !== i;
                    return (
                      <g key={p.id} opacity={lost ? 0.45 : 1} style={{ transition: "opacity 300ms" }}>
                        <path d={`M${r},${r} L${x1},${y1} A${r},${r} 0 ${slice > 180 ? 1 : 0},1 ${x2},${y2} Z`} fill={SLICES[i % SLICES.length]} stroke={GOLD} strokeWidth="1.6" />
                        {/* Names read outwards from the middle, over two lines when long. */}
                        <text x={tx} y={ty} transform={`rotate(${mid > 180 ? mid + 90 : mid - 90} ${tx} ${ty})`} textAnchor="middle" fill={INK} fontSize={size} fontWeight="700" style={{ letterSpacing: "0.02em" }}>
                          {ls.map((l, k) => (
                            <tspan key={k} x={tx} dy={k === 0 ? (ls.length === 1 ? "0.35em" : "-0.2em") : "1.15em"}>
                              {l}
                            </tspan>
                          ))}
                        </text>
                      </g>
                    );
                  })}
                  {/* The hub. */}
                  <circle cx={r} cy={r} r="24" fill="#0d0d0f" stroke={GOLD} strokeWidth="2.5" />
                  <circle cx={r} cy={r} r="17" fill="none" stroke={GOLD} strokeOpacity="0.4" strokeWidth="1" />
                  <text x={r} y={r} textAnchor="middle" dominantBaseline="central" fill={GOLD} fontSize="16" fontWeight="700" fontFamily="var(--font-display), serif">
                    L
                  </text>
                </svg>
              </div>

              <div className="mt-5 min-h-[64px]" role="status" aria-live="polite" data-spin-winner={win?.id ?? ""}>
                {win ? (
                  <>
                    <p className="text-[12px] font-semibold tracking-[0.22em] text-[#d8bd7a]">{you ? "TONIGHT IT’S ON YOU" : "TONIGHT’S PAYER"}</p>
                    <p className="lp-slide-in mt-1 font-display text-[32px] font-semibold leading-tight">{win.label}</p>
                  </>
                ) : (
                  <p className="pt-4 text-sm text-[#f7f4ec]/60">{spinning ? "Round and round it goes…" : "Fair and random. No take-backs."}</p>
                )}
              </div>
              {win ? (
                <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onPick(win.id);
                      setOpen(false);
                    }}
                    className="rounded-2xl bg-[linear-gradient(180deg,#e8d29a,#c9a75a)] px-4 py-3.5 text-center font-semibold text-[#17150f] shadow-[0_8px_20px_-10px_rgba(216,189,122,0.8)] active:opacity-90"
                  >
                    {you ? "Set yourself as payer" : `Set ${win.label} as payer`}
                  </button>
                  <button type="button" onClick={spin} className="rounded-2xl border border-[#d8bd7a]/40 px-4 py-3.5 text-sm font-semibold text-[#e8d29a] active:bg-white/5">
                    Again
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={spin}
                  disabled={spinning}
                  className="mt-2 block w-full rounded-2xl bg-[linear-gradient(180deg,#e8d29a,#c9a75a)] px-4 py-3.5 text-center font-semibold text-[#17150f] shadow-[0_8px_20px_-10px_rgba(216,189,122,0.8)] active:opacity-90 disabled:opacity-60"
                >
                  {spinning ? "Spinning…" : "Spin"}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
