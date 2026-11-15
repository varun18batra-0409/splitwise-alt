import { lookCss, touchesOn } from "@/lib/postcards/looks";
import { handOf, inkColor, paperTones, postmarkSvg, printSvg, stampSvg, WAVES_SVG } from "@/lib/postcards/catalog";
import { ONESIDE, ONESIDE_SIGN, ONESIDE_STAMP, ONESIDE_WAVES, photoSizeOf, type PhotoSize } from "@/lib/postcards/format";
import { oneSideFont } from "@/lib/postcards/fit";
import { Touches } from "./Card";

// A one-side postcard: the photo as a small taped print on the left, the handwritten note on the right, the stamp and a wavy
// postmark in the corner. Drawn at any width (sizes in "cqw", a share of the card's width), like the two-sided card, so the same
// card works as a thumbnail, full screen and as the picture sent on WhatsApp. No hooks: it can be drawn on the server.

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .2 0 0 0 0 .16 0 0 0 0 .1 0 0 0 .55 0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>\")";

export type OneSideProps = {
  size: PhotoSize | string;
  front: string; // "print:beach" | "photo:/photos/…" | "own"
  photo?: string; // the address of an own photo
  look?: string;
  message: string;
  hand: string;
  stamp: string;
  paper: string;
  ink?: string;
  touches?: string;
  seal?: string;
  place: string;
  date: string;
  from: string;
  k: string;
  className?: string;
};

// The photo's picture proportions inside the print (as in the mockup: 108 × 80), and the print's white border as a share of its width.
export const PRINT_ASPECT = "27 / 20";
const PAD = 0.042;
const PAD_BOTTOM = 0.153;

export function PostcardOneSide({ size: sizeProp, front, photo, look = "", message, hand, stamp, paper, ink = "navy", touches = "", seal = "", place, date, from, k, className = "" }: OneSideProps) {
  const size = photoSizeOf(sizeProp);
  const g = ONESIDE[size];
  const h = handOf(hand);
  const { f } = oneSideFont(message.trim(), h.size, size);
  const [p0, p1, p2] = paperTones(paper);
  const printId = front.startsWith("print:") ? front.slice(6) : "";
  const img = !printId ? photo || (front.startsWith("photo:") ? front.slice(6) : "") : "";
  const filter = lookCss(look);
  const pad = PAD * g.print.w * 100;
  const padBottom = PAD_BOTTOM * g.print.w * 100;
  const pen = { fontFamily: `'${h.family}', cursive`, color: inkColor(ink) };
  const inner = (
    <>
      <span aria-hidden className="absolute inset-0" style={{ background: `radial-gradient(120% 90% at 0% 0%,${p0},${p1} 70%,${p2})` }} />
      {/* The taped print */}
      <div
        aria-hidden
        className="absolute box-border bg-[#fbf8f1] shadow-[0_1.7cqw_4cqw_-1.7cqw_rgba(40,30,10,0.5)]"
        style={{ left: `${g.print.x * 100}%`, top: `${g.print.y * 100}%`, width: `${g.print.w * 100}%`, padding: `${pad}cqw ${pad}cqw ${padBottom}cqw`, transform: `rotate(${g.print.rot}deg)` }}
        data-oneside-photo
      >
        <div className="relative overflow-hidden bg-[#e9e2d4]" style={{ aspectRatio: PRINT_ASPECT }}>
          {printId ? (
            <div className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full" style={{ filter }} data-print-svg dangerouslySetInnerHTML={{ __html: printSvg(printId, k) }} />
          ) : img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ filter: filter === "none" ? "saturate(1.06) contrast(1.04)" : filter }} data-front-photo data-look={look || "none"} />
          ) : null}
        </div>
      </div>
      <span
        aria-hidden
        className="absolute"
        style={{ left: `${g.tape.x * 100}%`, top: `${g.tape.y * 100}%`, width: `${g.tape.w * 100}%`, height: `${g.tape.h * 100}%`, transform: `rotate(${g.tape.rot}deg)`, background: "rgba(226,212,170,0.82)" }}
      />
      {/* Waves, postmark and stamp */}
      <div aria-hidden className="absolute opacity-40 [&>svg]:h-auto [&>svg]:w-full" style={{ right: `${ONESIDE_WAVES.right * 100}%`, top: `${ONESIDE_WAVES.top * 100}%`, width: `${ONESIDE_WAVES.w * 100}%` }} dangerouslySetInnerHTML={{ __html: WAVES_SVG }} />
      <div aria-hidden className="absolute right-[17.5%] top-[3.5%] w-[12%] rotate-[-12deg] opacity-60 [&>svg]:h-auto [&>svg]:w-full" data-postmark dangerouslySetInnerHTML={{ __html: postmarkSvg(place || "Loopin", date, k) }} />
      <div aria-hidden className="absolute rotate-[2deg] drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.35)] [&>svg]:h-auto [&>svg]:w-full" style={{ right: `${ONESIDE_STAMP.right * 100}%`, top: `${ONESIDE_STAMP.top * 100}%`, width: `${ONESIDE_STAMP.w * 100}%` }} data-stamp-svg dangerouslySetInnerHTML={{ __html: stampSvg(stamp, k) }} />
      {/* The note, centred between its top and bottom, sized to fit */}
      <div className="absolute flex items-center" style={{ left: `${g.note.x * 100}%`, width: `${g.note.w * 100}%`, top: `${g.note.top * 100}%`, height: `${(g.note.bottom - g.note.top) * 100}%` }}>
        <p className="m-0 w-full overflow-hidden whitespace-pre-line break-words" style={{ ...pen, fontSize: `${f * 100}cqw`, lineHeight: 1.12 }} data-back-message>
          {message}
        </p>
      </div>
      <span className="absolute whitespace-nowrap" style={{ ...pen, right: `${ONESIDE_SIGN.right * 100}%`, bottom: `${ONESIDE_SIGN.bottom * 100}%`, fontSize: `${5.8 * (h.size / 1.12)}cqw`, lineHeight: 1.1 }}>
        — {from}
      </span>
      <Touches list={touchesOn(touches, "oneside")} k={k} seal={seal} initial={from} />
      <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.14] mix-blend-multiply" style={{ backgroundImage: GRAIN }} />
    </>
  );
  return (
    <div className={`relative aspect-[3/2] overflow-hidden rounded-[3px] text-[#2a2620] shadow-[0_24px_48px_-18px_rgba(0,0,0,0.85),0_6px_14px_-6px_rgba(0,0,0,0.6)] [container-type:inline-size] ${className}`} data-postcard-oneside data-photo-size={size} data-paper={paper}>
      {paper === "airmail" ? (
        <>
          <span aria-hidden className="absolute inset-0 bg-[repeating-linear-gradient(135deg,#c8453a_0_12px,#fbf7ef_12px_22px,#2f5fa7_22px_34px,#fbf7ef_34px_44px)]" />
          <div className="absolute inset-[3.4%] overflow-hidden [container-type:inline-size]">{inner}</div>
        </>
      ) : (
        inner
      )}
    </div>
  );
}
