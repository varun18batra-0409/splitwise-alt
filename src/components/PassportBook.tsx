"use client";

import { useEffect, useRef, useState } from "react";
import type { Badge, IndexRow, Stamp } from "@/lib/passport";
import map from "@/generated/map.json";

// The trip passport as a little booklet. A navy cover you tap to open, then
// pages you swipe like a real passport: the photo page with your counts, the
// stamp pages (one stamp per trip, inked at a slant), and an index at the back.

const INKS = ["#2b4c7e", "#a53a3a", "#2f7d4f", "#6a3d8f", "#8a5a2b", "#1f6f78"];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
// Written out by hand, so the phone and the server always agree ("SEP 2026").
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const month = (d: string) => (/^\d{4}-\d{2}/.test(d) ? `${MONTHS[Number(d.slice(5, 7)) - 1] ?? ""} ${d.slice(0, 4)}` : "");
// The cover in Loopin's own colours: the dark surface, off-white foil, a touch of green.
const GOLD = "#ece8dc";
const GREEN = "#6fe3a8";
const PAPER = "#efe8d6";

type Page = { title: string; stamps: Stamp[] };
type Props = {
  name: string;
  stats: { cities: number; countries: number; trips: number; thisYear: number };
  milestones: string[];
  pages: Page[];
  index: IndexRow[];
  badges?: Badge[];
};

// The faint security print on every page.
const paper = {
  backgroundColor: PAPER,
  backgroundImage:
    "radial-gradient(circle at 50% 120%, transparent 0 38%, rgba(43,76,126,0.06) 38.5% 39%, transparent 39.5% 45%, rgba(43,76,126,0.05) 45.5% 46%, transparent 46.5%), repeating-linear-gradient(115deg, rgba(38,35,29,0.035) 0 1px, transparent 1px 7px)",
} as const;

function Emblem({ size = 92 }: { size?: number }) {
  // A compass rose, pressed in gold.
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden fill="none" stroke={GOLD} strokeWidth="1.6">
      <circle cx="50" cy="50" r="44" />
      <circle cx="50" cy="50" r="36" strokeDasharray="1.5 3" />
      <path d="M50 10 L57 50 L50 90 L43 50 Z" fill={GOLD} fillOpacity="0.9" />
      <path d="M50 10 L57 50 L43 50 Z" fill={GREEN} />
      <path d="M10 50 L50 43 L90 50 L50 57 Z" fill={GOLD} fillOpacity="0.45" />
      <circle cx="50" cy="50" r="4" fill="#16161a" />
    </svg>
  );
}

