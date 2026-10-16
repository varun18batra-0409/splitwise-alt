import Link from "@/components/Link";
import { pairwiseDebtCount } from "@/lib/settle";
import { formatMoney, formatPercent } from "@/lib/money";
import { niceDate } from "@/lib/format";
import { Avatar } from "@/components/ui";
import type { GroupView } from "./view";
import { WhyPanel } from "./WhyPanel";

// Balances answers one question: who owes what, and why.
// Paying (Mark as paid, Part, Remind, Settle everything) lives on Settle up,
// so it's in one place only. The group's details (other currencies, totals,
// card fee) sit here rather than crowding the top of the group.
export function BalancesTab({ v, paid, why }: { v: GroupView; paid?: boolean; why?: string }) {
  const { group, myId, net, transfers, nameOf, money, expenses, payments, ledgers, hasMarkup, signed, eq, spent } = v;
  const before = pairwiseDebtCount(expenses, payments);
  const mine = net[myId] ?? 0;
  const people = group.members.filter((m) => !m.leftAt);

  return (
    <div className="space-y-10">
      {paid && <p className="rounded-xl bg-mist px-4 py-3 text-sm text-fg">Payment recorded. Balances updated.</p>}

      {transfers.length === 0 ? (
        <div className="rounded-2xl bg-mist px-4 py-8 text-center">
          <p className="text-3xl" aria-hidden>
            🎉
          </p>
          <p className="mt-2 font-display text-xl font-semibold">All square</p>
          <p className="mt-1 text-sm text-gray-500">Nobody owes anybody in this group.</p>
        </div>
      ) : (
        <section className="rounded-2xl border border-line px-4 py-4">
          <p className="min-w-0 text-sm text-gray-500">
            <span className="block font-display text-lg font-semibold text-fg">
              {transfers.length} {transfers.length === 1 ? "payment clears" : "payments clear"} everything
            </span>
            {before > transfers.length ? `Instead of ${before}, thanks to Smart Settle.` : "The fewest payments possible."}
          </p>
        </section>
      )}

      {/* Each person: their balance; tap for exactly why, and who they pay. */}
      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight">By person</h2>
        <p className="mb-3 text-sm text-gray-500">Tap anyone to see why.</p>
        <ul className="divide-y divide-line border-y border-line">
          {group.members.filter((m) => !m.leftAt || (net[m.id] ?? 0) !== 0).map((m) => {
            const b = net[m.id] ?? 0;
            const theirs = transfers.filter((t) => t.from === m.id || t.to === m.id);
            const foreign = b === 0 ? "" : ledgers.map((l) => signed(l.net[m.id] ?? 0, l.currency)).join(" · ");
            return (
              <li key={m.id}>
                <details className="group/person" open={why === m.id}>
                  <summary className="flex cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
                    <Avatar name={m.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{m.id === myId ? `${m.name} (you)` : m.name}</span>
                      <span className="block truncate text-xs text-gray-400">
                        {foreign || eq(b) || (theirs.length ? `${theirs.length} payment${theirs.length === 1 ? "" : "s"} to settle` : "settled up")}
                      </span>
                    </span>
                    <span className={`shrink-0 text-right font-display tabular-nums ${b > 0 ? "text-owed" : b < 0 ? "text-owe" : "text-gray-400"}`}>
                      {b > 0 ? `gets ${money(b)}` : b < 0 ? `owes ${money(-b)}` : "settled"}
                    </span>
                  </summary>
                  <div className="mb-3 ml-12 space-y-2">
                    <WhyPanel v={v} memberId={m.id} open={why === m.id} />
                    {theirs.length === 0 ? (
                      <p className="text-sm text-gray-500">Nothing due between {m.id === myId ? "you" : m.name} and anyone.</p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {theirs.map((t) => (
                          <li key={`${t.from}-${t.to}`} className="flex justify-between gap-3">
                            <span className="min-w-0 text-gray-600">
                              {t.from === myId ? "You pay" : `${nameOf(t.from)} pays`} {t.to === myId ? "you" : nameOf(t.to)}
                            </span>
                            <span className="shrink-0 font-display tabular-nums">{money(t.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Your balance in each foreign currency the group spent in, without card markup.
          Hidden once you're square: payments are in the group currency, so these would look wrong. */}
      {ledgers.length > 0 && mine !== 0 && (
        <section>
          <h2 className="font-display text-lg font-semibold tracking-tight">Spent in other currencies</h2>
          <p className="mb-3 text-sm text-gray-500">Your share of those expenses in their own currency, without card fees.</p>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {ledgers.map((l) => {
              const val = l.net[myId] ?? 0;
              return (
                <li key={l.currency} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{l.currency} expenses</span>
                    <span className="block text-xs text-gray-400">
                      {formatMoney(l.spent, l.currency)} spent
                      {payments.some((p) => p.fromId === myId || p.toId === myId) ? ", before payments" : ""}
                    </span>
                  </span>
                  <span className={`shrink-0 text-right font-display tabular-nums ${val > 0 ? "text-owed" : val < 0 ? "text-owe" : "text-gray-400"}`}>
                    {val > 0 ? `owed ${formatMoney(val, l.currency)}` : val < 0 ? `owe ${formatMoney(-val, l.currency)}` : "even"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-1 text-sm text-gray-500">
        <p>
          {money(spent)}
          {eq(spent) && ` (${eq(spent)})`} spent across {expenses.length} {expenses.length === 1 ? "expense" : "expenses"} by {people.length}{" "}
          {people.length === 1 ? "person" : "people"}.
        </p>
        <p className="text-xs text-gray-400">
          Amounts in {group.currency}
          {hasMarkup ? `, including card fees (${formatPercent(group.cardMarkupBp)} on card payments abroad)` : ""}.{" "}
          <Link href={`/groups/${group.id}/settings`} className="underline underline-offset-4">
            Change
          </Link>
        </p>
        {v.secondary && (
          <p className="text-xs text-gray-400">
            {v.secondaryRate
              ? `≈ amounts in ${v.secondary}: 1 ${group.currency} = ${v.secondaryRate.rate} ${v.secondary}, rate for ${niceDate(v.secondaryRate.date)}.`
              : `No live ${group.currency} → ${v.secondary} rate right now, so ${v.secondary} amounts are hidden.`}
          </p>
        )}
      </section>
    </div>
  );
}
