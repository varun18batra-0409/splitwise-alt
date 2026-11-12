import Link from "@/components/Link";
import { GroupCover } from "@/components/GroupCover";
import { coverFor } from "@/lib/covers";
import { placePhoto } from "@/lib/places";
import { formatMoney } from "@/lib/money";
import { dayLabel } from "@/lib/activity";
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
        <span className={`shrink-0 text-right text-sm tabular-nums ${b > 0 ? "text-owed" : b < 0 ? "text-owe" : "text-gray-400"}`}>
          {b > 0 ? `owed ${formatMoney(b, g.group.currency)}` : b < 0 ? `owe ${formatMoney(-b, g.group.currency)}` : "settled"}
        </span>
      </Link>
    </li>
  );
}

// A group in the full list: its photo, its name, what happened last, and your balance in it.
export function GroupLine({ g, tz }: { g: Entry; tz: string }) {
  const b = g.myBalance;
  const photo = g.group.type === "trip" && !g.group.cover ? placePhoto(g.group.name)?.src : undefined;
  return (
    <li>
      <Link href={`/groups/${g.group.id}`} className="flex items-center gap-3.5 py-2.5 active:opacity-80" data-group-line>
        <span className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-[16px] bg-mist" aria-hidden>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />
          ) : (
            <GroupCover {...coverFor(g.group)} uid={`line-${g.group.id}`} letter={g.group.name} letterClass="text-lg" sizes="52px" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold tracking-tight">{g.group.name}</span>
          <span className="block truncate text-[13px] text-fg/50">
            {peopleCount(g.people)}, {activeText(g.lastActivity, tz)}
          </span>
        </span>
        <span className="shrink-0 text-right leading-tight">
          <span className={`money block text-[17px] ${b > 0 ? "text-owed" : b < 0 ? "text-owe" : "text-fg/60"}`}>
            {b > 0 ? `+${formatMoney(b, g.group.currency)}` : b < 0 ? `−${formatMoney(-b, g.group.currency)}` : "Settled"}
          </span>
          {b !== 0 && <span className="block text-[11px] text-fg/60">{b > 0 ? "you’re owed" : "you owe"}</span>}
        </span>
      </Link>
    </li>
  );
}
