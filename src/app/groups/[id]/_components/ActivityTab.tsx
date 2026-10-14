import Link from "next/link";
import { buildActivity, byDay } from "@/lib/activity";
import { getCategory } from "@/lib/categories";
import { originalShares } from "@/lib/currency-ledgers";
import { dayKey, expenseDate } from "@/lib/dates";
import { parseDetails } from "@/lib/events";
import { niceDate, rateText } from "@/lib/format";
import { formatMoney, formatPercent } from "@/lib/money";
import { canUndo } from "@/lib/undo";
import { removePayment, restoreExpense, restorePayment, undoChange } from "@/app/actions";
import { ActivityRow } from "@/components/ActivityRow";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Line } from "./Line";
import type { GroupEvent, GroupView } from "./view";

const PAID_WITH: Record<string, string> = { card: "Card", cash: "Cash", bank: "Bank / UPI" };
const FOR_MODE: Record<string, string> = { everyone: "Everyone", selected: "Selected people", one: "One person" };

const when = (d: Date) =>
  d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Every expense, payment and group change, by day — tap one for its details,
// its history, and Edit / Delete / Restore / Undo.
export function ActivityTab({ v }: { v: GroupView }) {
  const { group, myId, nameOf, money, expenseById, eventById } = v;
  const items = buildActivity(group.expenses, group.payments, myId, group.events);
  const historyOf = (key: "expenseId" | "paymentId", id: string) =>
    group.events.filter((ev) => ev[key] === id).sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line py-10 text-center text-sm text-gray-500">
        {group.closed ? "This group had no expenses." : "No expenses yet. Tap Add expense below to add the first one."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {byDay(items).map((day) => (
        <section key={day.day}>
          <h2 className="sticky top-0 z-10 -mx-5 bg-canvas/95 px-5 py-1.5 text-sm font-medium text-gray-500 backdrop-blur">{day.day}</h2>
          <ul className="divide-y divide-line">
            {day.items.map((item) => {
              if (item.kind === "event") {
                const details = parseDetails(item.details);
                return (
                  <li key={item.id}>
                    <ActivityRow item={item} currency={group.currency} nameOf={nameOf} />
                    {details.length > 0 && (
                      <ul className="-mt-1 mb-2 ml-[3.25rem] space-y-0.5 text-xs text-gray-400">
                        {details.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    )}
                    <div className="-mt-1 mb-2 ml-[3.25rem]">
                      <UndoControl v={v} ev={eventById.get(item.id)} />
                    </div>
                  </li>
                );
              }

              if (item.kind === "payment") {
                const live = item.deletedById === null;
                return (
                  <li key={item.id}>
                    <details>
                      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                        <ActivityRow item={item} currency={group.currency} nameOf={nameOf} />
                      </summary>
                      <div className="mb-3 ml-[3.25rem] space-y-2 rounded-xl bg-mist p-3 text-sm text-gray-600">
                        <History v={v} events={historyOf("paymentId", item.id)} fallback={`Recorded ${when(item.date)}`} />
                        {!live && !group.closed && (
                          <form action={restorePayment}>
                            <input type="hidden" name="groupId" value={group.id} />
                            <input type="hidden" name="paymentId" value={item.id} />
                            <button type="submit" className="text-sm font-medium text-accent">
                              Restore payment
                            </button>
                          </form>
                        )}
                        {live && !group.closed && (
                          <form action={removePayment}>
                            <input type="hidden" name="groupId" value={group.id} />
                            <input type="hidden" name="paymentId" value={item.id} />
                            <ConfirmButton
                              message="Delete this payment? Balances will go back to before it was recorded."
                              className="text-sm font-medium text-red-700"
                            >
                              Delete payment
                            </ConfirmButton>
                          </form>
                        )}
                      </div>
                    </details>
                  </li>
                );
              }

              const e = expenseById.get(item.id)!;
              const cat = getCategory(e.category);
              const foreign = e.originalCurrency !== e.baseCurrency;
              const deleted = Boolean(e.deletedAt);
              const orig = foreign ? originalShares(e) : [];
              return (
                <li key={item.id}>
                  <details>
                    <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      <ActivityRow item={item} currency={group.currency} nameOf={nameOf} />
                    </summary>
                    <div className="mb-3 ml-[3.25rem] space-y-1.5 rounded-xl bg-mist p-3 text-sm text-gray-600">
                      <Line label="Date" value={niceDate(dayKey(expenseDate(e)))} />
                      <Line label="Category" value={`${cat.emoji} ${cat.label}`} />
                      {foreign && (
                        <>
                          <Line label="Original expense" value={formatMoney(e.originalAmount, e.originalCurrency)} />
                          <Line label="Exchange rate" value={`1 ${e.originalCurrency} = ${rateText(e.exchangeRate, e.baseCurrency)}`} />
                          <p className="-mt-1 text-right text-xs text-gray-400">
                            {e.rateSource === "manual"
                              ? "Entered by hand"
                              : e.rateSource === "converted"
                                ? "Adjusted when the group currency changed"
                                : "Live rate"}
                            {e.rateDate && `, ${niceDate(e.rateDate)}`}
                          </p>
                          <Line label="Paid with" value={PAID_WITH[e.paymentMethod] ?? "—"} />
                          <Line label="Converted amount" value={money(e.convertedAmount)} />
                          {e.paymentMethod === "card" && (
                            <Line label={`Card markup (${formatPercent(e.markupBp)})`} value={money(e.markupAmount)} />
                          )}
                        </>
                      )}
                      <Line label="Total group expense" value={money(e.amount)} strong />
                      <div className="border-t border-line pt-1.5">
                        <Line label="Paid by" value={nameOf(e.paidById)} />
                        <Line label="For" value={FOR_MODE[e.forMode] ?? "Everyone"} />
                        {e.shares.map((sh) => {
                          const o = orig.find((x) => x.memberId === sh.memberId);
                          return (
                            <Line
                              key={sh.id}
                              label={`  ${nameOf(sh.memberId)}`}
                              value={o ? `${formatMoney(o.amount, e.originalCurrency)} · ${money(sh.amount)}` : money(sh.amount)}
                            />
                          );
                        })}
                      </div>
                      <div className="border-t border-line pt-2">
                        <History v={v} events={historyOf("expenseId", e.id)} fallback={`Added by ${nameOf(e.createdById)}, ${when(e.createdAt)}`} />
                      </div>
                      {!group.closed && (
                        <div className="flex gap-4 pt-1">
                          {deleted ? (
                            <form action={restoreExpense}>
                              <input type="hidden" name="groupId" value={group.id} />
                              <input type="hidden" name="expenseId" value={e.id} />
                              <button type="submit" className="text-sm font-medium text-accent">
                                Restore
                              </button>
                            </form>
                          ) : (
                            <Link href={`/groups/${group.id}/expenses/${e.id}/edit`} className="text-sm font-medium text-accent">
                              Edit or delete
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// "Undo" for a change that can still be undone, or who undid it.
function UndoControl({ v, ev }: { v: GroupView; ev?: GroupEvent }) {
  if (!ev) return null;
  if (ev.undoneAt) {
    return <span className="text-xs text-gray-400">undone by {ev.undoneById ? v.nameOf(ev.undoneById) : "someone"}</span>;
  }
  if (!canUndo(ev, v.group.events).ok) return null;
  return (
    <form action={undoChange} className="inline">
      <input type="hidden" name="groupId" value={v.group.id} />
      <input type="hidden" name="eventId" value={ev.id} />
      <button type="submit" className="text-xs font-semibold text-accent">
        Undo
      </button>
    </form>
  );
}

// Who did what to one item, oldest first.
function History({ v, events, fallback }: { v: GroupView; events: GroupEvent[]; fallback: string }) {
  if (events.length === 0) return <p className="text-xs text-gray-400">{fallback}</p>;
  return (
    <ol className="space-y-1.5 text-xs text-gray-500">
      {events.map((ev) => (
        <li key={ev.id}>
          <span className={ev.undoneAt ? "line-through decoration-gray-400" : ""}>
            <span className="font-medium text-gray-700">{v.nameOf(ev.actorId)}</span>{" "}
            {ev.text.replace(/^(added|changed|deleted|restored|recorded) .*/, (m) => m.split(" ")[0])}
          </span>
          <span className="text-gray-400"> · {when(ev.createdAt)}</span>
          <span className="ml-2 inline-block">
            <UndoControl v={v} ev={ev} />
          </span>
          {ev.kind === "expense_edited" && parseDetails(ev.details).length > 0 && (
            <ul className="ml-3 mt-0.5 list-disc pl-3 text-gray-500">
              {parseDetails(ev.details).map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
