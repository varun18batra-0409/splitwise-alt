"use client";

import { useEffect, useRef, useState } from "react";
import { visibleBadges, type Badge, type IndexRow, type PassportCounts, type Stamp } from "@/lib/passport";
import { BadgeIcon } from "@/components/PassportIcons";
import { StampArt, stampInk } from "@/components/stamps/StampArt";
import map from "@/generated/map.json";

// The trip passport as a little booklet. A cover in Loopin's colours you tap to open, then
// pages you swipe like a real passport: the photo page with your counts, the
// stamp pages (six stamps a page, each inked at a slant: the same drawing as the share picture), and an index at the back.

// The cover in Loopin's own colours: the dark surface and off-white foil. No green: that is for money.
const GOLD = "#ece8dc";
const PAPER = "#efe8d6";

type Page = { title: string; stamps: Stamp[] };
type Props = {
  name: string;
  stats: { cities: number; countries: number; trips: number; thisYear: number; abroad?: number };
  counts: PassportCounts; // the one set of numbers (passportCounts): the cover and the first page both read it
  milestones: string[];
  pages: Page[];
  index: IndexRow[];
  badges?: Badge[];
  own?: boolean; // your own passport (or a friend's)
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
      <path d="M50 10 L57 50 L43 50 Z" fill={GOLD} />
      <path d="M10 50 L50 43 L90 50 L50 57 Z" fill={GOLD} fillOpacity="0.45" />
      <circle cx="50" cy="50" r="4" fill="#16161a" />
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
          <use key={r.code} href={`/world.svg#${r.code}`} fill={r.trips > 0 ? "#26231d" : "#a79f8c"} stroke="#efe8d6" strokeWidth="0.6" />
        ))}
      </svg>
    </div>
  );
}

// A country's small picture on the index page, or (no photo) a drawn ring with its code.
function IndexPhoto({ r }: { r: IndexRow }) {
  if (r.photo)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={r.photo} alt="" width={28} height={28} loading="lazy" className="h-7 w-7 shrink-0 rounded-[6px] object-cover" />;
  const ink = stampInk(r.code, r.name);
  return (
    <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[9px] font-extrabold" style={{ color: ink, borderColor: ink }}>
      {r.code}
    </span>
  );
}

function Sheet({ n, children, label }: { n: number; of?: number; children: React.ReactNode; label: string }) {
  return (
    <section aria-label={label} aria-roledescription="page" className="relative h-full w-full shrink-0 snap-center overflow-hidden rounded-r-[14px] rounded-l-[4px] text-[#26231d]" style={paper} data-page={n}>
      {/* The fold, where the pages are sewn in. */}
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-[linear-gradient(90deg,rgba(0,0,0,0.16),transparent)]" />
      {children}
      {/* No "1 / 5" here: the dots under the book are the one page indicator. */}
    </section>
  );
}

