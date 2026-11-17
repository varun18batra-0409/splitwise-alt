import Link from "@/components/Link";
import Image from "next/image";
import { StampArt } from "./stamps/StampArt";
import type { Highlight } from "@/lib/home/highlights";

// One of the sliding cards on Home (weather for your next trip, a bill due, a postcard, your passport, a festival): words on the left, a small drawn object
// (or a real photo with a keepsake on top, for the postcard and passport) on the right, one button. No trip photos. The weather card draws WeatherIcon below.

// One calm card for every tone: #16161a with a quiet off-white label.
const BG = "linear-gradient(150deg,#241d1f 0%,#16161a 55%,#101012 100%)";

const button =
  "inline-flex h-10 items-center self-start rounded-full border border-fg/25 bg-transparent px-[18px] text-sm font-semibold text-fg active:bg-fg/10";

export function HighlightCard({ h }: { h: Extract<Highlight, { kind: "card" }> }) {
  return (
    <div className="relative flex min-h-[268px] flex-1 flex-col overflow-hidden px-5 pb-12 pt-5" style={{ background: BG }} data-highlight={h.id} data-highlight-scene={h.scene && h.photo ? "photo" : undefined}>
      {h.scene && h.photo ? (
        // A real photo (a stamped passport, vintage postcards) fills the card; a dark wash from the left keeps the words readable.
        <>
          <Image src={h.photo} alt="" fill sizes="(max-width: 480px) 100vw, 480px" className="object-cover" />
          <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(16,14,14,0.92) 28%, rgba(16,14,14,0.62) 62%, rgba(16,14,14,0.38) 100%), linear-gradient(0deg, rgba(16,14,14,0.7), rgba(16,14,14,0) 45%)" }} />
          {h.keepsake && <Keepsake k={h.keepsake} />}
        </>
      ) : ["sun", "rain", "cloud", "snow"].includes(h.art) ? (
        <span aria-hidden data-weather-art={h.art} className="pointer-events-none absolute right-4 top-4">
          <WeatherIcon kind={h.art} size={56} />
        </span>
      ) : (
        <Art kind={h.art} />
      )}
      <p className="relative z-[1] max-w-[66%] text-sm leading-snug text-fg/55 [text-wrap:balance]">{h.eyebrow}</p>
      <p className="relative z-[1] mt-1 max-w-[60%] font-display text-[25px] font-semibold leading-[1.1]">{h.title}</p>
      <p className="relative z-[1] mt-auto max-w-[60%] pt-2 text-[13px] leading-snug text-gray-700">{h.text}</p>
      <Link href={h.href} className={`relative z-[1] mt-3 ${button}`}>
        {h.button}
      </Link>
    </div>
  );
}

