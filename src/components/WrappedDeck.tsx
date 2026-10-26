"use client";

import { useEffect, useState } from "react";
import Link from "./Link";
import { GroupCover } from "./GroupCover";
import { ShareSheet } from "./ShareSheet";
import type { CoverChoice } from "@/lib/covers";
import type { Slide } from "@/lib/wrapped";

// Trip Wrapped, as stories: tap the right side for the next slide, the left
// for the one before. The last slide has Share and what to do next.
const BG: Record<Slide["kind"], string> = {
  intro: "",
  total: "[background:radial-gradient(110%_80%_at_80%_0%,#2f8a62_0%,transparent_60%),linear-gradient(170deg,#173a2b_0%,#0c1511_85%)]",
  category: "[background:radial-gradient(110%_80%_at_10%_0%,#b8652a_0%,transparent_60%),linear-gradient(170deg,#3a2414_0%,#130c08_85%)]",
  day: "[background:radial-gradient(110%_80%_at_70%_10%,#3d4ea8_0%,transparent_60%),linear-gradient(170deg,#161c3d_0%,#0a0c18_85%)]",
  splurge: "[background:radial-gradient(110%_80%_at_20%_10%,#a8325a_0%,transparent_60%),linear-gradient(170deg,#3a1222_0%,#14070c_85%)]",
  awards: "[background:radial-gradient(110%_80%_at_80%_10%,#a8862f_0%,transparent_60%),linear-gradient(170deg,#3a2e12_0%,#141007_85%)]",
  outro: "",
};

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

  const photoBg = s.kind === "intro" || s.kind === "outro";
  return (
    <section aria-label={`${groupName}, wrapped`} className="relative -mx-5 -mt-2 h-[calc(100dvh-150px)] min-h-[520px] overflow-hidden rounded-none sm:mx-0 sm:rounded-[24px]" data-wrapped-slide={s.kind}>
      {photoBg ? (
        photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" aria-hidden className="lp-drift absolute inset-0 h-full w-full object-cover" />
        ) : (
          <GroupCover kind={cover.kind as CoverChoice} src={cover.src} uid={`wr-${groupId}`} sizes="448px" drift />
        )
      ) : (
        <span aria-hidden className={`absolute inset-0 ${BG[s.kind]}`} />
      )}
      <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.45)_0%,transparent_25%,transparent_45%,rgba(0,0,0,0.85)_100%)]" />

      <div className="absolute inset-x-3 top-3 z-20 flex gap-1" aria-hidden>
        {slides.map((x, k) => (
          <span key={k} className={`h-[3px] flex-1 rounded-full ${k <= i ? "bg-white" : "bg-white/30"}`} />
        ))}
      </div>

      {!photoBg && s.emoji && (
        <span aria-hidden className="absolute left-1/2 top-[22%] -translate-x-1/2 text-[110px] leading-none">
          {s.emoji}
        </span>
      )}

      <button type="button" aria-label="Previous" onClick={() => setI((x) => Math.max(x - 1, 0))} className="absolute inset-y-0 left-0 z-10 w-1/3" />
      {!last && <button type="button" aria-label="Next" onClick={() => setI((x) => x + 1)} className="absolute inset-y-0 right-0 z-10 w-2/3" />}

      <div className="absolute inset-x-0 bottom-0 z-20 px-6 pb-7">
        <p className="font-display text-[34px] font-semibold leading-[1.05] text-white" data-wrapped-headline>
          {s.headline}
        </p>
        <p className="mt-2 whitespace-pre-line font-hand text-[23px] font-bold leading-snug text-[#ffd9a8]">{s.line}</p>
        {last ? (
          <div className="relative z-30 mt-6 space-y-2.5">
            <ShareSheet
              image={`/groups/${groupId}/wrapped-image`}
              fileName="wrapped.png"
              title="Share the Wrapped"
              words={`${groupName}, wrapped 🎬`}
              label="Share it"
              className="pop block w-full bg-[#f4f1e8] px-4 py-3.5 text-center text-base font-semibold text-[#14130f] [--pop-edge:#6e6b63]"
            />
            <Link href={settleHref ?? `/groups/${groupId}`} className="block py-2 text-center text-sm font-semibold text-white/80 underline underline-offset-4">
              {settleHref ? "Settle up" : `Back to ${groupName}`}
            </Link>
          </div>
        ) : (
          <p className="mt-6 text-center text-xs text-white/50">Tap for more</p>
        )}
      </div>
    </section>
  );
}
