"use client";

import { useEffect, useRef, useState } from "react";
import type { IndexRow, Stamp } from "@/lib/passport";

// The trip passport as a little booklet. A navy cover you tap to open, then
// pages you swipe like a real passport: the photo page with your counts, the
// stamp pages (one stamp per trip, inked at a slant), and an index at the back.

const INKS = ["#2b4c7e", "#a53a3a", "#2f7d4f", "#6a3d8f", "#8a5a2b", "#1f6f78"];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const month = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase() : "");
const GOLD = "#d8bd7a";
const PAPER = "#efe8d6";

type Page = { title: string; stamps: Stamp[] };
type Props = {
  name: string;
  stats: { cities: number; countries: number; trips: number; thisYear: number };
  milestones: string[];
  pages: Page[];
  index: IndexRow[];
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
      <path d="M50 10 L57 50 L50 90 L43 50 Z" fill={GOLD} fillOpacity="0.85" />
      <path d="M10 50 L50 43 L90 50 L50 57 Z" fill={GOLD} fillOpacity="0.45" />
      <circle cx="50" cy="50" r="4" fill="#1d2a44" />
    </svg>
  );
}

function StampMark({ s, i }: { s: Stamp; i: number }) {
  const h = hash(s.id);
  const ink = INKS[hash(s.code + s.name) % INKS.length];
  const tilt = (h % 17) - 8;
  // Scattered in a loose 2 × 3 grid, each a little off its spot.
  const col = i % 2;
  const rowN = Math.floor(i / 2);
  const dx = ((h >> 3) % 25) - 12;
  const dy = ((h >> 7) % 21) - 10;
  const pos = { left: `calc(${col * 50 + 25}% + ${dx}px)`, top: `calc(${rowN * 33.3 + 16.6}% + ${dy}px)` };
  const common = "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center text-center mix-blend-multiply";
  if (s.kind === "country")
    return (
      <div
        className={`${common} h-[118px] w-[118px] rounded-full ${s.byHand ? "border-[2.5px] border-dashed opacity-55" : "border-[3px]"}`}
        style={{ ...pos, borderColor: ink, color: ink, transform: `translate(-50%,-50%) rotate(${tilt}deg)`, boxShadow: s.byHand ? undefined : `inset 0 0 0 4px ${PAPER}, inset 0 0 0 5.5px ${ink}` }}
        data-stamp={s.name}
        data-country-stamp={s.code}
        data-by-hand={s.byHand ? "1" : "0"}
      >
        <span className="text-[28px] leading-none">{s.flag}</span>
        <span className="mt-1 max-w-[94px] font-display text-[14px] font-bold leading-tight">{s.name}</span>
        {s.cities.length > 0 && <span className="max-w-[90px] truncate text-[9px] font-semibold">{s.cities.join(" · ")}</span>}
        <span className="mt-0.5 text-[9px] font-semibold tracking-[0.14em]">{s.byHand ? "BEEN THERE" : month(s.when)}</span>
      </div>
    );
  return (
    <div
      className={`${common} min-w-[112px] max-w-[150px] rounded-[8px] border-[2.5px] px-3 py-2`}
      style={{ ...pos, borderColor: ink, color: ink, transform: `translate(-50%,-50%) rotate(${tilt}deg)` }}
      data-stamp={s.name}
      data-by-hand="0"
    >
      <span className="text-[9px] font-semibold tracking-[0.14em]">ARRIVED</span>
      <span className="font-display text-[17px] font-bold leading-tight">{s.name}</span>
      <span className="mt-0.5 border-t pt-0.5 text-[9px] font-semibold tracking-[0.14em]" style={{ borderColor: ink }}>
        {month(s.when)}
      </span>
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

export function PassportBook({ name, stats, milestones, pages, index }: Props) {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false); // the cover, once it has swung away
  const [at, setAt] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const total = pages.length + 2;

  useEffect(() => {
    if (!open) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => setGone(true), still ? 0 : 650);
    return () => clearTimeout(t);
  }, [open]);

  const onScroll = () => {
    const el = strip.current;
    if (el) setAt(Math.round(el.scrollLeft / el.clientWidth));
  };
  const go = (k: number) => {
    const el = strip.current;
    if (el) el.scrollTo({ left: Math.max(0, Math.min(k, total - 1)) * el.clientWidth, behavior: "smooth" });
  };
  const mrz = `P<LOOPIN<<${(name || "TRAVELLER").toUpperCase().replace(/[^A-Z]+/g, "<")}`.padEnd(44, "<").slice(0, 44);

  return (
    <div className="relative" data-passport>
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
                  {(name || "Y").slice(0, 1).toUpperCase()}
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
              <p aria-hidden className="mt-4 break-all font-mono text-[11px] leading-[1.35] tracking-[0.08em] text-[#5c564a]/80">
                {mrz}
                <br />
                {`${String(stats.countries).padStart(2, "0")}C${String(stats.cities).padStart(3, "0")}T${String(stats.trips).padStart(3, "0")}`.padEnd(44, "<")}
              </p>
            </div>
          </Sheet>

          {/* The stamp pages */}
          {pages.map((p, k) => (
            <Sheet key={k} n={k + 2} of={total} label={`${p.title}, page ${k + 1}`}>
              <p className="absolute left-6 top-4 text-[11px] font-semibold tracking-[0.2em] text-[#8a8270]">{p.title === "Trips" ? "VISAS · STAMPS" : "BEFORE LOOPIN"}</p>
              <div className="absolute inset-x-2 bottom-8 top-10">
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
            className="absolute inset-0 z-20 flex origin-left flex-col items-center rounded-r-[14px] rounded-l-[4px] bg-[#1d2a44] px-6 pt-12 text-center shadow-[0_24px_40px_-24px_rgba(0,0,0,0.9)] transition-[transform,opacity] duration-[650ms] ease-[cubic-bezier(0.3,0.7,0.2,1)] motion-reduce:transition-none"
            style={{ transform: open ? "rotateY(-105deg)" : "none", opacity: open ? 0 : 1, color: GOLD, backgroundImage: "radial-gradient(120% 80% at 30% 0%, rgba(255,255,255,0.06), transparent 60%), repeating-linear-gradient(45deg, rgba(0,0,0,0.05) 0 2px, transparent 2px 5px)" }}
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-3 bg-[linear-gradient(90deg,rgba(0,0,0,0.35),transparent)]" />
            <span className="font-display text-[15px] font-semibold tracking-[0.32em]">LOOPIN</span>
            <span className="mt-14">
              <Emblem />
            </span>
            <span className="mt-12 font-display text-[30px] font-semibold tracking-[0.28em]">PASSPORT</span>
            <span className="mt-2 text-[13px] opacity-80">{name || "Traveller"}</span>
            <span className="mt-auto pb-8 text-sm opacity-70">Tap to open</span>
          </button>
        )}
      </div>

      {/* Turn the page without swiping, and where you are. */}
      {gone && (
        <div className="mt-3 flex items-center justify-between">
          <button type="button" onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous page" className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-lg disabled:opacity-30">
            ‹
          </button>
          {total <= 8 ? (
            <div className="flex gap-1.5" aria-hidden>
              {Array.from({ length: total }, (_, k) => (
                <span key={k} className={`h-1.5 rounded-full transition-all ${k === at ? "w-5 bg-fg" : "w-1.5 bg-fg/25"}`} />
              ))}
            </div>
          ) : (
            <span className="text-sm tabular-nums text-fg/60" aria-hidden>
              Page {at + 1} of {total}
            </span>
          )}
          <button type="button" onClick={() => go(at + 1)} disabled={at >= total - 1} aria-label="Next page" className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-lg disabled:opacity-30">
            ›
          </button>
        </div>
      )}
    </div>
  );
}