// The drawn weather: a sun, a cloud, rain or snow, in line style. `size` is the drawn size in px (24 by default).
export function WeatherIcon({ kind, size = 24 }: { kind: string; size?: number }) {
  const s = { fill: "none", stroke: "#f4f2ec", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...s}>
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

// The keepsake on a photo card, as in the mockups: a burgundy passport with your own stamps (14), or a cream postcard with a photo
// taped on, a stamp and "Wish you were here" (15). It sits on the right, between the headline and the words at the bottom, and is a
// little smaller under 360px so it never covers the words.
type KeepsakeProps = NonNullable<Extract<Highlight, { kind: "card" }>["keepsake"]>;
function Keepsake({ k }: { k: KeepsakeProps }) {
  return (
    <div aria-hidden data-keepsake={k.kind} className="pointer-events-none absolute right-[-6px] top-[56px] h-[150px] w-[150px] origin-top-right max-[359px]:scale-[0.74] min-[360px]:max-[399px]:scale-[0.86]">
      {k.kind === "passport" ? <PassportKeepsake stamps={k.stamps} /> : <PostcardKeepsake photo={k.photo} />}
    </div>
  );
}

function PassportKeepsake({ stamps }: { stamps: { code: string; country: string; when: string; byHand?: boolean }[] }) {
  const gold = "#d8b46a";
  return (
    <>
      <div
        className="absolute right-[24px] top-0 flex h-[128px] w-[92px] rotate-[8deg] flex-col items-center rounded-[4px_9px_9px_4px] pt-[18px]"
        style={{
          background: "linear-gradient(155deg,#7a2634 0%,#561a26 55%,#3d111b 100%)",
          boxShadow: "0 20px 30px -12px rgba(0,0,0,0.9), inset 4px 0 0 rgba(0,0,0,0.28), inset -1px 0 0 rgba(255,255,255,0.08)",
        }}
      >
        <span className="font-display text-[9px] font-semibold tracking-[0.22em]" style={{ color: gold }}>
          PASSPORT
        </span>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={gold} strokeWidth={1.1} className="mt-[14px]">
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="4" ry="9" />
          <path d="M3 12h18M4.6 7.5h14.8M4.6 16.5h14.8" />
        </svg>
      </div>
      {stamps[0] && (
        <div className="absolute left-0 top-[66px]">
          <StampArt variant="card" code={stamps[0].code} country={stamps[0].country} when={stamps[0].when} byHand={stamps[0].byHand} tilt={-9} scale={0.78} />
        </div>
      )}
      {stamps[1] && (
        <div className="absolute bottom-[-6px] right-[12px]">
          <StampArt variant="card" code={stamps[1].code} country={stamps[1].country} when={stamps[1].when} byHand={stamps[1].byHand} tilt={7} scale={0.7} />
        </div>
      )}
    </>
  );
}

function PostcardKeepsake({ photo }: { photo?: string }) {
  return (
    <div className="absolute right-[16px] top-[10px] h-[104px] w-[146px] -rotate-[6deg] bg-[#f3ecdc] shadow-[0_20px_30px_-12px_rgba(0,0,0,0.9)]">
      {/* The photo, taped on the left half. */}
      <div className="absolute left-[8px] top-[15px] h-[62px] w-[62px] rotate-[-3deg] bg-white p-[3px] shadow-[0_2px_5px_rgba(0,0,0,0.25)]">
        <div className="relative h-full w-full overflow-hidden bg-[#9fb7c4]">{photo && <Image src={photo} alt="" fill sizes="80px" className="object-cover" />}</div>
        <span className="absolute -top-[7px] left-[15px] h-[12px] w-[30px] rotate-[4deg] bg-[#efe3bf]/80 shadow-[0_1px_1px_rgba(0,0,0,0.08)]" />
      </div>
      <span className="absolute bottom-[12px] left-[77px] top-[12px] w-px bg-[#d8cfba]" />
      {/* The stamp (a little piece of the same photo, with a perforated edge) and the postmark's waves. */}
      <div className="absolute right-[8px] top-[8px] h-[30px] w-[25px] bg-[#f3ecdc] p-[2px] outline outline-[2px] outline-offset-[-1px] outline-dotted outline-[#e2d8c2]">
        <div className="relative h-full w-full overflow-hidden border border-[#b9a98a] bg-[#c97c5d]">{photo && <Image src={photo} alt="" fill sizes="32px" className="object-cover" />}</div>
      </div>
      <svg width="36" height="20" viewBox="0 0 48 20" className="absolute right-[27px] top-[12px] opacity-50" fill="none" stroke="#3a3540" strokeWidth={1}>
        {[3, 8, 13, 18].map((y) => (
          <path key={y} d={`M0 ${y}q6 -3 12 0t12 0t12 0t12 0`} />
        ))}
      </svg>
      <p className="absolute left-[83px] top-[45px] w-[60px] font-hand text-[15px] font-bold leading-[0.95] text-[#2b3a67]">Wish you were here</p>
      <span className="absolute bottom-[14px] left-[84px] h-px w-[50px] bg-[#cfc6b1]" />
    </div>
  );
}

// Small drawn objects for cards without a place photo. Under 360px wide the picture sits small (64px) in its own box in the
// top right corner, clipped to that box, so it never runs into the headline or the seal into the words. From 360px it is the
// bigger picture behind the right half, a little smaller up to 400px.
function Art({ kind }: { kind: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute right-4 top-4 h-16 w-16 overflow-hidden min-[360px]:inset-0 min-[360px]:h-auto min-[360px]:w-auto min-[360px]:origin-top-right min-[360px]:overflow-visible min-[360px]:max-[399px]:scale-[0.8]">
      <div className="absolute left-0 top-0 h-[170px] w-[170px] origin-top-left scale-[0.36] min-[360px]:inset-0 min-[360px]:h-auto min-[360px]:w-auto min-[360px]:scale-100">
        <ArtPicture kind={kind} />
      </div>
    </div>
  );
}

function ArtPicture({ kind }: { kind: string }) {
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
  if (kind === "harvest")
    // Thanksgiving: a pumpkin with a green leaf and a few autumn leaves drifting down. Warm and plain: no lantern, nothing religious.
    return (
      <div aria-hidden data-harvest-art className="absolute right-8 top-6 h-[132px] w-[110px]">
        <div className="absolute bottom-0 left-1/2 h-[74px] w-[92px] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(circle_at_50%_40%,#f0a24c,#d9772c_60%,#9c4a1c)] shadow-[0_0_40px_rgba(240,162,76,0.28)]" />
        <div className="absolute bottom-0 left-[14px] h-[74px] w-[42px] rounded-[50%] border-r border-[#7d3a14]/45" />
        <div className="absolute bottom-0 right-[14px] h-[74px] w-[42px] rounded-[50%] border-l border-[#7d3a14]/45" />
        <div className="absolute bottom-[62px] left-1/2 h-4 w-3 -translate-x-1/2 rounded-sm bg-[#5a3d22]" />
        <div className="absolute bottom-[68px] left-[calc(50%+2px)] h-3.5 w-6 rotate-[-18deg] rounded-[0_100%_0_100%] bg-[#7a8f3a]" />
        <span className="absolute left-0 top-1 h-3.5 w-3.5 rotate-[20deg] rounded-[0_100%_0_100%] bg-[#c8552b]" />
        <span className="absolute right-1 top-0 h-3 w-3 rotate-[-35deg] rounded-[0_100%_0_100%] bg-[#e0a23a]" />
        <span className="absolute left-3 top-[34px] h-2.5 w-2.5 rotate-[60deg] rounded-[0_100%_0_100%] bg-[#e0a23a]/80" />
      </div>
    );
  if (kind === "festive")
    // A paper lantern on a string with a few gold sparks: festive without pointing at one festival.
    return (
      <div aria-hidden className="absolute right-10 top-0">
        <div className="mx-auto h-8 w-px bg-[#d9c79a]/60" />
        <div className="relative h-[104px] w-[76px] rounded-[38px] bg-[radial-gradient(circle_at_50%_40%,#ffd27a,#e0853f_60%,#9c3d22)] shadow-[0_0_40px_rgba(255,190,110,0.35)]">
          <div className="absolute inset-x-2 top-3 h-px bg-[#7d2a14]/40" />
          <div className="absolute inset-x-1 top-1/2 h-px bg-[#7d2a14]/40" />
          <div className="absolute inset-x-2 bottom-3 h-px bg-[#7d2a14]/40" />
          <div className="absolute -top-1.5 left-1/2 h-3 w-8 -translate-x-1/2 rounded-sm bg-[#3a2a1c]" />
          <div className="absolute -bottom-1.5 left-1/2 h-3 w-8 -translate-x-1/2 rounded-sm bg-[#3a2a1c]" />
        </div>
        <span className="absolute -left-6 top-14 h-1.5 w-1.5 rounded-full bg-[#ffd27a]" />
        <span className="absolute -right-4 top-24 h-1 w-1 rounded-full bg-[#ffd27a]/80" />
        <span className="absolute -left-3 top-32 h-1 w-1 rounded-full bg-[#ffd27a]/70" />
      </div>
    );
  return null;
}