// One stamp, drawn like a real customs stamp: a double ring with the place
// running round the edge, or a boxed "arrived" stamp for a city at home; a few
// shapes so a page doesn't look printed; a touch of uneven ink.
function StampMark({ s, i }: { s: Stamp; i: number }) {
  const h = hash(s.id);
  const ink = INKS[hash(s.code + s.name) % INKS.length];
  const tilt = (h % 19) - 9;
  // Scattered in a loose 2 × 3 grid, each a little off its spot.
  const col = i % 2;
  const rowN = Math.floor(i / 2);
  const dx = ((h >>> 3) % 25) - 12;
  const dy = ((h >>> 7) % 17) - 8;
  const pos = { left: `calc(${col * 50 + 25}% + ${dx}px)`, top: `calc(${rowN * 33.3 + 16.6}% + ${dy}px)` };
  const shape = s.kind === "country" ? (["circle", "circle", "oval", "octagon"] as const)[(h >>> 5) % 4] : (["box", "ticket"] as const)[(h >>> 5) % 2];
  const dash = s.byHand ? "5 3.5" : undefined;
  const when = s.byHand ? "BEEN THERE" : month(s.when);
  const id = `st-${h.toString(36)}-${i}`;
  const common = { position: "absolute" as const, ...pos, transform: `translate(-50%,-50%) rotate(${tilt}deg)`, color: ink, opacity: s.byHand ? 0.6 : 0.9 };
  const name = s.name.toUpperCase();
  if (shape === "circle" || shape === "oval") {
    const w = shape === "oval" ? 150 : 124;
    const ht = shape === "oval" ? 108 : 124;
    const rx = w / 2 - 3;
    const ry = ht / 2 - 3;
    const irx = rx - 15;
    const iry = ry - 15;
    // The words follow the ring: the place along the top, the date along the bottom.
    const top = `M ${w / 2 - irx - 7} ${ht / 2} A ${irx + 7} ${iry + 7} 0 0 1 ${w / 2 + irx + 7} ${ht / 2}`;
    const bottom = `M ${w / 2 - irx - 7} ${ht / 2} A ${irx + 7} ${iry + 7} 0 0 0 ${w / 2 + irx + 7} ${ht / 2}`;
    const fit = Math.min(10.5, (Math.PI * (irx + 7) * 0.9) / Math.max(6, name.length) / 0.68);
    return (
      <svg width={w} height={ht} viewBox={`0 0 ${w} ${ht}`} style={common} className="mix-blend-multiply" data-stamp={s.name} data-country-stamp={s.code} data-by-hand={s.byHand ? "1" : "0"} aria-label={`${s.name}, ${s.byHand ? "been there" : when}`} role="img">
        <defs>
          <path id={`${id}-t`} d={top} />
          <path id={`${id}-b`} d={bottom} />
        </defs>
        <g filter="url(#lp-ink)" fill="none" stroke="currentColor">
          <ellipse cx={w / 2} cy={ht / 2} rx={rx} ry={ry} strokeWidth="2.6" strokeDasharray={dash} />
          <ellipse cx={w / 2} cy={ht / 2} rx={irx} ry={iry} strokeWidth="1.2" strokeDasharray={dash} />
        </g>
        <g fill="currentColor" fontWeight="700" style={{ letterSpacing: "0.08em" }}>
          <text fontSize={fit}>
            <textPath href={`#${id}-t`} xlinkHref={`#${id}-t`} startOffset="50%" textAnchor="middle">
              {name}
            </textPath>
          </text>
          <text fontSize="8" dy="7">
            <textPath href={`#${id}-b`} xlinkHref={`#${id}-b`} startOffset="50%" textAnchor="middle">
              {when}
            </textPath>
          </text>
        </g>
        <text x={w / 2} y={ht / 2 + 1} textAnchor="middle" dominantBaseline="central" fontSize={shape === "oval" ? 26 : 30}>
          {s.flag}
        </text>
        {s.cities.length > 0 && (
          <text x={w / 2} y={ht / 2 + (shape === "oval" ? 21 : 24)} textAnchor="middle" fill="currentColor" fontSize="7.5" fontWeight="700">
            {s.cities.join(" · ").slice(0, 22)}
          </text>
        )}
      </svg>
    );
  }
  if (shape === "octagon") {
    const w = 124;
    const c = 36;
    const oct = (o: number) => `${c + o},${o} ${w - c - o},${o} ${w - o},${c + o} ${w - o},${w - c - o} ${w - c - o},${w - o} ${c + o},${w - o} ${o},${w - c - o} ${o},${c + o}`;
    return (
      <svg width={w} height={w} viewBox={`0 0 ${w} ${w}`} style={common} className="mix-blend-multiply" data-stamp={s.name} data-country-stamp={s.code} data-by-hand={s.byHand ? "1" : "0"} aria-label={`${s.name}, ${s.byHand ? "been there" : when}`} role="img">
        <g filter="url(#lp-ink)" fill="none" stroke="currentColor">
          <polygon points={oct(3)} strokeWidth="2.6" strokeDasharray={dash} />
          <polygon points={oct(9)} strokeWidth="1.1" strokeDasharray={dash} />
        </g>
        <text x={w / 2} y={36} textAnchor="middle" fontSize="24">
          {s.flag}
        </text>
        <text x={w / 2} y={66} textAnchor="middle" fill="currentColor" fontWeight="800" fontSize={name.length > 11 ? 9 : 12} style={{ letterSpacing: "0.06em" }}>
          {name.length > 16 ? `${name.slice(0, 15)}…` : name}
        </text>
        <line x1="30" x2={w - 30} y1="76" y2="76" stroke="currentColor" strokeWidth="1" />
        <text x={w / 2} y={90} textAnchor="middle" fill="currentColor" fontWeight="700" fontSize="8" style={{ letterSpacing: "0.14em" }}>
          {when}
        </text>
        {s.cities.length > 0 && (
          <text x={w / 2} y={102} textAnchor="middle" fill="currentColor" fontSize="7">
            {s.cities.join(" · ").slice(0, 20)}
          </text>
        )}
      </svg>
    );
  }
  // A city at home: a boxed "arrived" stamp (or a ticket with notched corners).
  const w = Math.min(150, Math.max(112, s.name.length * 9 + 40));
  const ht = 70;
  const ticket = shape === "ticket";
  return (
    <svg width={w} height={ht} viewBox={`0 0 ${w} ${ht}`} style={common} className="mix-blend-multiply" data-stamp={s.name} data-by-hand="0" aria-label={`${s.name}, ${when}`} role="img">
      <g filter="url(#lp-ink)" fill="none" stroke="currentColor">
        {ticket ? (
          <path d={`M10 2 H${w - 10} A8 8 0 0 0 ${w - 2} 10 V${ht - 10} A8 8 0 0 0 ${w - 10} ${ht - 2} H10 A8 8 0 0 0 2 ${ht - 10} V10 A8 8 0 0 0 10 2 Z`} strokeWidth="2.4" />
        ) : (
          <rect x="2" y="2" width={w - 4} height={ht - 4} rx="5" strokeWidth="2.4" />
        )}
        <rect x="7" y="7" width={w - 14} height={ht - 14} rx="3" strokeWidth="1" />
      </g>
      <g fill="currentColor" textAnchor="middle">
        <text x={w / 2} y="20" fontSize="7.5" fontWeight="700" style={{ letterSpacing: "0.2em" }}>
          ✈ ARRIVED
        </text>
        <text x={w / 2} y="41" fontSize={s.name.length > 12 ? 13 : 16} fontWeight="800" style={{ fontFamily: "var(--font-display), serif" }}>
          {s.name.length > 18 ? `${s.name.slice(0, 17)}…` : s.name}
        </text>
        <text x={w / 2} y="56" fontSize="7.5" fontWeight="700" style={{ letterSpacing: "0.16em" }}>
          {when}
        </text>
      </g>
    </svg>
  );
}

