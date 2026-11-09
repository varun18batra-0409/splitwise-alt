import Link from "@/components/Link";
import Image from "next/image";
import { GroupCover } from "./GroupCover";
import type { Highlight, HighlightTone } from "@/lib/home/highlights";

// One of the sliding cards at the top of Home: words on the left, a place
// photo (or a small drawn object) on the right, one button.

const TONE: Record<HighlightTone, { bg: string; fade: string; eyebrow: string }> = {
  trip: { bg: "#0f1416", fade: "15,20,22", eyebrow: "#a8d8f0" },
  sky: { bg: "#0d1b26", fade: "13,27,38", eyebrow: "#9fd3ff" },
  warm: { bg: "#1d140e", fade: "29,20,14", eyebrow: "#e2bf95" },
  teal: { bg: "#0f1d1c", fade: "15,29,28", eyebrow: "#8fd9c4" },
  rose: { bg: "#1f1015", fade: "31,16,21", eyebrow: "#f0b2bf" },
  night: { bg: "#120a10", fade: "18,10,16", eyebrow: "#ffc93c" },
  paper: { bg: "#18150f", fade: "24,21,15", eyebrow: "#e6d3a3" },
};

const button =
  "inline-flex h-10 items-center self-start rounded-full border border-fg/25 bg-fg/[0.12] px-[18px] text-sm font-semibold text-fg backdrop-blur active:bg-fg/20";

