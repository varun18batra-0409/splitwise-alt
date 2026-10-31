import { reactionSvg, waxSeal } from "@/lib/postcards/looks";

// A sealed postcard: an envelope with a wax seal and the day it opens. Nothing of the card shows.
export function SealedEnvelope({ from, opens, className = "", small = false }: { from: string; opens: string; className?: string; small?: boolean }) {
  const seal = waxSeal("crimson:crest", from || "L", "sealed");
  return (
    <div className={`relative aspect-[3/2] overflow-hidden rounded-[3px] shadow-[0_24px_48px_-18px_rgba(0,0,0,0.85),0_6px_14px_-6px_rgba(0,0,0,0.6)] [container-type:inline-size] ${className}`} data-sealed>
      <span aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_90%_at_0%_0%,#ead9bb,#d9c19a_70%,#cdb287)]" />
      {/* The flap */}
      <svg aria-hidden viewBox="0 0 300 200" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <path d="M0 0 L150 112 L300 0" fill="#d4ba90" stroke="#b49b70" strokeWidth="0.8" />
        <path d="M0 200 L120 96 M300 200 L180 96" stroke="#b49b70" strokeWidth="0.6" opacity=".7" />
      </svg>
      <span aria-hidden className="absolute left-1/2 top-[56%] w-[19%] -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_3px_4px_rgba(0,0,0,0.4)] [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: seal }} />
      {!small && (
        <>
          <span className="absolute left-[6%] top-[7%] font-display text-[2.5cqw] uppercase tracking-[0.42em] text-[#6c5a3e]">From {from}</span>
          <span className="absolute inset-x-0 bottom-[8%] text-center font-display text-[3.4cqw] italic text-[#5a4a33]">Not to be opened before {opens}</span>
        </>
      )}
      {small && <span className="absolute inset-x-0 bottom-[8%] text-center text-[5.2cqw] font-semibold text-[#5a4a33]">Opens {opens}</span>}
    </div>
  );
}

export function SealMark({ id, k, className = "" }: { id: string; k: string; className?: string }) {
  const svg = reactionSvg(id, k);
  if (!svg) return null;
  return <span aria-hidden className={`block drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)] [&>svg]:h-auto [&>svg]:w-full ${className}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
