import Image from "next/image";
import Link from "@/components/Link";
import type { Highlight } from "@/lib/home/highlights";

// "Your memories", one of the sliding cards on Home: words on the left, three small photos from the trip's moments on the right,
// laid like prints on a table (a cream border, a little tilt). One outline button into that group's Memories tab.
// The photos come from our own /api/ (private, cookie-checked), so they are shown as they are (the image service has no cookies).

const PRINT = "absolute overflow-hidden border-[3px] border-[#f4f1e8] bg-[#1c1b20] shadow-[0_14px_24px_-10px_rgba(0,0,0,0.9)]";
// Where each print sits in the 132 x 196 box, and how it leans.
const SPOTS = [
  "left-0 top-0 h-[96px] w-[76px] -rotate-[7deg]",
  "right-0 top-[40px] h-[96px] w-[76px] rotate-[5deg]",
  "left-3 top-[100px] h-[92px] w-[76px] -rotate-[2deg]",
];

export function MemoriesCard({ h }: { h: Extract<Highlight, { kind: "memories" }> }) {
  const thumbs = h.thumbs.slice(0, 3);
  return (
    <div className="relative flex min-h-[268px] flex-1 flex-col overflow-hidden bg-[linear-gradient(150deg,#241d1f_0%,#16161a_55%,#101012_100%)] px-5 pb-12 pt-5" data-highlight={h.id} data-memories-card>
      <div aria-hidden className="absolute right-4 top-6 h-[196px] w-[132px] min-[360px]:right-5">
        {thumbs.length === 1 ? (
          <span className={`${PRINT} right-1 top-3 h-[150px] w-[112px] rotate-[4deg]`}>
            <Image src={thumbs[0]} alt="" fill unoptimized sizes="112px" className="object-cover" />
          </span>
        ) : (
          thumbs.map((src, i) => (
            <span key={i} className={`${PRINT} ${SPOTS[i]}`}>
              <Image src={src} alt="" fill unoptimized sizes="76px" className="object-cover" />
            </span>
          ))
        )}
      </div>
      <p className="relative z-[1] max-w-[56%] truncate text-sm text-[#f4f2ec8c]">Your memories</p>
      <p className="relative z-[1] mt-1 max-w-[52%] font-display text-[25px] font-semibold leading-[1.1]" data-memories-title>
        {h.title}
      </p>
      <p className="relative z-[1] mt-auto max-w-[52%] pt-2 text-[13px] leading-snug text-fg/75" data-memories-line>
        {h.line}
      </p>
      <Link href={h.href} className="relative z-[1] mt-3 inline-flex h-10 items-center self-start rounded-full border border-fg/25 bg-transparent px-[18px] text-sm font-semibold text-fg active:bg-fg/10" data-memories-open>
        Open memories
      </Link>
    </div>
  );
}
