import Link from "@/components/Link";
import { GroupCover } from "@/components/GroupCover";
import { coverFor } from "@/lib/covers";
import { placePhoto } from "@/lib/places";
import { formatMoney } from "@/lib/money";
import { overviewMoney } from "@/lib/money-display";
import { dayLabel } from "@/lib/activity";
import { ChevronRight } from "@/components/icons";
import type { loadOverview } from "@/lib/overview";

// The full list of groups (the "See all" page from Home): open groups with their photo, what happened last and your balance,
// and closed groups tucked into a quieter row. Home itself shows groups as polaroid cards (HomeGroups.tsx).

type Entry = Awaited<ReturnType<typeof loadOverview>>["all"][number];

export const peopleCount = (n: number) => (n === 1 ? "1 person" : `${n} people`);

export function activeText(d: Date, tz: string): string {
  const day = dayLabel(d, new Date(), tz);
  return day === "Today" || day === "Yesterday" ? `active ${day.toLowerCase()}` : `active ${day}`;
}

export function GroupRow({ g, closed, tz }: { g: Entry; closed?: boolean; tz: string }) {
  const b = g.myBalance;
  return (
    <li>
      <Link href={`/groups/${g.group.id}`} className="flex min-h-11 items-center gap-3 py-3.5 active:bg-mist">
        <span className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-xl ${closed ? "opacity-50 grayscale" : ""}`} aria-hidden>
          <GroupCover {...coverFor(g.group)} uid={`row-${g.group.id}`} letter={g.group.name} letterClass="text-lg" sizes="44px" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${closed ? "text-gray-500" : ""}`}>{g.group.name}</span>
          <span className="block truncate text-sm text-gray-400">
            {peopleCount(g.people)}, {closed ? "closed" : activeText(g.lastActivity, tz)}
          </span>
        </span>
        <span title={b !== 0 ? formatMoney(Math.abs(b), g.group.currency) : undefined} data-exact={b !== 0 ? formatMoney(Math.abs(b), g.group.currency) : undefined} className={`shrink-0 text-right text-sm tabular-nums ${b > 0 ? "text-owed" : b < 0 ? "text-owe" : "text-gray-400"}`}>
          {b > 0 ? `owed ${overviewMoney(b, g.group.currency)}` : b < 0 ? `owe ${overviewMoney(-b, g.group.currency)}` : "settled"}
        </span>
      </Link>
    </li>
  );
}

// A group in the full list (Your groups): its photo, its name, and one quiet line: "6 people · You owe ₹54,122".
// The amount alone wears the money colour; a flat with nothing owed says what it is for, anything else says "All settled".
export function GroupLine({ g, tz }: { g: Entry; tz: string }) {
  void tz;
  const b = g.myBalance;
  const photo = g.group.type === "trip" && !g.group.cover ? placePhoto(g.group.name)?.src : undefined;
  const exact = b !== 0 ? formatMoney(Math.abs(b), g.group.currency) : undefined;
  return (
    <li data-name={g.group.name.toLowerCase()}>
      <Link href={`/groups/${g.group.id}`} className="flex items-center gap-3.5 rounded-[20px] border border-line bg-white p-2.5 pr-3.5 active:opacity-80" data-group-line>
        <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[12px] bg-mist" aria-hidden>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />
          ) : (
            <GroupCover {...coverFor(g.group)} uid={`line-${g.group.id}`} letter={g.group.name} letterClass="text-lg" sizes="64px" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 break-words font-display text-[17px] font-semibold leading-tight tracking-tight">{g.group.name}</span>
          <span className="mt-0.5 block text-[13px] text-fg/60">
            {peopleCount(g.people)} ·{" "}
            {b > 0 ? (
              <>
                You’re owed{" "}
                <span title={exact} data-exact={exact} className="money whitespace-nowrap text-owed">
                  {overviewMoney(b, g.group.currency)}
                </span>
              </>
            ) : b < 0 ? (
              <>
                You owe{" "}
                <span title={exact} data-exact={exact} className="money whitespace-nowrap text-owe">
                  {overviewMoney(-b, g.group.currency)}
                </span>
              </>
            ) : g.group.type === "home" ? (
              "Bills & shopping"
            ) : (
              "All settled"
            )}
          </span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-fg/55" />
      </Link>
    </li>
  );
}
