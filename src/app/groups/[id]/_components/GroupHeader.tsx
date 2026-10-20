import Link from "@/components/Link";
import { BackIcon, ChevronDown, GearIcon, InviteIcon, iconButtonClass } from "@/components/icons";
import { GroupCover } from "@/components/GroupCover";
import { coverOf, type CoverChoice } from "@/lib/covers";
import type { GroupView } from "./view";

type SwitchItem = { id: string; name: string; cover?: CoverChoice };

// Back to all groups · group name (tap to switch group) · Invite · Settings.
// Home, Search and Settle also live in the bottom bar.
export function GroupHeader({ v, switchTo }: { v: GroupView; switchTo: SwitchItem[] }) {
  const { group, myId } = v;
  const me = group.members.find((m) => m.id === myId);
  const cover = coverOf(group);

  const switcher = (big: boolean) => (
    <details className="group/switch relative min-w-0 flex-1">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        <h1 className={`truncate font-display font-semibold tracking-tight ${big ? "text-[32px] leading-tight" : "text-[22px]"}`}>{group.name}</h1>
        <span className={`shrink-0 transition-transform group-open/switch:rotate-180 ${big ? "text-fg/80" : "text-gray-400"}`}>
          <ChevronDown size={18} />
        </span>
        <span className="sr-only">Switch group</span>
      </summary>
      <div className="absolute left-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2.5rem)] rounded-2xl border border-line bg-white p-2 shadow-2xl shadow-black/60">
        {switchTo.length === 0 ? (
          <p className="px-3 py-2 text-sm text-gray-500">No other open groups.</p>
        ) : (
          <>
            <p className="px-3 pb-1 pt-1.5 text-xs text-gray-400">Switch to</p>
            <ul>
              {switchTo.map((g) => (
                <li key={g.id}>
                  <Link href={`/groups/${g.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2 active:bg-mist">
                    {g.cover && (
                      <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg" aria-hidden>
                        <GroupCover kind={g.cover} uid={`sw-${g.id}`} letter={g.name} letterClass="text-sm" sizes="32px" />
                      </span>
                    )}
                    <span className="truncate font-medium">{g.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {/* Who this phone is in this group — and a way to fix a wrong pick. */}
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-line px-3 pb-1 pt-2.5 text-xs text-gray-400">
          <span className="truncate">You’re {me?.name ?? "—"} in this group</span>
          <Link href={`/groups/${group.id}/invite`} className="shrink-0 font-semibold text-fg">
            Add people
          </Link>
        </div>
      </div>
    </details>
  );

  // A plain group (no picture): the compact header.
  if (cover === "plain") {
    return (
      <header className="mb-8 flex items-center gap-2">
        <Link href="/" aria-label="Back to all groups" className={iconButtonClass}>
          <BackIcon size={20} />
        </Link>
        {switcher(false)}
        <Link href={`/groups/${group.id}/invite`} aria-label="Add people" className={iconButtonClass}>
          <InviteIcon size={20} />
        </Link>
        <Link href={`/groups/${group.id}/settings`} aria-label="Group settings" className={iconButtonClass}>
          <GearIcon size={20} />
        </Link>
      </header>
    );
  }

  // With a picture: it runs edge to edge behind the buttons and the name.
  const glass = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-canvas/55 text-fg backdrop-blur active:bg-canvas/80";
  const type = ({ trip: "Trip", home: "Home", couple: "Couple" } as Record<string, string | undefined>)[group.type];
  const people = group.members.filter((m) => !m.leftAt).length;
  return (
    <header className="relative -mx-5 -mt-[max(1.5rem,env(safe-area-inset-top))] mb-6 h-[232px] px-5 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        <GroupCover kind={cover} uid={`head-${group.id}`} letter={group.name} sizes="(max-width: 448px) 100vw, 448px" priority drift />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(13,13,15,0.45)_0%,rgba(13,13,15,0)_30%,rgba(13,13,15,0)_42%,#0d0d0f_100%)]" />
      </div>
      <div className="relative flex items-center gap-2">
        <Link href="/" aria-label="Back to all groups" className={glass}>
          <BackIcon size={20} />
        </Link>
        <span className="flex-1" />
        <Link href={`/groups/${group.id}/invite`} aria-label="Add people" className={glass}>
          <InviteIcon size={20} />
        </Link>
        <Link href={`/groups/${group.id}/settings`} aria-label="Group settings" className={glass}>
          <GearIcon size={20} />
        </Link>
      </div>
      <div className="absolute inset-x-5 bottom-0">
        <p className="mb-1.5 inline-block rounded-full bg-canvas/55 px-2.5 py-1 text-xs font-semibold backdrop-blur">
          {type ? `${type} · ` : ""}
          {people} {people === 1 ? "person" : "people"}
        </p>
        <div className="flex">{switcher(true)}</div>
      </div>
    </header>
  );
}