export function HighlightCard({ h }: { h: Extract<Highlight, { kind: "card" }> }) {
  const t = TONE[h.tone];
  const picture = h.photo || h.cover;
  return (
    <div className="relative flex h-[268px] flex-col overflow-hidden px-5 pb-12 pt-5" style={{ background: t.bg }} data-highlight={h.id}>
      {h.photo ? (
        <div className="absolute inset-y-0 left-[38%] right-0">
          <Image src={h.photo} alt="" fill sizes="(max-width: 480px) 65vw, 320px" className="object-cover" />
        </div>
      ) : h.cover ? (
        <div className="absolute inset-y-0 left-[38%] w-[75%]">
          <GroupCover kind={h.cover} uid={`hl-${h.id}`} />
        </div>
      ) : null}
      {picture && <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(90deg, rgb(${t.fade}) 34%, rgba(${t.fade},0.55) 62%, rgba(${t.fade},0) 92%)` }} />}
      {!picture && h.art && <Art kind={h.art} />}
      {picture && h.art && ["sun", "rain", "cloud", "snow"].includes(h.art) && (
        <span aria-hidden className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/35 backdrop-blur">
          <WeatherIcon kind={h.art} />
        </span>
      )}
      <p className="relative max-w-[66%] truncate text-sm" style={{ color: t.eyebrow }}>
        {h.eyebrow}
      </p>
      <p className="relative mt-1 max-w-[64%] font-display text-[25px] font-semibold leading-[1.1]">{h.title}</p>
      <p className="relative mt-auto line-clamp-3 max-w-[62%] text-[13px] leading-snug text-gray-700">{h.text}</p>
      <Link href={h.href} className={`relative mt-3 ${button}`}>
        {h.button}
      </Link>
    </div>
  );
}

function WeatherIcon({ kind }: { kind: string }) {
  const s = { fill: "none", stroke: "#f4f2ec", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" {...s}>
      {kind === "sun" && (
        <>
          <circle cx="12" cy="12" r="4.2" fill="#ffd27a" stroke="#ffd27a" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <path key={a} d="M12 3.2v2" stroke="#ffd27a" transform={`rotate(${a} 12 12)`} />
          ))}
        </>
      )}
      {kind !== "sun" && <path d="M7 17.5h10a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 7.8 9.6 4 4 0 0 0 7 17.5z" fill="rgba(244,242,236,0.15)" />}
      {kind === "rain" && <path d="M9 19.5l-.8 2M13 19.5l-.8 2M17 19.5l-.8 2" stroke="#9fd3ff" />}
      {kind === "snow" && <path d="M9 20.5h.01M12.5 21.5h.01M16 20.5h.01" strokeWidth={2.4} />}
    </svg>
  );
}

// Small drawn objects for cards without a place photo.
function Art({ kind }: { kind: string }) {
  if (kind === "postcard")
    return (
      <div aria-hidden className="absolute right-4 top-9">
        <div className="relative h-[96px] w-[136px] rotate-[7deg] bg-[#f3eee2] shadow-[0_18px_30px_-12px_rgba(0,0,0,0.9)]">
          <div className="absolute bottom-3 left-[52%] top-3 w-px bg-[#d8d0bd]" />
          <div className="absolute right-2.5 top-2.5 h-[34px] w-[28px] border border-[#7b2d26] bg-[repeating-linear-gradient(0deg,rgba(123,45,38,0.16)_0_1px,transparent_1px_3px)] outline outline-2 outline-offset-2 outline-dotted outline-[#e8e0cc]" />
          <div className="absolute right-9 top-4 h-7 w-7 rounded-full border border-[#5b5a63]/50" />
          <div className="absolute bottom-4 right-3 space-y-2">
            <div className="h-px w-14 bg-[#cfc6b1]" />
            <div className="h-px w-14 bg-[#cfc6b1]" />
          </div>
          <div className="absolute left-3 top-3 space-y-1.5">
            <div className="h-[3px] w-12 rounded bg-[#2b3a67]/45" />
            <div className="h-[3px] w-10 rounded bg-[#2b3a67]/45" />
            <div className="h-[3px] w-11 rounded bg-[#2b3a67]/45" />
          </div>
          <span className="absolute -bottom-3 left-5 h-9 w-9 rounded-full bg-[radial-gradient(circle_at_35%_30%,#c44a3d,#7d1d16_70%)] shadow-[0_3px_6px_rgba(0,0,0,0.5)]" />
        </div>
      </div>
    );
  if (kind === "passport")
    return (
      <div aria-hidden className="absolute right-6 top-7">
        <div className="relative flex h-[128px] w-[92px] -rotate-[8deg] flex-col items-center rounded-[6px] bg-[linear-gradient(160deg,#1f2b4a,#141c33)] pt-5 shadow-[0_18px_30px_-12px_rgba(0,0,0,0.95)]">
          <span className="text-[7px] font-semibold tracking-[0.25em] text-[#d9bf7a]">PASSPORT</span>
          <span className="mt-3 flex h-9 w-9 items-center justify-center rounded-full border border-[#d9bf7a]/80">
            <span className="h-5 w-5 rounded-full border border-[#d9bf7a]/60" />
          </span>
          <span className="mt-3 text-[6px] tracking-[0.2em] text-[#d9bf7a]/80">LOOPIN</span>
        </div>
        <span className="absolute -right-3 bottom-1 flex h-14 w-14 rotate-[12deg] items-center justify-center rounded-full border-2 border-[#a53a3a] text-[7px] font-bold tracking-[0.12em] text-[#e07a6e] mix-blend-screen">
          ARRIVED
        </span>
      </div>
    );
  if (kind === "bill")
    return (
      <div aria-hidden className="absolute right-7 top-8 flex h-[118px] w-[86px] rotate-[6deg] flex-col gap-[8px] bg-[#ece8dd] px-3 pt-4 shadow-[0_18px_30px_-12px_rgba(0,0,0,0.9)] [clip-path:polygon(0_0,100%_0,100%_100%,90%_96%,80%_100%,70%_96%,60%_100%,50%_96%,40%_100%,30%_96%,20%_100%,10%_96%,0_100%)]">
        <span className="h-1 w-3/4 rounded bg-[#b9b3a5]" />
        <span className="h-1 rounded bg-[#b9b3a5]" />
        <span className="h-1 w-1/2 rounded bg-[#b9b3a5]" />
        <span className="mt-2 h-[3px] w-full bg-[#2a2620]/70" />
        <span className="h-1 w-2/3 self-end rounded bg-[#2a2620]/60" />
      </div>
    );
  // switch: two sheets, the second ticked
  return (
    <>
      <div aria-hidden className="absolute right-7 top-7 flex h-[92px] w-[72px] -rotate-[10deg] flex-col gap-[7px] rounded-md bg-[#e9e5da] px-2.5 py-3 shadow-xl shadow-black/50">
        <span className="h-1 rounded bg-[#b9b3a5]" />
        <span className="h-1 w-2/3 rounded bg-[#b9b3a5]" />
        <span className="h-1 rounded bg-[#b9b3a5]" />
      </div>
      <div aria-hidden className="absolute right-3 top-12 flex h-[92px] w-[72px] rotate-[8deg] flex-col gap-[7px] rounded-md bg-fg px-2.5 py-3 shadow-xl shadow-black/50">
        <span className="h-1 rounded bg-[#c9c3b5]" />
        <span className="h-1 w-3/5 rounded bg-[#c9c3b5]" />
        <span className="mt-auto flex h-5 w-5 items-center justify-center self-end rounded-full bg-meter-up">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
      </div>
    </>
  );
}