// The world, with your countries inked in (from trips) and the ones from
// before Loopin lighter. The map itself is one cached file; each country is
// drawn by pointing at its shape in it.
export function WorldMap({ index, className = "mt-2" }: { index: { code: string; name: string; trips: number }[]; className?: string }) {
  if (!(map as { ok: boolean }).ok) return null;
  return (
    <div className={`relative aspect-[2000/1001] w-full ${className}`} data-world-map={index.length}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/world.svg" alt="" aria-hidden className="absolute inset-0 h-full w-full" />
      <svg viewBox="0 0 2000 1001" className="absolute inset-0 h-full w-full" role="img" aria-label={index.length ? `Countries: ${index.map((r) => r.name).join(", ")}` : "No countries yet"}>
        {index.map((r) => (
          <use key={r.code} href={`/world.svg#${r.code}`} fill={r.trips > 0 ? "#2f7d4f" : "#7fb59a"} stroke="#efe8d6" strokeWidth="0.6" />
        ))}
      </svg>
    </div>
  );
}

function Sheet({ n, of, children, label }: { n: number; of: number; children: React.ReactNode; label: string }) {
  return (
    <section aria-label={label} aria-roledescription="page" className="relative h-full w-full shrink-0 snap-center overflow-hidden rounded-r-[14px] rounded-l-[4px] text-[#26231d]" style={paper} data-page={n}>
      {/* The fold, where the pages are sewn in. */}
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-[linear-gradient(90deg,rgba(0,0,0,0.16),transparent)]" />
      {children}
      <span className="absolute bottom-2.5 right-4 text-[11px] tabular-nums text-[#8a8270]">
        {n} / {of}
      </span>
    </section>
  );
}

