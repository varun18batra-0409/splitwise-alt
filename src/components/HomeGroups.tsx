import Image from "next/image";
import Link from "@/components/Link";
import { Polaroid } from "@/components/Polaroid";
import { RowControls } from "@/components/RowControls";
import type { CoverChoice } from "@/lib/covers";
import { CARD_ROW_MAX, cardWord, rowEnd } from "@/lib/home/group-card";

// "Your groups" on Home: a row of polaroids you swipe sideways. Each shows the group's own picture, its name in handwriting,
// and ONE status word under it ("You owe" in orange, "You’re owed" in green, "Settled" in grey): never an amount (the money pass above
// has it) and never a trip's day count (the Coming up pass has it). Cards tilt a little, alternately; the tilt is off for people who ask for less motion.
// The first card is a dashed "+ New group" (72px, one tap to the new-group page); on a phone it and TWO whole polaroids fit the visible row
// (each polaroid is half of what is left after the New group card and the two 12px gaps, at most 150px), more scroll in after.
// The ul is -mx-5 px-5, so a percent width is of the page's own width (the screen less 40px): 280px at 320, 320px at 360, 350px at 390.

export type GroupCardData = {
  id: string;
  name: string;
  cover: { kind: CoverChoice; src?: string };
  photo?: string; // a place photo for a trip with no picture of its own
  balance: number; // minor units, in the group's currency; + is owed to you (only its sign is used here)
  tag?: string | null; // a small tag on the photo (Home no longer sets one)
  expenses?: number; // how many expenses the group has: none means the word is "No expenses yet", not "Settled"
};

const tilt = ["-rotate-[2deg]", "rotate-[1.5deg]"];

export function GroupCards({ groups, total }: { groups: GroupCardData[]; total: number }) {
  const shown = groups.slice(0, CARD_ROW_MAX);
  const end = rowEnd(total);
  return (
    <RowControls>
    <ul
      aria-label="Your groups"
      data-row-scroller
      className="-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-5 pt-3 [scrollbar-width:none]"
      data-group-cards
    >
      {/* One tap to a new group: always the first card, as tall as the polaroids beside it. */}
      <li className="flex w-[72px] shrink-0 snap-start">
        <Link
          href="/groups/new"
          className="flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-fg/30 px-2 text-center text-[14px] font-medium leading-tight text-fg/85 active:bg-mist"
          data-group-card-new
        >
          <span aria-hidden className="text-[22px] font-light leading-none">
            +
          </span>
          <span>New group</span>
        </Link>
      </li>
      {shown.map((g, i) => {
        const status = cardWord(g.balance, g.expenses);
        return (
          <li key={g.id} className="w-[calc((100%-72px-24px)/2)] max-w-[150px] shrink-0 snap-start">
            <Link
              href={`/groups/${g.id}`}
              aria-label={`${g.name}, ${status.text.toLowerCase()}${g.tag ? `, ${g.tag}` : ""}`}
              className={`lp-press block ${tilt[i % 2]} active:rotate-0 motion-reduce:rotate-0`}
              data-group-card
              data-tone={status.tone}
            >
              <Polaroid
                cover={g.cover}
                uid={`home-${g.id}`}
                letter={g.name}
                caption={g.name}
                note={status.text}
                noteTone={status.tone === "square" ? undefined : status.tone}
                photoClass="aspect-square max-h-[104px]"
                captionClass="text-[19px]"
                noteClass="text-[13px] max-[359px]:text-[12px]"
                wrapCaption
                wrapNote
                sizes="(max-width: 430px) 40vw, 150px"
                className="w-full"
              >
                {g.photo && <Image src={g.photo} alt="" aria-hidden fill sizes="(max-width: 430px) 40vw, 150px" quality={75} className="object-cover" />}
                {g.tag && (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold leading-tight text-[#f7f4ec] backdrop-blur-sm" data-trip-tag>
                    {g.tag}
                  </span>
                )}
              </Polaroid>
            </Link>
          </li>
        );
      })}
      {end && (
        <li className="flex w-[150px] shrink-0 snap-start">
          <Link
            href="/groups"
            className="flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-dashed border-fg/25 px-3 text-center text-sm font-medium text-fg/80 active:bg-mist"
            data-group-card-end={end}
          >
            {`See all ${total} groups`}
          </Link>
        </li>
      )}
    </ul>
    </RowControls>
  );
}
