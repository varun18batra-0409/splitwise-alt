import Link from "@/components/Link";
import { PassportIcon, PeoplePassportsIcon, SquareSeal } from "@/components/DrawnIcons";
import { pairwiseDebtCount } from "@/lib/settle";
import { Notice } from "@/components/Notice";
import { formatMoney, formatPercent } from "@/lib/money";
import { niceDate } from "@/lib/format";
import { Avatar } from "@/components/ui";
import type { GroupView } from "./view";
import { WhyPanel } from "./WhyPanel";
import { funTitles } from "@/lib/wrapped";

// Balances answers one question: who owes what, and why.
// Paying (Mark as paid, Part, Remind, Settle everything) lives on Settle up,
// so it's in one place only. The group's details (other currencies, totals,
// card fee) sit here rather than crowding the top of the group.
export function BalancesTab({ v, paid, why }: { v: GroupView; paid?: boolean; why?: string }) {
  const { group, myId, net, transfers, nameOf, money, expenses, payments, ledgers, hasMarkup, signed, eq, spent } = v;
  const before = pairwiseDebtCount(expenses, payments);
  const mine = net[myId] ?? 0;
  const people = group.members.filter((m) => !m.leftAt);
  // Fun titles (habits, never money rankings): one per person at most.
  const titles = group.type === "pot" ? [] : funTitles(expenses, people.map((m) => m.id), v.tz, group.currency);

  return (
    <div className="space-y-10">
      {paid && <Notice params={["paid"]}>Payment recorded. Balances updated.</Notice>}

      {transfers.length === 0 ? (
        <div className="rounded-2xl bg-mist px-4 py-8 text-center">
          <SquareSeal size={56} className="mx-auto" />
          <p className="mt-3 font-display text-xl font-semibold">All square</p>
          <p className="mt-1 text-sm text-gray-500">Nobody owes anybody in this group.</p>
          {expenses.length > 0 && (
            <Link href={`/groups/${group.id}/square`} className="mt-4 inline-block rounded-full bg-fg px-4 py-2 text-sm font-semibold text-canvas">
              Share the moment
            </Link>
          )}
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

      {/* Everyone's title: a quiet list, like credits at the end of a film. */}
      {titles.length > 0 && (
        <section aria-label="Fun titles">
          <h2 className="font-display text-lg font-semibold tracking-tight">Titles</h2>
          <p className="mb-3 text-sm text-gray-500">Earned on this {group.type === "trip" ? "trip" : "group"} so far.</p>
          <ul className="divide-y divide-line rounded-[20px] border border-line px-4" data-titles>
            {titles.map((t) => {
              const m = group.members.find((x) => x.id === t.memberId);
              return (
                <li key={t.memberId} className="py-3" data-title-card={t.title}>
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-[15px] italic text-fg/90">{t.title}</span>
                    <span className="shrink-0 text-[13px] font-semibold text-fg/70">{m ? (m.id === myId ? "You" : m.name.split(" ")[0]) : "Someone"}</span>
                  </p>
                  <p className="mt-0.5 text-xs leading-snug text-gray-500">{t.why}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Each person: their balance; tap for exactly why, and who they pay. */}
      <section>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-semibold tracking-tight">By person</h2>
          <Link href={`/groups/${group.id}/passports`} className="shrink-0 text-sm font-semibold underline underline-offset-4" data-our-passports>
            <span className="inline-flex items-center gap-1.5">
              <PeoplePassportsIcon size={16} /> Our passports
            </span>
          </Link>
        </div>
        <p className="mb-3 text-sm text-gray-500">Tap anyone to see why.</p>
        <ul className="divide-y divide-line border-y border-line">
          {group.members.filter((m) => !m.leftAt || (net[m.id] ?? 0) !== 0).map((m) => {
            const b = net[m.id] ?? 0;
            const theirs = transfers.filter((t) => t.from === m.id || t.to === m.id);
            // Their part of the spending in each foreign currency, said plainly.
            const foreign =
              b === 0
                ? ""
                : ledgers
                    .map((l) => {
                      const x = l.net[m.id] ?? 0;
                      // "THB part: owes 5,099.17" (the currency named once).
                      return x === 0 ? "" : `${l.currency} part: ${x > 0 ? "gets" : "owes"} ${formatMoney(Math.abs(x), l.currency).replace(`${l.currency} `, "")}`;
                    })
                    .filter(Boolean)
                    .join(" · ");
            return (
              <li key={m.id}>
                <details className="group/person" open={why === m.id}>
                  <summary className="flex cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
                    <Avatar name={m.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{m.id === myId ? `${m.name} (you)` : m.name}</span>
                      {(() => {
                        const t = titles.find((x) => x.memberId === m.id);
                        return t ? (
                          <span className="mb-0.5 mt-0.5 inline-block rounded-full bg-fg/[0.07] px-2 py-0.5 text-[11px] font-semibold text-fg/80" title={t.why} data-title={t.title}>
                            {t.title}
                          </span>
                        ) : null;
                      })()}
                      <span className="block truncate text-xs text-gray-400">
                        {foreign || eq(b) || (theirs.length ? `${theirs.length} payment${theirs.length === 1 ? "" : "s"} to settle` : "settled up")}
                      </span>
                    </span>
                    <span className={`shrink-0 text-right money tabular-nums ${b > 0 ? "text-owed" : b < 0 ? "text-owe" : "text-gray-400"}`}>
                      {b > 0 ? `gets ${money(b)}` : b < 0 ? `owes ${money(-b)}` : "settled"}
                    </span>
                  </summary>
                  <div className="mb-3 ml-12 space-y-2">
                    {m.accountId && m.id !== myId && (
                      <Link href={`/groups/${group.id}/passport/${m.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold active:bg-mist" data-passport-link>
                        <PassportIcon size={14} /> {m.name.trim().split(/\s+/)[0]}’s passport
                      </Link>
                    )}
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
                            <span className="shrink-0 money tabular-nums">{money(t.amount)}</span>
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
                  <span className={`shrink-0 text-right money tabular-nums ${val > 0 ? "text-owed" : val < 0 ? "text-owe" : "text-gray-400"}`}>
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