export function PassportBook({ name, stats, counts, milestones, pages, index, badges = [], own = true }: Props) {
  const shownMilestones = milestones.filter((m) => !/\b\d+\s+(countries|trips)\b/i.test(m));
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
      <div className="relative h-[480px] [perspective:1400px]">
        {/* Page edges peeking out under the book. */}
        <span aria-hidden className="absolute inset-y-2 left-1 right-[-5px] rounded-r-[14px] bg-[#d9d1bc]" />
        <span aria-hidden className="absolute inset-y-1 left-0.5 right-[-2.5px] rounded-r-[14px] bg-[#e5dec9]" />

        <div ref={strip} onScroll={onScroll} className="relative flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Passport pages" tabIndex={0}>
          {/* The photo page */}
          <Sheet n={1} of={total} label="Your details">
            <div className="flex h-full flex-col px-6 pb-8 pt-6">
              <p className="text-[12px] font-semibold text-[#7a7262]">Loopin travel document</p>
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
                    <dd className="font-semibold tabular-nums" data-passport-stats={`${counts.cities}|${counts.countries}`}>
                      {[counts.countries ? `${counts.countries} ${counts.countries === 1 ? "country" : "countries"}${stats.abroad && stats.abroad < counts.countries ? ` (${stats.abroad} abroad)` : ""}` : "", counts.cities ? `${counts.cities} ${counts.cities === 1 ? "city" : "cities"}` : ""].filter(Boolean).join(", ") || "Your first stamp is coming"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-[#8a8270]">Trips</dt>
                    <dd className="font-semibold tabular-nums">
                      {counts.trips ? `${counts.trips} with Loopin${stats.thisYear ? `, ${stats.thisYear} this year` : ""}` : "None yet. Start one!"}
                    </dd>
                  </div>
                </dl>
              </div>
              {/* The counts, big, as soon as the passport opens. */}
              <dl className="mt-5 grid grid-cols-3 border-y border-[#26231d]/15 py-3 text-center" data-passport-counts={`${counts.countries}|${counts.stamps}|${counts.trips}`}>
                {(
                  [
                    [counts.countries, counts.countries === 1 ? "country" : "countries"],
                    [counts.stamps, counts.stamps === 1 ? "stamp" : "stamps"],
                    [counts.trips, counts.trips === 1 ? "trip" : "trips"],
                  ] as const
                ).map(([n, label], i) => (
                  <div key={label} className={`flex flex-col-reverse ${i ? "border-l border-[#26231d]/12" : ""}`}>
                    <dt className="mt-1 text-[11px] font-semibold text-[#7a7262]">{label}</dt>
                    <dd className="font-display text-[32px] font-semibold leading-none tabular-nums text-[#26231d]">{n}</dd>
                  </div>
                ))}
              </dl>
              {/* Chips that only repeat the big counts above ("5 countries", "3 trips this year") are left out. */}
              {shownMilestones.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-1.5" data-passport-chips>
                  {shownMilestones.map((m) => (
                    <li key={m} className="rounded-full border border-[#2b4c7e]/35 px-2.5 py-1 text-xs font-semibold text-[#2b4c7e]">
                      {m}
                    </li>
                  ))}
                </ul>
              )}
              {pages.length === 0 ? <p className="mt-auto text-sm text-[#7a7262]">No stamps yet. Your next trip earns the first one.</p> : <span className="mt-auto" />}
              <p aria-hidden className="mt-4 overflow-hidden whitespace-nowrap font-mono text-[11px] leading-[1.35] tracking-[0.04em] text-[#5c564a]/80">
                {mrz}
                <br />
                {`${String(counts.countries).padStart(2, "0")}C${String(counts.cities).padStart(3, "0")}T${String(counts.trips).padStart(3, "0")}`.padEnd(36, "<")}
              </p>
            </div>
          </Sheet>

          {/* Where you've been: the world map and the badges */}
          <Sheet n={2} of={total} label="Map and badges">
            <div className="flex h-full flex-col px-5 pb-8 pt-5">
              <p className="text-[12px] font-semibold text-[#8a8270]">{own ? "Where you’ve been" : `Where ${name || "they"} has been`}</p>
              <WorldMap index={index} />
              <p className="mt-3 text-[12px] font-semibold text-[#8a8270]">Badges</p>
              <ul className="mt-2 grid grid-cols-3 gap-1.5" data-badges>
                {visibleBadges(badges).map((b) => (
                  <li key={b.id} title={b.why} className={`rounded-[10px] border px-1.5 py-1.5 text-center ${b.earned ? "border-[#26231d]/40 bg-[#26231d]/[0.07]" : "border-[#26231d]/10 opacity-60"}`} data-badge={b.id} data-earned={b.earned ? "1" : "0"}>
                    <span className="flex h-5 justify-center text-[#26231d]">
                      <BadgeIcon id={b.id} size={20} />
                    </span>
                    <span className="mt-0.5 block text-[10px] font-bold leading-[1.15]">{b.title}</span>
                    <span className="block truncate text-[9px] text-[#5c564a]">{b.earned ? b.why : `${b.have} of ${b.need}`}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Sheet>

          {/* The stamp pages */}
          {pages.map((p, k) => (
            <Sheet key={k} n={k + 3} of={total} label={`${p.title}, page ${k + 1}`}>
              <p className="absolute left-6 top-4 text-[12px] font-semibold text-[#8a8270]">Visas and stamps</p>
              {/* Six to a page, two across, each at its own slant. */}
              <div className="absolute inset-x-3 bottom-7 top-12 grid grid-cols-2 grid-rows-3 place-items-center" data-stamp-page>
                {p.stamps.map((s) => (
                  <StampArt key={s.id} s={s} size={108} />
                ))}
              </div>
            </Sheet>
          ))}

          {/* The index at the back */}
          <Sheet n={total} of={total} label="Countries">
            <div className="flex h-full flex-col px-6 pb-9 pt-5">
              <p className="text-[12px] font-semibold text-[#8a8270]">Countries</p>
              {index.length === 0 ? (
                <p className="mt-6 text-sm text-[#5c564a]">Countries you visit show up here.</p>
              ) : (
                <ul className="mt-3 min-h-0 flex-1 divide-y divide-[#26231d]/10 overflow-y-auto pr-1 text-[13px]" data-passport-index>
                  {index.map((r) => (
                    <li key={r.code} className="py-1.5" data-index-country={r.code}>
                      <p className="flex items-center gap-2">
                        <IndexPhoto r={r} />
                        <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                        <span className="shrink-0 text-[12px] text-[#5c564a]">{[r.trips ? `${r.trips} ${r.trips === 1 ? "trip" : "trips"}` : "", r.byHand ? "Been there" : ""].filter(Boolean).join(" · ")}</span>
                      </p>
                      {r.cities.length > 0 && <p className="truncate pl-9 text-[12px] text-[#7a7262]">{r.cities.join(", ")}</p>}
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
            style={{ transform: open ? "rotateY(-105deg)" : "none", opacity: open ? 0 : 1, color: GOLD, backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,0.018) 0 2px, transparent 2px 5px)" }}
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-3 bg-[linear-gradient(90deg,rgba(0,0,0,0.35),transparent)]" />
            <span className="font-display text-[15px] font-semibold tracking-[0.32em]">LOOPIN</span>
            <span className="mt-14">
              <Emblem />
            </span>
            <span className="mt-12 font-display text-[30px] font-semibold tracking-[0.28em]">PASSPORT</span>
            <span className="mt-3 h-px w-14" style={{ background: GOLD }} aria-hidden />
            <span className="mt-3 text-[13px] opacity-80">{name || "Traveller"}</span>
            {(counts.countries > 0 || counts.stamps > 0) && (
              <span className="mt-6 text-[13px] font-semibold tracking-[0.06em] opacity-90" data-cover-counts={`${counts.countries}|${counts.stamps}`}>
                {counts.countries} {counts.countries === 1 ? "country" : "countries"}, {counts.stamps} {counts.stamps === 1 ? "stamp" : "stamps"}
              </span>
            )}
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
