"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/lib/use-focus-trap";

// Spin the wheel: can't decide who pays tonight? Spin, and whoever it lands on
// becomes the payer of this expense (you can still change it). The pick is
// random and fair, worked out before the wheel starts turning.

// Calm dark slices with a soft off-white edge (colour is kept for money).
const SLICES = ["#1f1f24", "#2a2a31", "#35353d"];
const GOLD = "#b9b7b1";
const INK = "#f4f2ec";
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

export function SpinWheel({ people, onPick, roomy = false }: { people: { id: string; label: string }[]; onPick: (id: string) => void; roomy?: boolean }) {
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
  const spinningNow = useRef(false);
  spinningNow.current = spinning;
  const layer = useFocusTrap(open, { onEscape: () => !spinningNow.current && setOpen(false) });
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
        className={`flex items-center gap-1.5 rounded-full border border-fg/25 bg-transparent font-semibold ${roomy ? "min-h-11 px-4 text-sm" : "px-3 py-1.5 text-xs"} text-fg active:bg-fg/10`}
      >
        <span className="motion-safe:animate-[spin_6s_linear_infinite]" aria-hidden>
          <WheelIcon size={15} />
        </span>
        Spin for it
      </button>
      {open &&
        createPortal(
          <div ref={layer} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-5 backdrop-blur-[2px]" onClick={() => !spinning && setOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Spin the wheel"
              onClick={(e) => e.stopPropagation()}
              className="sheet-enter relative w-full max-w-sm overflow-hidden rounded-[32px] border border-line bg-white px-5 pb-6 pt-6 text-center"
              style={{ color: INK }}
            >
              <button type="button" onClick={() => !spinning && setOpen(false)} aria-label="Close" className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full text-[#f7f4ec]/70 active:bg-white/10">
                <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
              <p className="text-[13px] font-medium leading-none text-fg/60">Who pays?</p>
              <p className="mt-1 font-display text-[26px] font-semibold leading-tight">Let the wheel decide</p>

              <div className="relative mx-auto mt-5 aspect-square w-full max-w-[300px]">
                {/* The pointer. */}
                <svg aria-hidden viewBox="0 0 40 46" className="absolute left-1/2 top-[-10px] z-10 h-[38px] w-[33px] -translate-x-1/2 drop-shadow-[0_4px_6px_rgba(0,0,0,0.6)]">
                  <path d="M20 44 L6 16 A15 15 0 1 1 34 16 Z" fill={GOLD} stroke="#6e6b63" strokeWidth="1.5" />
                  <circle cx="20" cy="15" r="5" fill="#0d0d0f" />
                </svg>
                <svg
                  viewBox={`-12 -12 ${2 * r + 24} ${2 * r + 24}`}
                  className="relative h-full w-full"
                  style={{ transform: `rotate(${angle}deg)`, transition: spinning && !still.current ? `transform ${SPIN_MS}ms cubic-bezier(0.1, 0.75, 0.12, 1)` : "none" }}
                  aria-hidden
                >
                  {/* The off-white rim with its little lights. */}
                  <circle cx={r} cy={r} r={r + 9} fill="#0d0d0f" stroke={GOLD} strokeWidth="3" />
                  {Array.from({ length: 24 }, (_, k) => {
                    const [x, y] = at(k * 15, r + 4.5);
                    return <circle key={k} cx={x} cy={y} r="2" fill={k % 2 ? GOLD : "#f4f2ec"} opacity={k % 2 ? 0.7 : 1} />;
                  })}
                  {people.map((p, i) => {
                    const [x1, y1] = at(i * slice);
                    const [x2, y2] = at((i + 1) * slice);
                    const mid = (i + 0.5) * slice;
                    const [tx, ty] = at(mid, r * 0.6);
                    const ls = lines(p.label, max);
                    // Where this label sits on screen once the wheel has stopped: on the right half it reads
                    // outwards from the middle, on the left half inwards, so it is never upside down.
                    const onScreen = (((mid + angle) % 360) + 360) % 360;
                    const rot = onScreen < 180 ? mid - 90 : mid + 90;
                    const lost = winner !== null && winner !== i;
                    return (
                      <g key={p.id} opacity={lost ? 0.45 : 1} style={{ transition: "opacity 300ms" }}>
                        <path d={`M${r},${r} L${x1},${y1} A${r},${r} 0 ${slice > 180 ? 1 : 0},1 ${x2},${y2} Z`} fill={SLICES[i % SLICES.length]} stroke={GOLD} strokeWidth="1.6" />
                        {/* Names read outwards from the middle, over two lines when long. */}
                        <text x={tx} y={ty} transform={`rotate(${rot} ${tx} ${ty})`} textAnchor="middle" fill={INK} fontSize={size} fontWeight="700" style={{ letterSpacing: "0.02em" }}>
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
                    <p className="text-[13px] font-medium leading-none text-fg/60">{you ? "Tonight it’s on you" : "Tonight’s payer"}</p>
                    <p className="lp-slide-in mt-1 font-display text-[32px] font-semibold leading-tight">{win.label}</p>
                  </>
                ) : (
                  <p className="pt-4 text-sm text-[#f7f4ec]/60">{spinning ? "Round and round it goes…" : "Fair and random."}</p>
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
                    className="pop rounded-full bg-fg px-4 py-3.5 text-center font-semibold text-canvas"
                  >
                    {you ? "Set yourself as payer" : `Set ${win.label} as payer`}
                  </button>
                  <button type="button" onClick={spin} className="rounded-full border border-fg/25 bg-transparent px-5 py-3.5 text-sm font-semibold text-fg active:scale-[0.97]">
                    Again
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={spin}
                  disabled={spinning}
                  className="pop mt-2 block w-full rounded-full bg-fg px-4 py-3.5 text-center font-semibold text-canvas disabled:opacity-60"
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
