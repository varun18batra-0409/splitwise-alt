import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { ChevronDown, GearIcon, InviteIcon, iconButtonClass } from "@/components/icons";
import type { GroupView } from "./view";

type SwitchItem = { id: string; name: string; currency: string; myBalance: number };

// Group name (tap to switch group) · Invite · Settings. Home, Search and
// Settle live in the bottom bar.
export function GroupHeader({ v, switchTo }: { v: GroupView; switchTo: SwitchItem[] }) {
  const { group, myId } = v;
  const me = group.members.find((m) => m.id === myId);
  return (
    <header className="mb-8 flex items-center gap-2">
      <details className="group/switch relative min-w-0 flex-1">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
          <h1 className="truncate font-display text-[22px] font-semibold tracking-tight">{group.name}</h1>
          <span className="shrink-0 text-gray-400 transition-transform group-open/switch:rotate-180">
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
                    <Link href={`/groups/${g.id}`} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 active:bg-mist">
                      <span className="truncate font-medium">{g.name}</span>
                      <span className={`shrink-0 text-xs tabular-nums ${g.myBalance > 0 ? "text-owed" : g.myBalance < 0 ? "text-owe" : "text-gray-400"}`}>
                        {g.myBalance > 0
                          ? `+${formatMoney(g.myBalance, g.currency)}`
                          : g.myBalance < 0
                            ? `−${formatMoney(-g.myBalance, g.currency)}`
                            : "settled"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {/* Who this phone is in this group — and a way to fix a wrong pick. */}
          <div className="mt-1 flex items-center justify-between gap-3 border-t border-line px-3 pb-1 pt-2.5 text-xs text-gray-400">
            <span className="truncate">On this phone you’re {me?.name ?? "—"}</span>
            <Link href={`/join/${group.inviteCode}`} className="shrink-0 font-semibold text-fg">
              Switch person
            </Link>
          </div>
        </div>
      </details>

      <Link href={`/groups/${group.id}/invite`} aria-label="Invite people" className={iconButtonClass}>
        <InviteIcon size={20} />
      </Link>
      <Link href={`/groups/${group.id}/settings`} aria-label="Group settings" className={iconButtonClass}>
        <GearIcon size={20} />
      </Link>
    </header>
  );
}
