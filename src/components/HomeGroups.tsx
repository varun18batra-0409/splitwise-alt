import Image from "next/image";
import Link from "@/components/Link";
import { Polaroid } from "@/components/Polaroid";
import type { CoverChoice } from "@/lib/covers";
import { CARD_ROW_MAX, cardBalance, cardStatus, rowEnd } from "@/lib/home/group-card";

// "Your groups" on Home: a row of polaroids you swipe sideways. Each shows the group's own picture, its name in handwriting,
// and its status under it ("You owe ₹54,122" in orange, "Owed ₹3,450" and "✓ All settled" in green). A trip that is on carries a small
// tag on its photo ("Day 2 of 5"). Cards tilt a little, alternately; the tilt is off for people who ask for less motion.
// The first card is a dashed "+ New group" (one tap to the new-group page); the polaroids are 140px wide so the next one peeks in.

export type GroupCardData = {
  id: string;
  name: string;
  cover: { kind: CoverChoice; src?: string };
  photo?: string; // a place photo for a trip with no picture of its own
  balance: number; // minor units, in the group's currency; + is owed to you
  money: (minor: number) => string; // formats in the group's currency, exact (read out to screen readers, shown on hold)
  show?: (minor: number) => string; // what the polaroid prints: whole units for big amounts (display only); money() when absent
  tag?: string | null; // "Day 2 of 5"
};

const tilt = ["-rotate-[2deg]", "rotate-[1.5deg]"];

export function GroupCards({ groups, total }: { groups: GroupCardData[]; total: number }) {
  const shown = groups.slice(0, CARD_ROW_MAX);
  const end = rowEnd(total);
  return (
    <ul
      aria-label="Your groups"
      className="-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-5 pt-3 [scrollbar-width:none]"
      data-group-cards
    >
      {/* One tap to a new group: always the first card, as tall as the polaroids beside it. */}
      <li className="flex w-[96px] shrink-0 snap-start">
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
        const b = cardBalance(g.balance, g.show ?? g.money);
        const exact = cardBalance(g.balance, g.money);
        const status = cardStatus(g.balance, g.show ?? g.money);
        return (
          <li key={g.id} className="w-[140px] shrink-0 snap-start">
            <Link
              href={`/groups/${g.id}`}
              aria-label={`${g.name}, ${exact.spoken}${g.tag ? `, ${g.tag}` : ""}`}
              className={`lp-press block ${tilt[i % 2]} active:rotate-0 motion-reduce:rotate-0`}
              data-group-card
              data-tone={b.tone}
              title={g.show ? `${g.name}: ${exact.text}` : undefined}
            >
              <Polaroid
                cover={g.cover}
                uid={`home-${g.id}`}
                letter={g.name}
                caption={g.name}
                note={status.text}
                noteTone={status.tone === "square" ? "owed" : status.tone}
                photoClass="h-[112px]"
                captionClass="text-[20px]"
                noteClass="text-[12.5px]"
                wrapCaption
                wrapNote
                sizes="140px"
                className="w-[140px]"
              >
                {g.photo && <Image src={g.photo} alt="" aria-hidden fill sizes="140px" quality={75} className="object-cover" />}
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
        <li className="flex w-[140px] shrink-0 snap-start">
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
  );
}
