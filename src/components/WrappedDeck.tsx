"use client";

import { useEffect, useState } from "react";
import Link from "./Link";
import { GroupCover } from "./GroupCover";
import { ShareSheet } from "./ShareSheet";
import type { CoverChoice } from "@/lib/covers";
import type { Slide, SlideData } from "@/lib/wrapped";

// Trip Wrapped, as stories: tap the right side for the next slide, the left
// for the one before. Each slide is a little poster drawn from the trip's own
// numbers: the total as a giant figure, a ring for where the money went, the
// days as bars, the splurge as a receipt, the awards as cards. The first and
// last slides use the trip's photo. The last slide has Share.

const INK = "#17150f";
// A flat, bold colour per slide.
const PAPER: Record<Slide["kind"], string> = {
  intro: "#17150f",
  total: "#ffd66b",
  category: "#ff9b73",
  day: "#8ccfff",
  splurge: "#ff9fd0",
  awards: "#c3aeff",
  outro: "#17150f",
};
const KICKER: Partial<Record<Slide["kind"], string>> = {
  total: "Together you spent",
  category: "Where the money went",
  day: "The biggest day",
  splurge: "The splurge",
  awards: "And the awards go to…",
};
// The payers' bar: inks that read on yellow.
const BAR = ["#17150f", "#2b4c7e", "#a53a3a", "#2f7d4f", "#6a3d8f", "#8a5a2b"];

