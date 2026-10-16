import Link from "@/components/Link";
import { buildActivity, byDay, filterActivity, hasFilter, type ActivityFilter } from "@/lib/activity";
import { CATEGORIES, getCategory } from "@/lib/categories";
import { originalShares } from "@/lib/currency-ledgers";
import { dayKey, expenseDate, formatter } from "@/lib/dates";
import { parseDetails } from "@/lib/events";
import { niceDate, rateText } from "@/lib/format";
import { formatMoney, formatPercent } from "@/lib/money";
import { canUndo } from "@/lib/undo";
import { removePayment, restoreExpense, restorePayment, undoChange } from "@/app/actions";
import { ActivityRow } from "@/components/ActivityRow";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Line } from "./Line";
import { payersOf } from "@/lib/payers";
import type { GroupEvent, GroupView } from "./view";

const PAID_WITH: Record<string, string> = { card: "Card", cash: "Cash", bank: "Bank / UPI" };
const FOR_MODE: Record<string, string> = { everyone: "Everyone", selected: "Selected people", one: "One person" };

const whenIn = (tz: string) => {
  const f = formatter("en-IN", { timeZone: tz, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (d: Date) => f.format(d);
};

// Every expense, payment and group change, by day — tap one for its details,
// its history, and Edit / Delete / Restore / Undo.
// Busy groups show the latest PAGE items first, with "Show more".
const PAGE = 60;

export function ActivityTab({ v, filter = {}, shown = PAGE }: { v: GroupView; filter?: ActivityFilter; shown?: number }) {
  const { group, myId, nameOf, money, expenseById, eventById, tz } = v;
  const when = whenIn(tz);
  const all = buildActivity(group.expenses, group.payments, myId, group.events);
  const searchName = (id: string) => {
    const name = group.members.find((m) => m.id === id)?.name ?? "";
    return id === myId ? `${name} you` : name;
  };
  const items = filterActivity(all, filter, searchName);
  const filtering = hasFilter(filter);
  // Each item's history, worked out once for the whole list.
  const byItem = new Map<string, GroupEvent[]>();
  for (const ev of group.events) {
    for (const id of [ev.expenseId, ev.paymentId]) {
      if (!id) continue;
      const list = byItem.get(id) ?? [];
      list.push(ev);
      byItem.set(id, list);
    }
  }
  for (const list of byItem.values()) list.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
  const historyOf = (_key: "expenseId" | "paymentId", id: string) => byItem.get(id) ?? [];
  const limit = Math.max(PAGE, Math.min(5000, shown));
  const page = items.slice(0, limit);

  if (all.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line py-10 text-center text-sm text-gray-500">
        {group.closed ? "This group had no expenses." : "No expenses yet. Tap Add expense below to add the first one."}
      </div>
    );
  }

  const field = "min-w-0 rounded-lg border border-line bg-mist px-3 py-2 text-sm text-fg outline-none focus:border-accent";
  // Quick date ranges, in the person's own time zone.
  const today = dayKey(new Date(), tz);
  const monthRange = (y: number, m: number, label: string) => {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const mm = String(m + 1).padStart(2, "0");
    return { label, from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
  };
  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  const thisMonth = monthRange(ty, tm, "This month");
  const lastMonth = tm === 0 ? monthRange(ty - 1, 11, "Last month") : monthRange(ty, tm - 1, "Last month");
  return (
    <div className="space-y-6">
      {/* One "Filter" button instead of a row of boxes; opens search, category and person. */}
      {(all.length >= 6 || filtering) && (
        <div>
          <details className="group/filter">
            <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
              <span className="rounded-full border border-line px-4 py-1.5 text-sm font-medium text-fg group-open/filter:bg-mist">
                {filtering ? `Filtered · ${items.length} ${items.length === 1 ? "match" : "matches"}` : "Filter"}
              </span>
              {filtering && (
                <Link href={`/groups/${group.id}?tab=activity`} className="text-sm font-medium text-gray-500 underline underline-offset-4">
                  Clear
                </Link>
              )}
            </summary>
            <form method="get" action={`/groups/${group.id}`} role="search" className="mt-3 space-y-2">
              <input type="hidden" name="tab" value="activity" />
              <input
                type="search"
                name="q"
                defaultValue={filter.q ?? ""}
                placeholder="Search expenses, people…"
                aria-label="Search"
                enterKeyHint="search"
                className={`${field} w-full`}
              />
              <div className="flex flex-wrap gap-2" role="group" aria-label="Type">
                {(
                  [
                    ["", "All"],
                    ["expense", "Expenses"],
                    ["payment", "Payments"],
                    ["refund", "Money back"],
                    ["change", "Changes"],
                  ] as const
                ).map(([id, label]) => (
                  <label key={id || "all"} className="cursor-pointer">
                    <input type="radio" name="type" value={id} defaultChecked={(filter.type ?? "") === id} className="peer sr-only" />
                    <span className="block rounded-full border border-line px-3 py-1.5 text-sm text-gray-500 peer-checked:border-fg peer-checked:bg-accent-soft peer-checked:text-fg">
                      {label}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <select name="cat" defaultValue={filter.cat ?? ""} aria-label="Category" className={`${field} flex-1`}>
                  <option value="">All categories</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.emoji} {c.short}
                    </option>
                  ))}
                </select>
                <select name="who" defaultValue={filter.who ?? ""} aria-label="Person" className={`${field} flex-1`}>
                  <option value="">Everyone</option>
                  {group.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id === myId ? "You" : m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <select name="by" defaultValue={filter.by ?? ""} aria-label="Paid by" className={`${field} flex-1`}>
                  <option value="">Paid by anyone</option>
                  {group.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      Paid by {m.id === myId ? "you" : m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span className="w-14 shrink-0">Dates</span>
                <input type="date" name="from" defaultValue={filter.from ?? ""} aria-label="From date" className={`${field} flex-1`} />
                <span>–</span>
                <input type="date" name="to" defaultValue={filter.to ?? ""} aria-label="To date" className={`${field} flex-1`} />
              </div>
              <div className="flex flex-wrap gap-3 pl-16 text-sm">
                {[thisMonth, lastMonth].map((m) => (
                  <Link key={m.label} href={`/groups/${group.id}?tab=activity&from=${m.from}&to=${m.to}`} className="font-medium text-fg underline underline-offset-4">
                    {m.label}
                  </Link>
                ))}
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span className="w-14 shrink-0">Amount</span>
                <input name="min" inputMode="decimal" defaultValue={filter.min ?? ""} placeholder="from" aria-label="Amount from" className={`${field} flex-1`} />
                <span>–</span>
                <input name="max" inputMode="decimal" defaultValue={filter.max ?? ""} placeholder="to" aria-label="Amount to" className={`${field} flex-1`} />
              </div>
              <button type="submit" className="w-full border border-line py-2 text-sm font-medium text-fg active:bg-mist">
                Show results
              </button>
            </form>
          </details>
        </div>
      )}

      {items.length === 0 && <p className="rounded-2xl bg-mist px-4 py-8 text-center text-sm text-gray-500">Nothing matches. Try other words.</p>}

      {byDay(page, new Date(), tz).map((day) => (
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
                      <Line label="Date" value={niceDate(dayKey(expenseDate(e), tz))} />
                      <Line label="Category" value={`${cat.emoji} ${cat.label}`} />
                      {e.notes && <p className="whitespace-pre-line rounded-lg bg-white/[0.03] px-3 py-2 text-gray-600">📝 {e.notes}</p>}
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
                        {payersOf(e).length > 1 ? (
                          payersOf(e).map((p) => <Line key={`p-${p.memberId}`} label={`Paid by ${nameOf(p.memberId)}`} value={money(p.amount)} />)
                        ) : (
                          <Line label="Paid by" value={nameOf(e.paidById)} />
                        )}
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
                            <span className="flex gap-5">
                              <Link href={`/groups/${group.id}/expenses/${e.id}/edit`} className="text-sm font-medium text-accent">
                                Edit or delete
                              </Link>
                              <Link href={`/groups/${group.id}/add?from=${e.id}`} className="text-sm font-medium text-accent">
                                Repeat
                              </Link>
                            </span>
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
      {items.length > page.length && (
        <Link
          href={`/groups/${group.id}?${new URLSearchParams({ tab: "activity", n: String(limit + PAGE * 2), ...(filter.q ? { q: filter.q } : {}), ...(filter.cat ? { cat: filter.cat } : {}), ...(filter.who ? { who: filter.who } : {}) })}`}
          className="block border border-line py-3 text-center text-sm font-medium text-fg active:bg-mist"
        >
          Show more ({items.length - page.length} older)
        </Link>
      )}
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
  const when = whenIn(v.tz);
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
