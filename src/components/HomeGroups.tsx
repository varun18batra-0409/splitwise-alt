import Image from "next/image";
import Link from "@/components/Link";
import { Polaroid } from "@/components/Polaroid";
import type { CoverChoice } from "@/lib/covers";
import { CARD_ROW_MAX, cardBalance, rowEnd } from "@/lib/home/group-card";

// "Your groups" on Home: a row of polaroids you swipe sideways. Each shows the group's own picture, its name in handwriting,
// and where you stand (green when you're owed, orange when you owe, "square" when even). A trip that is on carries a small
// tag on its photo ("Day 2 of 5"). Cards tilt a little, alternately; the tilt is off for people who ask for less motion.

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
      {shown.map((g, i) => {
        const b = cardBalance(g.balance, g.show ?? g.money);
        const exact = cardBalance(g.balance, g.money);
        return (
          <li key={g.id} className="w-[150px] shrink-0 snap-start">
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
                note={b.text}
                noteTone={b.tone === "square" ? undefined : b.tone}
                photoClass="h-[120px]"
                captionClass="text-[22px]"
                wrapCaption
                sizes="150px"
                className="w-[150px]"
              >
                {g.photo && <Image src={g.photo} alt="" aria-hidden fill sizes="150px" quality={70} className="object-cover" />}
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
            href={end === "new" ? "/groups/new" : "/groups"}
            className="flex min-h-[170px] flex-1 items-center justify-center rounded-md border border-dashed border-fg/25 px-3 text-center text-sm font-medium text-fg/80 active:bg-mist"
            data-group-card-end={end}
          >
            {end === "new" ? "+ New group" : `See all ${total} groups`}
          </Link>
        </li>
      )}
    </ul>
  );
}