export function PassportBook({ name, stats, milestones, pages, index, badges = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false); // the cover, once it has swung away
  const [at, setAt] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const total = pages.length + 3;

  useEffect(() => {
    if (!open) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => {
      setGone(true);
      requestAnimationFrame(() => strip.current?.focus({ preventScroll: true }));
    }, still ? 0 : 650);
    return () => clearTimeout(t);
  }, [open]);

  // Where the arrows aim: follows your swipes once they settle, and quick taps add up.
  const target = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onScroll = () => {
    const el = strip.current;
    if (!el) return;
    const k = Math.round(el.scrollLeft / el.clientWidth);
    setAt(k);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      target.current = k;
      busy.current = false;
    }, 160);
  };
  const busy = useRef(false); // an arrow-started turn is still going
  const go = (step: number) => {
    const el = strip.current;
    if (!el) return;
    // Start from where the page really is, unless an arrow turn is still under way.
    const from = busy.current ? target.current : Math.round(el.scrollLeft / el.clientWidth);
    clearTimeout(settle.current);
    target.current = Math.max(0, Math.min(from + step, total - 1));
    setAt(target.current);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    busy.current = !still;
    el.scrollTo({ left: target.current * el.clientWidth, behavior: still ? "auto" : "smooth" });
    settle.current = setTimeout(() => (busy.current = false), 600);
  };
  const mrz = `P<LOOPIN<<${(name || "TRAVELLER").toUpperCase().replace(/[^A-Z]+/g, "<")}`.padEnd(36, "<").slice(0, 36);

  return (
    <div className="relative" data-passport>
      {/* Uneven ink for the stamps (used by every stamp on the page). */}
      <svg width="0" height="0" className="absolute" aria-hidden>
        <filter id="lp-ink">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="0.9" />
        </filter>
      </svg>
      <div className="relative h-[480px] [perspective:1400px]">
        {/* Page edges peeking out under the book. */}
        <span aria-hidden className="absolute inset-y-2 left-1 right-[-5px] rounded-r-[14px] bg-[#d9d1bc]" />
        <span aria-hidden className="absolute inset-y-1 left-0.5 right-[-2.5px] rounded-r-[14px] bg-[#e5dec9]" />

        <div ref={strip} onScroll={onScroll} className="relative flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Passport pages" tabIndex={open ? 0 : -1}>
          {/* The photo page */}
          <Sheet n={1} of={total} label="Your details">
            <div className="flex h-full flex-col px-6 pb-8 pt-6">
              <p className="text-[11px] font-semibold tracking-[0.2em] text-[#7a7262]">LOOPIN · TRAVEL DOCUMENT</p>
              <div className="mt-4 flex gap-4">
                <div aria-hidden className="flex h-[108px] w-[86px] shrink-0 items-center justify-center rounded-[6px] border border-[#cfc6b1] bg-[#e4dcc6] font-display text-[44px] font-semibold text-[#5c564a]">
                  {([...(name.trim() || "You")][0] ?? "Y").toUpperCase()}
                </div>
                <dl className="min-w-0 space-y-2 text-[13px]">
                  <div>
                    <dt className="text-[10px] text-[#8a8270]">Name</dt>
                    <dd className="truncate font-display text-[19px] font-semibold leading-tight">{name || "You"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-[#8a8270]">Places</dt>
                    <dd className="font-semibold tabular-nums" data-passport-stats={`${stats.cities}|${stats.countries}`}>
                      {stats.countries} {stats.countries === 1 ? "country" : "countries"}, {stats.cities} {stats.cities === 1 ? "city" : "cities"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-[#8a8270]">Trips</dt>
                    <dd className="font-semibold tabular-nums">
                      {stats.trips} with Loopin{stats.thisYear ? `, ${stats.thisYear} this year` : ""}
                    </dd>
                  </div>
                </dl>
              </div>
              {milestones.length > 0 && (
                <ul className="mt-5 flex flex-wrap gap-1.5">
                  {milestones.map((m) => (
                    <li key={m} className="rounded-full border border-[#2b4c7e]/35 px-2.5 py-1 text-xs font-semibold text-[#2b4c7e]">
                      {m}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-auto text-sm text-[#7a7262]">{pages.length ? "Swipe for your stamps ›" : "No stamps yet. Your next trip earns the first one ✈️"}</p>
              <p aria-hidden className="mt-4 overflow-hidden whitespace-nowrap font-mono text-[11px] leading-[1.35] tracking-[0.04em] text-[#5c564a]/80">
                {mrz}
                <br />
                {`${String(stats.countries).padStart(2, "0")}C${String(stats.cities).padStart(3, "0")}T${String(stats.trips).padStart(3, "0")}`.padEnd(36, "<")}
              </p>
            </div>
          </Sheet>

          {/* Where you've been: the world map and the badges */}
          <Sheet n={2} of={total} label="Map and badges">
            <div className="flex h-full flex-col px-5 pb-8 pt-5">
              <p className="text-[11px] font-semibold tracking-[0.2em] text-[#8a8270]">WHERE YOU’VE BEEN</p>
              <WorldMap index={index} />
              <p className="mt-3 text-[11px] font-semibold tracking-[0.2em] text-[#8a8270]">BADGES</p>
              <ul className="mt-2 grid grid-cols-3 gap-1.5" data-badges>
                {badges.map((b) => (
                  <li key={b.id} title={b.why} className={`rounded-[10px] border px-1.5 py-1.5 text-center ${b.earned ? "border-[#2f7d4f]/40 bg-[#2f7d4f]/[0.07]" : "border-[#26231d]/10 opacity-60"}`} data-badge={b.id} data-earned={b.earned ? "1" : "0"}>
                    <span className={`block text-[20px] leading-none ${b.earned ? "" : "grayscale"}`} aria-hidden>
                      {b.emoji}
                    </span>
                    <span className="mt-0.5 block truncate text-[10.5px] font-bold leading-tight">{b.title}</span>
                    <span className="block truncate text-[9px] text-[#5c564a]">{b.earned ? b.why : `${b.have} of ${b.need}`}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Sheet>

          {/* The stamp pages */}
          {pages.map((p, k) => (
            <Sheet key={k} n={k + 3} of={total} label={`${p.title}, page ${k + 1}`}>
              <p className="absolute left-6 top-4 text-[11px] font-semibold tracking-[0.2em] text-[#8a8270]">{p.title === "Trips" ? "VISAS · STAMPS" : "BEFORE LOOPIN"}</p>
              <div className="absolute inset-x-2 bottom-7 top-12">
                {p.stamps.map((s, i) => (
                  <StampMark key={s.id} s={s} i={i} />
                ))}
              </div>
            </Sheet>
          ))}

          {/* The index at the back */}
          <Sheet n={total} of={total} label="Countries">
            <div className="flex h-full flex-col px-6 pb-9 pt-5">
              <p className="text-[11px] font-semibold tracking-[0.2em] text-[#8a8270]">COUNTRIES</p>
              {index.length === 0 ? (
                <p className="mt-6 text-sm text-[#5c564a]">Countries you visit show up here.</p>
              ) : (
                <ul className="mt-3 min-h-0 flex-1 divide-y divide-[#26231d]/10 overflow-y-auto pr-1 text-[13px]" data-passport-index>
                  {index.map((r) => (
                    <li key={r.code} className="py-1.5" data-index-country={r.code}>
                      <p className="flex items-baseline gap-2">
                        <span>{r.flag}</span>
                        <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                        <span className="shrink-0 text-[12px] text-[#5c564a]">{[r.trips ? `${r.trips} ${r.trips === 1 ? "trip" : "trips"}` : "", r.byHand ? "Been there" : ""].filter(Boolean).join(" · ")}</span>
                      </p>
                      {r.cities.length > 0 && <p className="truncate pl-7 text-[12px] text-[#7a7262]">{r.cities.join(", ")}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Sheet>
        </div>

        {/* The cover: tap to open. */}
        {!gone && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open your passport"
            className="absolute inset-0 z-20 flex origin-left flex-col items-center rounded-r-[14px] rounded-l-[4px] border border-[#2b2b31] bg-[#16161a] px-6 pt-12 text-center shadow-[0_24px_40px_-24px_rgba(0,0,0,0.9)] transition-[transform,opacity] duration-[650ms] ease-[cubic-bezier(0.3,0.7,0.2,1)] motion-reduce:transition-none"
            style={{ transform: open ? "rotateY(-105deg)" : "none", opacity: open ? 0 : 1, color: GOLD, backgroundImage: "radial-gradient(120% 80% at 30% 0%, rgba(111,227,168,0.07), transparent 55%), repeating-linear-gradient(45deg, rgba(255,255,255,0.018) 0 2px, transparent 2px 5px)" }}
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-3 bg-[linear-gradient(90deg,rgba(0,0,0,0.35),transparent)]" />
            <span className="font-display text-[15px] font-semibold tracking-[0.32em]">LOOPIN</span>
            <span className="mt-14">
              <Emblem />
            </span>
            <span className="mt-12 font-display text-[30px] font-semibold tracking-[0.28em]">PASSPORT</span>
            <span className="mt-3 h-px w-14" style={{ background: GREEN }} aria-hidden />
            <span className="mt-3 text-[13px] opacity-80">{name || "Traveller"}</span>
            <span className="mt-auto pb-8 text-sm opacity-70">Tap to open</span>
          </button>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {gone ? `Page ${at + 1} of ${total}` : ""}
      </p>
      {/* Turn the page without swiping, and where you are. */}
      {gone && (
        <div className="mt-3 flex items-center justify-between">
          <button type="button" onClick={() => go(-1)} disabled={at === 0} aria-label="Previous page" className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-lg disabled:opacity-30">
            ‹
          </button>
          {total <= 8 ? (
            <div className="flex gap-1.5" aria-hidden>
              {Array.from({ length: total }, (_, k) => (
                <span key={k} className={`h-1.5 rounded-full motion-safe:transition-all ${k === at ? "w-5 bg-fg" : "w-1.5 bg-fg/25"}`} />
              ))}
            </div>
          ) : (
            <span className="text-sm tabular-nums text-fg/60" aria-hidden>
              Page {at + 1} of {total}
            </span>
          )}
          <button type="button" onClick={() => go(1)} disabled={at >= total - 1} aria-label="Next page" className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-lg disabled:opacity-30">
            ›
          </button>
        </div>
      )}
    </div>
  );
}
