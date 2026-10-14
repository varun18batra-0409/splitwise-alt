import Link from "next/link";
import { formatMoney, formatPercent } from "@/lib/money";
import { niceDate } from "@/lib/format";
import { setGroupClosed } from "@/app/actions";
import type { GroupView } from "./view";

type Notices = { saved?: string; error?: string; added?: string; skipped?: string };

// Closed banner, your balance (group currency + each foreign currency), totals and notices.
export function GroupSummary({ v, sp }: { v: GroupView; sp: Notices }) {
  const { group, myId, net, money, eq, ledgers, hasMarkup, spent, expenses } = v;
  const mine = net[myId] ?? 0;

  return (
    <>
      {group.closed && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl bg-mist px-4 py-3 text-sm">
          <span className="text-gray-600">
            Closed{group.closedAt ? ` on ${niceDate(group.closedAt.toISOString().slice(0, 10))}` : ""}. History stays here; new expenses are
            paused.
          </span>
          <form action={setGroupClosed}>
            <input type="hidden" name="groupId" value={group.id} />
            <input type="hidden" name="closed" value="0" />
            <button type="submit" className="shrink-0 font-medium text-accent">
              Reopen
            </button>
          </form>
        </div>
      )}

      <section className="mb-6">
        <p className="text-sm text-gray-500">Your balance</p>
        <p
          className={`font-display text-[32px] font-semibold leading-tight tracking-tight tabular-nums ${
            mine > 0 ? "text-owed" : mine < 0 ? "text-owe" : ""
          }`}
        >
          {mine > 0 ? `You’re owed ${money(mine)}` : mine < 0 ? `You owe ${money(-mine)}` : "All square"}
        </p>
        {mine !== 0 && eq(mine) && <p className="font-display text-lg tabular-nums text-gray-500">{eq(mine)}</p>}
        {hasMarkup && <p className="mt-0.5 text-xs text-gray-400">In {group.currency}, including card markup.</p>}

        {/* The same, in each foreign currency the group spent in, without card markup. */}
        {ledgers.length > 0 && (
          <ul className="mt-4 divide-y divide-line border border-line bg-white">
            {ledgers.map((l) => {
              const val = l.net[myId] ?? 0;
              return (
                <li key={l.currency} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{l.currency} expenses</span>
                    <span className="block text-xs text-gray-400">{formatMoney(l.spent, l.currency)} spent · no card markup</span>
                  </span>
                  <span
                    className={`shrink-0 text-right font-display tabular-nums ${val > 0 ? "text-owed" : val < 0 ? "text-owe" : "text-gray-400"}`}
                  >
                    {val > 0 ? `owed ${formatMoney(val, l.currency)}` : val < 0 ? `owe ${formatMoney(-val, l.currency)}` : "even"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {v.secondary && (
          <p className="mt-1 text-xs text-gray-400">
            {v.secondaryRate
              ? `1 ${group.currency} = ${v.secondaryRate.rate} ${v.secondary}, rate for ${niceDate(v.secondaryRate.date)}`
              : `No live ${group.currency} → ${v.secondary} rate right now, so ${v.secondary} amounts are hidden.`}
          </p>
        )}
        <p className="mt-2 text-sm text-gray-500">
          {money(spent)}
          {eq(spent) && ` (${eq(spent)})`} spent across {expenses.length} {expenses.length === 1 ? "expense" : "expenses"},{" "}
          {group.members.length} people
          <Link href={`/groups/${group.id}/settings`} className="ml-1 text-gray-400">
            ({group.currency}, card markup {formatPercent(group.cardMarkupBp)})
          </Link>
        </p>

        {sp.saved === "settings" && <p className="mt-2 text-sm text-accent-dark">Settings saved. Everyone in the group has been notified.</p>}
        {sp.error && <p className="mt-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{sp.error}</p>}
        {sp.added !== undefined && (
          <p className="mt-2 text-sm text-accent-dark">
            {Number(sp.added) === 1 ? "1 person added." : `${Number(sp.added) || 0} people added.`}
            {sp.skipped && <span className="text-gray-600"> Already in the group: {sp.skipped}.</span>}
          </p>
        )}
      </section>
    </>
  );
}
