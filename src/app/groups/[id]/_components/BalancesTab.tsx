import Link from "next/link";
import { pairwiseDebtCount, type Transfer } from "@/lib/settle";
import { toInputAmount } from "@/lib/money";
import { recordPayment, settleEverything } from "@/app/actions";
import { nudgeLink } from "@/lib/nudge";
import { planKey } from "@/lib/settle-all";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Avatar } from "@/components/ui";
import type { GroupView } from "./view";

// Smart Settle inside a group:
//  1. your payments (what you pay / get) first,
//  2. payments between other people,
//  3. by person — tap anyone to see exactly what's due between them and the others.
// Every payment can be recorded in full ("Mark as paid") or in part ("Part").
export function BalancesTab({ v, paid }: { v: GroupView; paid?: boolean }) {
  const { group, myId, net, transfers, nameOf, money, expenses, payments, ledgers, hasMarkup, signed, eq } = v;
  const before = pairwiseDebtCount(expenses, payments);
  const mine = transfers.filter((t) => t.from === myId || t.to === myId);
  const others = transfers.filter((t) => t.from !== myId && t.to !== myId);
  const payHref = (from = "", to = "", amount?: number) =>
    `/groups/${group.id}/pay?${new URLSearchParams({ from, to, ...(amount ? { amount: toInputAmount(amount, group.currency) } : {}) })}`;

  return (
    <div className="space-y-10">
      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold tracking-tight">Smart Settle</h2>
          {!group.closed && (
            <Link href={payHref()} className="shrink-0 border border-line px-3 py-1.5 text-sm font-medium text-fg active:bg-mist">
              + Record payment
            </Link>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">
          The fewest payments that clear every debt.
          {transfers.length > 0 && before > transfers.length && ` ${transfers.length} instead of ${before}.`}
        </p>

        {paid && <p className="mt-3 rounded-xl bg-mist px-4 py-3 text-sm text-fg">Payment recorded. Balances updated.</p>}

        {transfers.length === 0 ? (
          <div className="mt-4 rounded-2xl bg-mist px-4 py-8 text-center">
            <p className="text-3xl" aria-hidden>
              🎉
            </p>
            <p className="mt-2 font-display text-xl font-semibold">All square</p>
            <p className="mt-1 text-sm text-gray-500">Nobody owes anybody in this group.</p>
          </div>
        ) : (
          <>
            {mine.length > 0 && (
              <>
                <h3 className="mb-2 mt-5 text-sm font-medium text-gray-600">Your payments</h3>
                <TransferList v={v} list={mine} payHref={payHref} />
              </>
            )}
            {others.length > 0 && (
              <>
                <h3 className="mb-2 mt-5 text-sm font-medium text-gray-600">Between others</h3>
                <TransferList v={v} list={others} payHref={payHref} />
              </>
            )}
          </>
        )}
        <p className="mt-3 text-xs text-gray-400">Recording a payment only notes it here. The app never moves real money.</p>

        {!group.closed && (
          <details className="group/kill mt-6 border border-line">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
              <span>
                <span className="block text-sm font-medium text-fg">
                  {transfers.length > 0 ? "Settled outside the app?" : "Done with this group?"}
                </span>
                <span className="block text-xs text-gray-400">
                  {transfers.length > 0 ? "Mark everything as paid and close the group in one go" : "Everyone’s square, so you can close it"}
                </span>
              </span>
              <span className="shrink-0 text-sm text-gray-400 group-open/kill:rotate-180">⌄</span>
            </summary>
            <form action={settleEverything} className="border-t border-line px-4 pb-4 pt-3">
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="plan" value={planKey(transfers)} />
              {transfers.length > 0 && (
                <>
                  <p className="mb-2 text-sm text-gray-500">This records these payments, then closes the group:</p>
                  <ul className="mb-4 space-y-1 text-sm">
                    {transfers.map((t) => (
                      <li key={`${t.from}-${t.to}`} className="flex justify-between gap-3">
                        <span>
                          {nameOf(t.from)} → {t.to === myId ? "you" : nameOf(t.to)}
                        </span>
                        <span className="tabular-nums">{money(t.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <ConfirmButton
                message={
                  transfers.length > 0
                    ? `Mark all ${transfers.length} payments as paid and close ${group.name}? Everyone will be notified. You can undo this.`
                    : `Close ${group.name}? You can reopen it any time.`
                }
                className="pop block w-full bg-fg px-4 py-3 text-center text-sm font-semibold text-canvas [--pop-edge:#6e6b63]"
              >
                {transfers.length > 0 ? "Settle everything & close" : "Close group"}
              </ConfirmButton>
              <p className="mt-2 text-xs text-gray-400">One Undo puts everything back.</p>
            </form>
          </details>
        )}
      </section>

      {/* Between people: each person's balance and exactly who they pay / get paid by. */}
      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight">By person</h2>
        <p className="mb-3 text-sm text-gray-500">
          In {group.currency}
          {hasMarkup ? ", including card markup" : ""}.
          {ledgers.length > 0 && ` Small figures: ${ledgers.map((l) => l.currency).join(", ")} expenses only, without markup.`} Tap a
          person to see what’s due between them and the others.
        </p>
        <ul className="divide-y divide-line border-y border-line">
          {group.members.filter((m) => !m.leftAt || (v.net[m.id] ?? 0) !== 0).map((m) => {
            const b = net[m.id] ?? 0;
            const theirs = transfers.filter((t) => t.from === m.id || t.to === m.id);
            const foreign = ledgers.map((l) => signed(l.net[m.id] ?? 0, l.currency)).join(" · ");
            return (
              <li key={m.id}>
                <details className="group/person">
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
                    {theirs.length === 0 ? (
                      <p className="text-sm text-gray-500">Nothing due between {m.id === myId ? "you" : m.name} and anyone.</p>
                    ) : (
                      <TransferList v={v} list={theirs} payHref={payHref} compact />
                    )}
                    {!group.closed && (
                      <Link href={payHref(m.id)} className="inline-block py-1 text-xs font-semibold text-fg">
                        Record another payment from {m.id === myId ? "you" : m.name}
                      </Link>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function TransferList({
  v,
  list,
  payHref,
  compact,
}: {
  v: GroupView;
  list: Transfer[];
  payHref: (from?: string, to?: string, amount?: number) => string;
  compact?: boolean;
}) {
  const { group, myId, nameOf, money, eq } = v;
  return (
    <ul className={compact ? "space-y-1.5" : "space-y-2"}>
      {list.map((t) => (
        <li key={`${t.from}-${t.to}`} className={`border px-4 py-3 ${t.from === myId || t.to === myId ? "border-gray-300 bg-white" : "border-line"}`}>
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-sm">
              <strong className="font-medium">{nameOf(t.from)}</strong>
              <span className="text-gray-500"> {t.from === myId ? "pay" : "pays"} </span>
              <strong className="font-medium">{t.to === myId ? "you" : nameOf(t.to)}</strong>
            </p>
            <p className="shrink-0 text-right font-display font-semibold tabular-nums">
              {money(t.amount)}
              {eq(t.amount) && <span className="block font-sans text-xs font-normal text-gray-400">{eq(t.amount)}</span>}
            </p>
          </div>
          {!group.closed && (
            <div className="mt-2 flex justify-end gap-2">
              {t.to === myId && (
                <a
                  href={nudgeLink(group.members.find((m) => m.id === t.from)?.phone ?? "", nameOf(t.from), money(t.amount), group.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mr-auto border border-line px-3 py-1.5 text-sm text-gray-600 active:bg-mist"
                >
                  Remind
                </a>
              )}
              <Link href={payHref(t.from, t.to, t.amount)} className="border border-line px-3 py-1.5 text-sm text-gray-600 active:bg-mist">
                Part
              </Link>
              <form action={recordPayment}>
                <input type="hidden" name="groupId" value={group.id} />
                <input type="hidden" name="fromId" value={t.from} />
                <input type="hidden" name="toId" value={t.to} />
                <input type="hidden" name="amount" value={t.amount} />
                <button type="submit" className="border border-line px-3 py-1.5 text-sm font-medium text-fg active:bg-mist">
                  Mark as paid
                </button>
              </form>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

