import Link from "@/components/Link";
import { WeatherIcon } from "@/components/HighlightCard";
import type { BeforeYouGo as Card } from "@/lib/home/highlights";

// "Before you go" (founder, 15 Nov): one card for the soonest trip that has not started, with its usual weather and what to pack.
// A dark surface with a soft warm glow, the drawn weather at the top right, one outline button. No trip photo.
// The words come from beforeYouGo (src/lib/home/highlights.ts); this only draws them.
export function BeforeYouGo({ card }: { card: Card }) {
  return (
    <section aria-labelledby="before-you-go-h" className="mt-8" data-before-you-go={card.id}>
      <h2 id="before-you-go-h" className="mb-2 font-display text-[22px] font-semibold tracking-tight">
        Before you go
      </h2>
      <div className="relative overflow-hidden rounded-[22px] px-5 pb-5 pt-5 text-fg shadow-[inset_0_0_0_1px_#26262c] [background:radial-gradient(90%_120%_at_100%_0%,#3a2a1e_0%,transparent_60%),linear-gradient(160deg,#1d1a17_0%,#121014_80%)]">
        <span aria-hidden data-weather-art={card.icon} className="pointer-events-none absolute right-4 top-4">
          <WeatherIcon kind={card.icon} size={64} />
        </span>
        <p className="relative max-w-[70%] text-[11px] font-semibold uppercase leading-snug tracking-[0.14em] text-fg/60" data-before-eyebrow>
          {card.eyebrow}
        </p>
        <p className="relative mt-2 max-w-[78%] font-display text-[26px] font-bold leading-[1.1] tracking-tight" data-before-title>
          {card.title}
        </p>
        <p className="relative mt-3 text-[14px] leading-snug text-fg/75" data-before-text>
          {card.text}
        </p>
        <Link
          href={card.href}
          className="relative mt-4 inline-flex h-11 items-center self-start whitespace-nowrap rounded-full border border-fg/25 px-[18px] text-[15px] font-semibold text-fg transition-transform active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
          data-before-open
        >
          {card.button} <span aria-hidden className="ml-1.5">↗</span>
        </Link>
      </div>
    </section>
  );
}
