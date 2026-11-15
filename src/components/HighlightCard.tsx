import Link from "@/components/Link";
import type { Highlight } from "@/lib/home/highlights";

// One of the sliding cards at the bottom of Home (a postcard waiting, a bill due): words on the left, a small drawn object on the right, one button.
// No photos on these any more (founder, 15 Nov). The weather card is BeforeYouGo, which draws its own sun / cloud / rain / snow with WeatherIcon below.

// One calm card for every tone: #16161a with a quiet off-white label.
const BG = "linear-gradient(150deg,#241d1f 0%,#16161a 55%,#101012 100%)";

const button =
  "inline-flex h-10 items-center self-start rounded-full border border-fg/25 bg-transparent px-[18px] text-sm font-semibold text-fg active:bg-fg/10";

export function HighlightCard({ h }: { h: Extract<Highlight, { kind: "card" }> }) {
  return (
    <div className="relative flex min-h-[268px] flex-1 flex-col overflow-hidden px-5 pb-12 pt-5" style={{ background: BG }} data-highlight={h.id}>
      <Art kind={h.art} />
      <p className="relative z-[1] max-w-[66%] truncate text-sm text-fg/55">{h.eyebrow}</p>
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
  return null;
}
