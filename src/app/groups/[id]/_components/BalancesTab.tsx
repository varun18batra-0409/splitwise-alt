import Link from "@/components/Link";
import { PassportIcon, PeoplePassportsIcon, SquareSeal } from "@/components/DrawnIcons";
import { Notice } from "@/components/Notice";
import { formatMoney, formatPercent } from "@/lib/money";
import { foreignPartLine, ledgerSummary } from "@/lib/foreign-part";
import { niceDate } from "@/lib/format";
import { overviewMoney } from "@/lib/money-display";
import { Avatar } from "@/components/ui";
import type { GroupView } from "./view";
import { WhyPanel } from "./WhyPanel";
import { funTitles } from "@/lib/wrapped";
import { explainAll } from "@/lib/explain";

// Balances answers one question: who owes what, and why.
// Paying (Mark paid, Part, Remind, Settle everything) lives on Settle up,
// so it's in one place only. The group's details (other currencies, totals,
// card fee) sit here rather than crowding the top of the group.
export function BalancesTab({ v, paid, why }: { v: GroupView; paid?: boolean; why?: string }) {
  const { group, myId, net, transfers, nameOf, money, expenses, payments, ledgers, hasMarkup, signed, eq, spent } = v;
  const mine = net[myId] ?? 0;
  const people = group.members.filter((m) => !m.leftAt);
  // Fun titles (habits, never money rankings): one per person at most.
  const leaver = v.leaver;
  const titles = group.type === "pot" || leaver ? [] : funTitles(expenses, people.map((m) => m.id), v.tz, group.currency);

  // Everyone's "Why?" totals in one pass; only the open one gets its item list.
  const whyTotals = explainAll(group.members.map((m) => m.id), expenses, payments);

  return (
    <div className="space-y-10">
      {paid && <Notice params={["paid"]}>Payment recorded. Balances updated.</Notice>}

      {transfers.length === 0 ? (
        <div className="rounded-[20px] border border-line bg-white px-4 py-8 text-center">
          <SquareSeal size={56} className="mx-auto" />
          <p className="mt-3 font-display text-xl font-semibold">All square</p>
          <p className="mt-1 text-sm text-gray-500">{leaver ? "You don’t owe anyone here, and no one owes you." : "Nobody owes anybody in this group."}</p>
          {expenses.length > 0 && (
            <Link href={`/groups/${group.id}/square`} className="mt-4 inline-flex min-h-11 items-center rounded-full border border-fg/25 px-4 text-sm font-semibold text-fg">
              Share the moment
            </Link>
          )}
        </div>
      ) : null}
      {/* "3 payments clear everything" is the ticket line at the top of the group; it is not repeated here. */}

      {/* Each person: their balance; tap for exactly why, and who they pay. */}
      <section>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-semibold tracking-tight">By person</h2>
          {!leaver && <Link href={`/groups/${group.id}/passports`} className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold underline underline-offset-4" data-our-passports>
            <span className="inline-flex items-center gap-1.5">
              <PeoplePassportsIcon size={16} /> Our passports
            </span>
          </Link>}
        </div>
        <p className="mb-3 text-sm text-gray-500">{leaver ? "Tap to see why." : "Tap anyone to see why."}</p>
        <ul className="divide-y divide-line">
          {/* Someone who left sees only their own line. */}
          {group.members.filter((m) => (leaver ? m.id === myId : !m.leftAt || (net[m.id] ?? 0) !== 0)).map((m) => {
            const b = net[m.id] ?? 0;
            const theirs = transfers.filter((t) => t.from === m.id || t.to === m.id);
            // Their part of the spending in each foreign currency, said plainly: "Thai baht part: you owe THB 5,099.17".
            const foreignParts = ledgers.map((l) => ({ currency: l.currency, amount: l.net[m.id] ?? 0 }));
            const foreign = b === 0 ? "" : foreignPartLine(foreignParts, m.id === myId, overviewMoney);
            const foreignExact = b === 0 ? "" : foreignPartLine(foreignParts, m.id === myId);
            return (
              <li key={m.id}>
                <details className="group/person" open={why === m.id}>
                  <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
                    <Avatar name={m.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{m.id === myId ? `${m.name} (you)` : m.name}</span>
                      {(() => {
                        const t = titles.find((x) => x.memberId === m.id);
                        return t ? (
                          <span className="mb-0.5 mt-0.5 inline-block rounded-full border border-fg/15 px-2 py-0.5 text-[11px] font-semibold text-fg/75" title={t.why} data-title={t.title}>
                            {t.title}
                          </span>
                        ) : null;
                      })()}
                      <span className={`block text-xs text-gray-400 ${foreign ? "break-words" : "truncate"}`} data-foreign-part={foreign ? "1" : undefined} title={foreign ? foreignExact : undefined} data-exact={foreign ? foreignExact : undefined}>
                        {foreign || eq(b) || (theirs.length ? `${theirs.length} payment${theirs.length === 1 ? "" : "s"} to settle` : "settled up")}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-right money tabular-nums ${b > 0 ? "text-owed" : b < 0 ? "text-owe" : "text-gray-400"}`}
                      title={b !== 0 ? money(Math.abs(b)) : undefined}
                      data-exact={b !== 0 ? money(Math.abs(b)) : undefined}
                      data-balance={b !== 0 ? money(Math.abs(b)) : "0"}
                    >
                      {b > 0 ? `gets ${overviewMoney(b, group.currency)}` : b < 0 ? `owes ${overviewMoney(-b, group.currency)}` : "settled"}
                    </span>
                    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg/40 transition-transform group-open/person:rotate-90 motion-reduce:transition-none">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </summary>
                  <div className="mb-3 space-y-2">
                    {m.accountId && m.id !== myId && (
                      <Link href={`/groups/${group.id}/passport/${m.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold active:bg-mist" data-passport-link>
                        <PassportIcon size={14} /> {m.name.trim().split(/\s+/)[0]}’s passport
                      </Link>
                    )}
                    <WhyPanel v={v} memberId={m.id} open={why === m.id} summary={whyTotals[m.id]} />
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
          <p
            className="mb-3 text-sm text-gray-500"
            data-ledger-summary
            title={ledgerSummary(ledgers.map((l) => ({ currency: l.currency, amount: l.net[myId] ?? 0 })), mine, group.currency)}
            data-exact={ledgerSummary(ledgers.map((l) => ({ currency: l.currency, amount: l.net[myId] ?? 0 })), mine, group.currency)}
          >
            {ledgerSummary(ledgers.map((l) => ({ currency: l.currency, amount: l.net[myId] ?? 0 })), mine, group.currency, overviewMoney)}{hasMarkup ? " Overall includes card fees." : ""}
          </p>
          <ul className="divide-y divide-line rounded-[20px] border border-line bg-white">
            {ledgers.map((l) => {
              const val = l.net[myId] ?? 0;
              return (
                <li key={l.currency} className="flex flex-col gap-1 px-4 py-3">
                  <span className="block min-w-0">
                    <span className="block text-sm font-medium">{l.currency} expenses</span>
                    <span className="block text-xs text-gray-400" title={formatMoney(l.spent, l.currency)} data-exact={formatMoney(l.spent, l.currency)}>
                      {overviewMoney(l.spent, l.currency)} spent
                      {payments.some((p) => p.fromId === myId || p.toId === myId) ? ", before payments" : ""}
                    </span>
                  </span>
                  <span
                    className={`block text-sm money tabular-nums ${val > 0 ? "text-owed" : val < 0 ? "text-owe" : "text-gray-400"}`}
                    title={val !== 0 ? formatMoney(Math.abs(val), l.currency) : undefined}
                    data-exact={val !== 0 ? formatMoney(Math.abs(val), l.currency) : undefined}
                  >
                    {val > 0 ? `you’re owed ${overviewMoney(val, l.currency)}` : val < 0 ? `you owe ${overviewMoney(-val, l.currency)}` : "even"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-1 text-sm text-gray-500">
        <p>
          <span title={money(spent)} data-exact={money(spent)}>{overviewMoney(spent, group.currency)}</span>
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