function Total({ d }: { d: Extract<SlideData, { kind: "total" }> }) {
  const shown = d.payers.slice(0, 5);
  return (
    <div className="flex h-full flex-col justify-center">
      <p className={`font-display font-semibold leading-[0.95] tracking-[-0.02em] ${d.amount.length > 11 ? "text-[54px]" : "text-[68px]"}`} data-wrapped-headline>
        {d.amount}
      </p>
      <p className="mt-3 font-hand text-[26px] font-bold">About {d.each} each</p>
      {shown.length > 1 && (
        <div className="mt-9">
          <p className="mb-2 text-sm font-semibold">Who paid up front</p>
          <div className="flex h-5 overflow-hidden rounded-full bg-[#17150f]/10">
            {shown.map((p, k) => (
              <span key={p.name} style={{ width: `${Math.max(3, p.share * 100)}%`, background: BAR[k % BAR.length] }} />
            ))}
          </div>
          <ul className="mt-3 space-y-1.5 text-[15px]">
            {shown.map((p, k) => (
              <li key={p.name} className="flex items-center gap-2.5">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: BAR[k % BAR.length] }} />
                <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                <span className="tabular-nums">{p.amount}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Category({ d }: { d: Extract<SlideData, { kind: "category" }> }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="relative h-[210px] w-[210px]">
        <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="90" cy="90" r={r} fill="none" stroke={INK} strokeOpacity="0.14" strokeWidth="26" />
          <circle cx="90" cy="90" r={r} fill="none" stroke={INK} strokeWidth="26" strokeDasharray={`${(d.pct / 100) * c} ${c}`} strokeLinecap="butt" className="lp-ring" />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[34px] leading-none" aria-hidden>
            {d.emoji}
          </span>
          <span className="font-display text-[44px] font-semibold leading-none tabular-nums">{d.pct}%</span>
        </span>
      </div>
      <p className="mt-6 font-display text-[34px] font-semibold leading-tight" data-wrapped-headline>
        {d.label}
      </p>
      {d.rest.length > 0 && (
        <ul className="mt-5 w-full max-w-[280px] space-y-1.5 text-left text-[15px]">
          {d.rest.map((x) => (
            <li key={x.label} className="flex items-center gap-2.5">
              <span aria-hidden>{x.emoji}</span>
              <span className="min-w-0 flex-1 truncate">{x.label}</span>
              <span className="font-semibold tabular-nums">{x.pct}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Day({ d }: { d: Extract<SlideData, { kind: "day" }> }) {
  const thin = d.days.length > 10;
  return (
    <div className="flex h-full flex-col justify-center">
      <p className="font-display text-[64px] font-semibold leading-[0.95] tracking-[-0.02em]" data-wrapped-headline>
        {d.label}
      </p>
      <p className="mt-3 font-hand text-[26px] font-bold">{d.amount} that day</p>
      <div className="mt-10 flex h-[150px] items-end gap-[5px]" aria-hidden>
        {d.days.map((x, k) => (
          <span key={k} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
            <span className="lp-bar w-full rounded-t-[6px]" style={{ height: `${Math.max(4, x.share * 100)}%`, background: INK, opacity: x.big ? 1 : 0.22, animationDelay: `${k * 35}ms` }} />
            {(!thin || x.big) && <span className={`whitespace-nowrap text-[10px] ${x.big ? "font-bold" : ""}`}>{d.days.length <= 5 ? x.label : x.label.split(" ")[1]}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function Splurge({ d }: { d: Extract<SlideData, { kind: "splurge" }> }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div
        className="lp-receipt w-[78%] max-w-[300px] -rotate-[4deg] bg-[#fffdf6] px-6 pb-9 pt-6 font-mono text-[13px] text-[#2a2620] shadow-[0_26px_40px_-18px_rgba(0,0,0,0.55)]"
        style={{ WebkitMaskImage: "radial-gradient(circle at 8px 100%, transparent 7px, #000 7.5px)", WebkitMaskSize: "16px 100%", maskImage: "radial-gradient(circle at 8px 100%, transparent 7px, #000 7.5px)", maskSize: "16px 100%" }}
      >
        <p className="text-center text-[11px] tracking-[0.25em]">LOOPIN</p>
        <p className="mt-0.5 text-center text-[11px]">{d.date}</p>
        <p className="mt-4 border-t border-dashed border-[#2a2620]/40 pt-3 text-[11px] text-[#2a2620]/60">{d.category}</p>
        <p className="mt-1 break-words font-display text-[24px] font-semibold leading-tight" data-wrapped-headline>
          {d.description}
        </p>
        <p className="mt-5 flex items-baseline justify-between border-t border-dashed border-[#2a2620]/40 pt-3">
          <span>TOTAL</span>
          <span className="text-[20px] font-bold tabular-nums">{d.amount}</span>
        </p>
        <p className="mt-2 flex justify-between text-[12px]">
          <span>PAID BY</span>
          <span className="font-bold">{d.payer.toUpperCase()}</span>
        </p>
        <p className="mt-5 text-center text-[11px] tracking-[0.2em] text-[#2a2620]/50">THANK YOU, COME AGAIN</p>
      </div>
    </div>
  );
}

function Awards({ d }: { d: Extract<SlideData, { kind: "awards" }> }) {
  const shown = d.awards.slice(0, 8);
  const tilt = [-3, 2.5, -1.5, 3, -2.5, 1.5, -2, 2];
  return (
    <div className="flex h-full flex-col justify-center">
      <ul className={`grid gap-3 ${shown.length > 2 ? "grid-cols-2" : "grid-cols-1"}`} data-wrapped-headline>
        {shown.map((a, k) => (
          <li key={a.title + a.name} className="lp-card rounded-[16px] bg-[#fffdf6] px-3.5 py-3 text-[#17150f] shadow-[0_14px_24px_-14px_rgba(0,0,0,0.6)]" style={{ transform: `rotate(${tilt[k % tilt.length]}deg)`, animationDelay: `${k * 70}ms` }}>
            <span className="text-[26px] leading-none" aria-hidden>
              {a.emoji}
            </span>
            <span className="mt-1 block font-display text-[15px] font-semibold leading-tight">{a.title}</span>
            <span className="block truncate font-hand text-[20px] font-bold leading-tight text-[#6a3d8f]">{a.name}</span>
            {shown.length <= 4 && <span className="mt-0.5 block text-[11px] leading-snug text-[#17150f]/60">{a.why}</span>}
          </li>
        ))}
      </ul>
      {d.awards.length > shown.length && <p className="mt-3 text-center text-sm font-semibold">+{d.awards.length - shown.length} more on Balances</p>}
    </div>
  );
}

export function WrappedDeck({
  slides,
  photo,
  cover,
  groupId,
  groupName,
  settleHref,
}: {
  slides: Slide[];
  photo?: string;
  cover: { kind: string; src?: string };
  groupId: string;
  groupName: string;
  settleHref?: string;
}) {
  const [i, setI] = useState(0);
  const last = i === slides.length - 1;
  const s = slides[i];
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, slides.length - 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [slides.length]);

  const photoBg = s.kind === "intro" || s.kind === "outro" || !s.data;
  const fg = photoBg ? "#f7f4ec" : INK;
  return (
    <section
      aria-label={`${groupName}, wrapped`}
      className="relative -mx-5 -mt-2 h-[calc(100dvh-150px)] min-h-[560px] overflow-hidden rounded-none transition-colors duration-300 sm:mx-0 sm:rounded-[24px]"
      style={{ background: PAPER[s.kind], color: fg }}
      data-wrapped-slide={s.kind}
    >
      {photoBg &&
        (photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" aria-hidden className="lp-drift absolute inset-0 h-full w-full object-cover" />
        ) : (
          <GroupCover kind={cover.kind as CoverChoice} src={cover.src} uid={`wr-${groupId}`} sizes="448px" drift />
        ))}
      {photoBg && <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.45)_0%,transparent_25%,transparent_45%,rgba(0,0,0,0.85)_100%)]" />}

      <div className="absolute inset-x-3 top-3 z-20 flex gap-1" aria-hidden>
        {slides.map((x, k) => (
          <span key={k} className="h-[3px] flex-1 rounded-full" style={{ background: fg, opacity: k <= i ? 1 : 0.28 }} />
        ))}
      </div>

      <button type="button" aria-label="Previous" onClick={() => setI((x) => Math.max(x - 1, 0))} className="absolute inset-y-0 left-0 z-10 w-1/3" />
      {!last && <button type="button" aria-label="Next" onClick={() => setI((x) => x + 1)} className="absolute inset-y-0 right-0 z-10 w-2/3" />}

      {/* The words let taps through (for next); only the buttons on the last slide catch them. */}
      {photoBg ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-6 pb-7">
          <p className="font-display text-[38px] font-semibold leading-[1.02]" data-wrapped-headline>
            {s.headline}
          </p>
          <p className="mt-2 whitespace-pre-line font-hand text-[24px] font-bold leading-snug text-[#ffd9a8]">{s.line}</p>
          {last ? (
            <div className="pointer-events-auto relative z-30 mt-6 space-y-2.5">
              <ShareSheet
                image={`/groups/${groupId}/wrapped-image`}
                fileName="wrapped.png"
                title="Share the Wrapped"
                words={`${groupName}, wrapped 🎬`}
                label="Share it"
                className="pop block w-full bg-[#f4f1e8] px-4 py-3.5 text-center text-base font-semibold text-[#14130f] [--pop-edge:#6e6b63]"
              />
              <Link href={settleHref ?? `/groups/${groupId}`} className="block py-2 text-center text-sm font-semibold text-[#f7f4ec]/80 underline underline-offset-4">
                {settleHref ? "Settle up" : `Back to ${groupName}`}
              </Link>
            </div>
          ) : (
            <p className="mt-6 text-center text-xs text-[#f7f4ec]/55">Tap for more</p>
          )}
        </div>
      ) : (
        <div key={i} className="lp-slide-in pointer-events-none absolute inset-0 z-20 flex flex-col px-6 pb-6 pt-11">
          <p className="font-display text-[19px] font-semibold">{KICKER[s.kind]}</p>
          <div className="min-h-0 flex-1">
            {s.data?.kind === "total" && <Total d={s.data} />}
            {s.data?.kind === "category" && <Category d={s.data} />}
            {s.data?.kind === "day" && <Day d={s.data} />}
            {s.data?.kind === "splurge" && <Splurge d={s.data} />}
            {s.data?.kind === "awards" && <Awards d={s.data} />}
          </div>
          <p className="text-center text-xs opacity-55">Tap for more</p>
        </div>
      )}
    </section>
  );
}
