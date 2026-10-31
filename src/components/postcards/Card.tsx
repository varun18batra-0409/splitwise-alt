import { handOf, inkColor, paperTones, letteringOf, toneOf, postmarkSvg, printSvg, stampSvg, WAVES_SVG } from "@/lib/postcards/catalog";

// A postcard, front and back, drawn at any width (sizes are in "cqw": a share of the card's width),
// so the same card works as a thumbnail, full screen, and as the picture sent on WhatsApp.

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .2 0 0 0 0 .16 0 0 0 0 .1 0 0 0 .55 0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>\")";

export type FrontProps = { front: string; photo?: string; words: string; lettering: string; tone?: string; k: string; className?: string };

export function PostcardFront({ front, photo, words, lettering, tone = "white", k, className = "" }: FrontProps) {
  const l = letteringOf(lettering);
  const t = toneOf(tone);
  const print = front.startsWith("print:") ? front.slice(6) : "";
  const img = !print ? photo || (front.startsWith("photo:") ? front.slice(6) : "") : "";
  const long = words.length > 11;
  return (
    <div className={`relative aspect-[3/2] overflow-hidden rounded-[3px] bg-[#e9e2d4] text-white shadow-[0_1px_0_rgba(255,255,255,0.35)_inset,0_24px_48px_-18px_rgba(0,0,0,0.85),0_6px_14px_-6px_rgba(0,0,0,0.6)] [container-type:inline-size] ${className}`} data-postcard-front>
      {print ? (
        <div aria-hidden className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full" data-print-svg dangerouslySetInnerHTML={{ __html: printSvg(print, k) }} />
      ) : img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover [filter:saturate(1.06)_contrast(1.04)]" data-front-photo />
      ) : null}
      {img && words && !t.dark && <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_45%,rgba(0,0,0,0.42)_100%)]" />}
      <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.2] mix-blend-multiply" style={{ backgroundImage: GRAIN }} />
      <span aria-hidden className="pointer-events-none absolute inset-[3.2%] border border-white/60" />
      {words && (
        <div className="pointer-events-none absolute inset-x-[6%] bottom-[9%] text-center" style={{ color: t.c, textShadow: t.dark ? "0 1px 14px rgba(255,255,255,0.45)" : "0 2px 18px rgba(0,0,0,0.35)" }} data-front-words data-tone={t.id}>
          <div className="font-sans text-[2.1cqw] font-semibold uppercase tracking-[0.34em] opacity-95">Greetings from</div>
          <div
            className="leading-[0.95]"
            style={{
              fontFamily: `'${l.family}', Georgia, serif`,
              fontStyle: l.italic ? "italic" : undefined,
              letterSpacing: l.caps ? "0.06em" : "-0.01em",
              fontSize: `${l.caps ? (long ? 11 : 15) : long ? 9.5 : 13.5}cqw`,
            }}
          >
            {words}
          </div>
        </div>
      )}
    </div>
  );
}

export type BackProps = {
  message: string;
  hand: string;
  stamp: string;
  paper: string;
  ink?: string;
  address: string[];
  place: string;
  date: string;
  from: string;
  k: string;
  className?: string;
};

export function PostcardBack({ message, hand, stamp, paper, ink = "navy", address, place, date, from, k, className = "" }: BackProps) {
  const h = handOf(hand);
  const pen = { fontFamily: `'${h.family}', cursive`, color: inkColor(ink) };
  const [p0, p1, p2] = paperTones(paper);
  const inner = (
    <>
      <span aria-hidden className="absolute inset-0" style={{ background: `radial-gradient(120% 90% at 0% 0%,${p0},${p1} 70%,${p2})` }} />
      <span className="absolute left-[6%] top-[7%] font-display text-[2.6cqw] uppercase tracking-[0.42em] text-[#6c6455]">Post card</span>
      <span aria-hidden className="absolute bottom-[10%] left-[56%] top-[22%] w-px bg-[#bfb39b]" />
      <div className="absolute bottom-[8%] left-[6%] top-[19%] w-[47%] overflow-hidden whitespace-pre-line leading-[1.28]" style={{ ...pen, fontSize: `${4.1 * h.size}cqw` }} data-back-message>
        {message}
        <span className="mt-[0.4em] block">— {from}</span>
      </div>
      <div aria-hidden className="absolute right-[5%] top-[30%] w-[34%] opacity-40 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: WAVES_SVG }} />
      <div aria-hidden className="absolute right-[15%] top-[10%] w-[15%] rotate-[-12deg] opacity-55 [&>svg]:h-auto [&>svg]:w-full" data-postmark dangerouslySetInnerHTML={{ __html: postmarkSvg(place || "Loopin", date, k) }} />
      <div aria-hidden className="absolute right-[6%] top-[7%] w-[13.5%] rotate-[2deg] drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.35)] [&>svg]:h-auto [&>svg]:w-full" data-stamp-svg dangerouslySetInnerHTML={{ __html: stampSvg(stamp, k) }} />
      <div className="absolute bottom-[11%] left-[60%] right-[6%] flex flex-col gap-[2.6cqw]" style={{ ...pen, fontSize: `${3.7 * h.size}cqw` }} data-back-address>
        {[0, 1, 2].map((i) => (
          <span key={i} className="block min-h-[1.15em] overflow-hidden text-ellipsis whitespace-nowrap border-b border-[#bfb39b] pb-px">
            {address[i] ?? ""}
          </span>
        ))}
      </div>
      <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.14] mix-blend-multiply" style={{ backgroundImage: GRAIN }} />
    </>
  );
  return (
    <div className={`relative aspect-[3/2] overflow-hidden rounded-[3px] text-[#2a2620] shadow-[0_24px_48px_-18px_rgba(0,0,0,0.85),0_6px_14px_-6px_rgba(0,0,0,0.6)] [container-type:inline-size] ${className}`} data-postcard-back data-paper={paper}>
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
