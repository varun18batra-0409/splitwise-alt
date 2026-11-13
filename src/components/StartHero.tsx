import Image from "next/image";
import { photoSet } from "@/lib/places";

// The start screen's picture: two real photos, tilted and overlapping, with a small paper receipt on top.
// Decorative only (aria-hidden): the page's words say everything. Photos are the app's own downloaded ones;
// a photo that isn't there leaves a plain dark card, never a drawing of people.
const first = (slot: string) => photoSet(slot)[0];

// A zig-zag bottom edge for the slip of paper.
const TEETH = 11;
const ZIGZAG = `polygon(0 0, 100% 0, ${Array.from({ length: TEETH * 2 + 1 }, (_, i) => `${100 - (i / (TEETH * 2)) * 100}% ${i % 2 === 0 ? "100%" : "calc(100% - 6px)"}`).join(", ")})`;

function Photo({ src, className }: { src?: string; className: string }) {
  return (
    <div className={`absolute overflow-hidden rounded-[20px] bg-[#1f1f24] shadow-[0_14px_30px_-14px_rgb(0_0_0/0.8)] ${className}`}>
      {src && <Image src={src} alt="" fill sizes="240px" quality={75} className="object-cover" priority />}
    </div>
  );
}

export function StartHero() {
  const trip = first("place-thailand") ?? first("cover-beach");
  const city = first("cover-city") ?? first("place-singapore") ?? first("cover-lake");
  return (
    <div aria-hidden className="lp-settle relative mx-auto mb-7 mt-2 h-[262px] w-full max-w-[340px] select-none">
      <Photo src={trip} className="left-0 top-4 h-[178px] w-[58%] -rotate-[6deg]" />
      <Photo src={city} className="right-0 top-0 h-[172px] w-[54%] rotate-[5deg]" />
      <div className="absolute bottom-0 right-3 w-[172px] rotate-[-4deg] bg-[#f4f2ec] px-3.5 pb-5 pt-3 text-[#0d0d0f] shadow-[0_10px_24px_-10px_rgb(0_0_0/0.7)]" style={{ clipPath: ZIGZAG }}>
        <p className="font-display text-[14px] font-semibold leading-none">Group expense</p>
        <div className="mt-2.5 space-y-1 text-[12px] leading-tight">
          <p className="flex justify-between gap-2">
            <span>Dinner (6)</span>
            <span className="tabular-nums">₹3,240</span>
          </p>
          <p className="flex justify-between gap-2">
            <span>Boat tour</span>
            <span className="tabular-nums">₹4,800</span>
          </p>
        </div>
        <div className="my-2 border-t border-[#0d0d0f]/30" />
        <p className="flex justify-between gap-2 text-[12.5px] font-semibold leading-tight">
          <span>Total</span>
          <span className="tabular-nums">₹8,040</span>
        </p>
      </div>
    </div>
  );
}
