import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getMemberships, getMyMemberId } from "@/lib/identity";
import { loadGroup, loadMyGroups } from "@/lib/group-data";
import { resolveSecondary, spentByCurrency } from "@/lib/secondary";
import { getRate } from "@/lib/rate-cache";
import { convertAmount } from "@/lib/conversion";
import { foreignLedgers, originalShares } from "@/lib/currency-ledgers";
import { buildActivity, byDay } from "@/lib/activity";
import { pairwiseDebtCount } from "@/lib/settle";
import { formatMoney, formatPercent } from "@/lib/money";
import { niceDate, rateText } from "@/lib/format";
import { CATEGORIES, getCategory } from "@/lib/categories";
import { recordPayment, removePayment, restoreExpense, restorePayment, setGroupClosed, undoChange } from "@/app/actions";
import { canUndo } from "@/lib/undo";
import { UndoBar } from "@/components/UndoBar";
import { ChevronDown, GearIcon, HomeIcon, iconButtonClass } from "@/components/icons";
import { parseDetails } from "@/lib/events";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ActivityRow } from "@/components/ActivityRow";
import { BalanceMeter } from "@/components/BalanceMeter";
import { ColumnChart, HBarChart } from "@/components/Charts";
import { InviteSheet } from "@/components/InviteSheet";

const PAID_WITH: Record<string, string> = { card: "Card", cash: "Cash", bank: "Bank / UPI" };
const FOR_MODE: Record<string, string> = { everyone: "Everyone", selected: "Selected people", one: "One person" };
const TABS = [
  { id: "activity", label: "Activity" },
  { id: "balances", label: "Balances" },
  { id: "charts", label: "Charts" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; saved?: string; added?: string; skipped?: string; paid?: string; error?: string; did?: string; undone?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : "activity";

  const data = await loadGroup(id);
  if (!data) notFound();
  const { group, net, transfers, expenses: activeExpenses, payments: activePayments } = data;

  // If this phone hasn't said who it is in this group yet, ask first.
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(`/join/${group.inviteCode}`);

  const money = (p: number) => formatMoney(p, group.currency);
  const nameOf = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const mine = net[myId] ?? 0;
  const spent = activeExpenses.reduce((s, e) => s + e.amount, 0);
  const expenseById = new Map(group.expenses.map((e) => [e.id, e]));
  const eventById = new Map(group.events.map((ev) => [ev.id, ev]));

  // Balances in each foreign currency the group spent in — WITHOUT card markup
  // (the markup is only the cost of converting to the group currency).
  const ledgers = foreignLedgers(activeExpenses, group.currency, group.members.map((m) => m.id));
  const hasMarkup = activeExpenses.some((e) => e.markupAmount > 0);
  const signed = (minor: number, cur: string) =>
    minor > 0 ? `+${formatMoney(minor, cur)}` : minor < 0 ? `−${formatMoney(-minor, cur)}` : `${formatMoney(0, cur)}`;

  // Second currency (≈), e.g. THB for an INR group on a Thailand trip. Only used
  // when that currency has no expenses of its own (otherwise its real balance is shown).
  const secondaryRaw = resolveSecondary(group.secondaryCurrency, group.currency, activeExpenses);
  const secondary = secondaryRaw && !ledgers.some((l) => l.currency === secondaryRaw) ? secondaryRaw : null;
  const secRate = secondary ? await getRate(group.currency, secondary) : null;
  const eq = (minor: number): string | null => {
    if (!secondary || !secRate?.ok) return null;
    const v = convertAmount(Math.abs(minor), group.currency, secondary, secRate.rate);
    return v === null ? null : `≈ ${formatMoney(v, secondary)}`;
  };

  // Group switcher: up to 5 of my other open groups, most recently active first.
  const switchTo = (await loadMyGroups(await getMemberships()))
    .filter((g) => !g.group.closed && g.group.id !== group.id)
    .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime())
    .slice(0, 5);

  return (
    <>
      {/* Header: back · name · Invite · settings */}
      <header className="mb-8 flex items-center gap-2.5">
        <Link href="/" aria-label="Home" className={iconButtonClass}>
          <HomeIcon size={20} />
        </Link>
        {/* Tap the name to jump to another open group. */}
        <details className="group/switch relative min-w-0 flex-1">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
            <h1 className="truncate font-display text-2xl font-semibold tracking-tight">{group.name}</h1>
            <span className="shrink-0 text-gray-400 transition-transform group-open/switch:rotate-180">
              <ChevronDown size={18} />
            </span>
            <span className="sr-only">Switch group</span>
          </summary>
          <div className="absolute left-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2.5rem)] rounded-2xl border border-gray-100 bg-white p-2 shadow-2xl shadow-black/60">
            {switchTo.length === 0 ? (
              <p className="px-3 py-2 text-sm text-gray-500">No other open groups.</p>
            ) : (
              <>
                <p className="px-3 pb-1 pt-1.5 text-xs text-gray-400">Switch to</p>
                <ul>
                  {switchTo.map((g) => (
                    <li key={g.group.id}>
                      <Link href={`/groups/${g.group.id}`} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 active:bg-mist">
                        <span className="truncate font-medium">{g.group.name}</span>
                        <span className={`shrink-0 text-xs tabular-nums ${g.myBalance > 0 ? "text-owed" : g.myBalance < 0 ? "text-owe" : "text-gray-400"}`}>
                          {g.myBalance > 0 ? `+${formatMoney(g.myBalance, g.group.currency)}` : g.myBalance < 0 ? `−${formatMoney(-g.myBalance, g.group.currency)}` : "settled"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </details>
        <InviteSheet groupId={group.id} groupName={group.name} inviteCode={group.inviteCode} memberCount={group.members.length} />
        <Link href={`/groups/${group.id}/settings`} aria-label="Group settings" className={iconButtonClass}>
          <GearIcon size={20} />
        </Link>
      </header>

      {group.closed && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl bg-mist px-4 py-3 text-sm">
          <span className="text-gray-600">
            Closed{group.closedAt ? ` on ${niceDate(group.closedAt.toISOString().slice(0, 10))}` : ""}. History stays here; new expenses are paused.
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

      {/* Summary */}
      <section className="mb-6">
        <p className="text-sm text-gray-500">Your balance</p>
        <p className={`font-display text-[32px] font-semibold leading-tight tracking-tight tabular-nums ${mine > 0 ? "text-owed" : mine < 0 ? "text-owe" : ""}`}>
          {mine > 0 ? `You’re owed ${money(mine)}` : mine < 0 ? `You owe ${money(-mine)}` : "All square"}
        </p>
        {mine !== 0 && eq(mine) && <p className="font-display text-lg tabular-nums text-gray-500">{eq(mine)}</p>}
        {hasMarkup && <p className="mt-0.5 text-xs text-gray-400">In {group.currency}, including card markup.</p>}

        {/* The same, in each foreign currency the group spent in, without card markup. */}
        {ledgers.length > 0 && (
          <ul className="mt-4 divide-y divide-line border border-line bg-white">
            {ledgers.map((l) => {
              const v = l.net[myId] ?? 0;
              return (
                <li key={l.currency} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{l.currency} expenses</span>
                    <span className="block text-xs text-gray-400">
                      {formatMoney(l.spent, l.currency)} spent · no card markup
                    </span>
                  </span>
                  <span className={`shrink-0 text-right font-display tabular-nums ${v > 0 ? "text-owed" : v < 0 ? "text-owe" : "text-gray-400"}`}>
                    {v > 0 ? `owed ${formatMoney(v, l.currency)}` : v < 0 ? `owe ${formatMoney(-v, l.currency)}` : "even"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {secondary && (
          <p className="mt-1 text-xs text-gray-400">
            {secRate?.ok
              ? `1 ${group.currency} = ${secRate.rate} ${secondary}, rate for ${niceDate(secRate.date)}`
              : `No live ${group.currency} → ${secondary} rate right now, so ${secondary} amounts are hidden.`}
          </p>
        )}
        <p className="mt-1 text-sm text-gray-500">
          {money(spent)}
          {eq(spent) && ` (${eq(spent)})`} spent across {activeExpenses.length} {activeExpenses.length === 1 ? "expense" : "expenses"}, {group.members.length} people
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

      {/* Tabs */}
      <nav className="mb-6 grid grid-cols-3 gap-1 rounded-xl bg-mist p-1" aria-label="Group sections">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/groups/${group.id}?tab=${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className={`rounded-lg py-2 text-center text-sm ${t.id === tab ? "bg-fg font-semibold text-canvas" : "text-gray-500"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "activity" && <ActivityTab />}
      {tab === "balances" && <BalancesTab />}
      {tab === "charts" && <ChartsTab />}

      {/* Right after a change: offer Undo (or Redo after an undo). */}
      {(() => {
        const ev = sp.did ? group.events.find((x) => x.id === sp.did) : undefined;
        if (!ev || !canUndo(ev, group.events).ok) return null;
        return (
          <UndoBar
            key={ev.id}
            text={sp.undone ? "Undone." : `${nameOf(ev.actorId)} ${ev.text}`}
            groupId={group.id}
            eventId={ev.id}
            back={tab === "balances" ? "balances" : "group"}
            redo={sp.undone === "1"}
          />
        );
      })()}
    </>
  );

  // ---- Activity: every expense, payment and group change, by date, with who and how much ----
  function ActivityTab() {
    const items = buildActivity(group.expenses, group.payments, myId!, group.events);
    const when = (d: Date) =>
      d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const historyOf = (key: "expenseId" | "paymentId", id: string) =>
      group.events.filter((ev) => ev[key] === id).sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());

    if (items.length === 0) {
      return (
        <div className="rounded-2xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-500">
          {group.closed ? "This group had no expenses." : "No expenses yet. Tap + Add expense below to add the first one."}
        </div>
      );
    }
    return (
      <div className="space-y-6">
        {byDay(items).map((day) => (
          <section key={day.day}>
            <h2 className="sticky top-0 z-10 -mx-5 bg-canvas/95 px-5 py-1.5 text-sm font-medium text-gray-500 backdrop-blur">{day.day}</h2>
            <ul className="divide-y divide-gray-100">
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
                        <UndoControl ev={eventById.get(item.id)} />
                      </div>
                    </li>
                  );
                }

                if (item.kind === "payment") {
                  const mineToDelete = item.deletedById === null && !group.closed;
                  return (
                    <li key={item.id}>
                      <details>
                        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                          <ActivityRow item={item} currency={group.currency} nameOf={nameOf} />
                        </summary>
                        <div className="mb-3 ml-[3.25rem] space-y-2 rounded-xl bg-mist p-3 text-sm text-gray-600">
                          <History events={historyOf("paymentId", item.id)} fallback={`Recorded ${when(item.date)}`} />
                          {item.deletedById !== null && !group.closed && (
                            <form action={restorePayment}>
                              <input type="hidden" name="groupId" value={group.id} />
                              <input type="hidden" name="paymentId" value={item.id} />
                              <button type="submit" className="text-sm font-medium text-accent">
                                Restore payment
                              </button>
                            </form>
                          )}
                          {mineToDelete && (
                            <form action={removePayment}>
                              <input type="hidden" name="groupId" value={group.id} />
                              <input type="hidden" name="paymentId" value={item.id} />
                              <ConfirmButton message="Delete this payment? Balances will go back to before it was recorded." className="text-sm font-medium text-red-700">
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
                return (
                  <li key={item.id}>
                    <details>
                      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                        <ActivityRow item={item} currency={group.currency} nameOf={nameOf} />
                      </summary>
                      {/* Tap an expense to see exactly how it was worked out, and its history. */}
                      <div className="mb-3 ml-[3.25rem] space-y-1.5 rounded-xl bg-mist p-3 text-sm text-gray-600">
                        <Line label="Category" value={`${cat.emoji} ${cat.label}`} />
                        {foreign && (
                          <>
                            <Line label="Original expense" value={formatMoney(e.originalAmount, e.originalCurrency)} />
                            <Line label="Exchange rate" value={`1 ${e.originalCurrency} = ${rateText(e.exchangeRate, e.baseCurrency)}`} />
                            <p className="-mt-1 text-right text-xs text-gray-400">
                              {e.rateSource === "manual" ? "Entered by hand" : e.rateSource === "converted" ? "Adjusted when the group currency changed" : "Live rate"}
                              {e.rateDate && `, ${niceDate(e.rateDate)}`}
                            </p>
                            <Line label="Paid with" value={PAID_WITH[e.paymentMethod] ?? "—"} />
                            <Line label="Converted amount" value={money(e.convertedAmount)} />
                            {e.paymentMethod === "card" && <Line label={`Card markup (${formatPercent(e.markupBp)})`} value={money(e.markupAmount)} />}
                          </>
                        )}
                        <Line label="Total group expense" value={money(e.amount)} strong />
                        <div className="border-t border-gray-200 pt-1.5">
                          <Line label="Paid by" value={nameOf(e.paidById)} />
                          <Line label="For" value={FOR_MODE[e.forMode] ?? "Everyone"} />
                          {(() => {
                            const orig = foreign ? originalShares(e) : [];
                            return e.shares.map((sh) => {
                              const o = orig.find((x) => x.memberId === sh.memberId);
                              return (
                                <Line
                                  key={sh.id}
                                  label={`  ${nameOf(sh.memberId)}`}
                                  value={o ? `${formatMoney(o.amount, e.originalCurrency)} · ${money(sh.amount)}` : money(sh.amount)}
                                />
                              );
                            });
                          })()}
                        </div>
                        <div className="border-t border-gray-200 pt-2">
                          <History events={historyOf("expenseId", e.id)} fallback={`Added by ${nameOf(e.createdById)}, ${when(e.createdAt)}`} />
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
  function UndoControl({ ev }: { ev?: (typeof group.events)[number] }) {
    if (!ev) return null;
    if (ev.undoneAt) {
      return <span className="text-xs text-gray-400">undone by {ev.undoneById ? nameOf(ev.undoneById) : "someone"}</span>;
    }
    if (!canUndo(ev, group.events).ok) return null;
    return (
      <form action={undoChange} className="inline">
        <input type="hidden" name="groupId" value={group.id} />
        <input type="hidden" name="eventId" value={ev.id} />
        <button type="submit" className="text-xs font-semibold text-accent">
          Undo
        </button>
      </form>
    );
  }

  // Who did what to one item, oldest first.
  function History({ events, fallback }: { events: typeof group.events; fallback: string }) {
    const when = (d: Date) =>
      d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    if (events.length === 0) return <p className="text-xs text-gray-400">{fallback}</p>;
    return (
      <ol className="space-y-1.5 text-xs text-gray-500">
        {events.map((ev) => (
          <li key={ev.id}>
            <span className={ev.undoneAt ? "line-through decoration-gray-400" : ""}>
              <span className="font-medium text-gray-700">{nameOf(ev.actorId)}</span>{" "}
              {ev.text.replace(/^(added|changed|deleted|restored|recorded) .*/, (m) => m.split(" ")[0])}
            </span>
            <span className="text-gray-400"> · {when(ev.createdAt)}</span>
            <span className="ml-2 inline-block">
              <UndoControl ev={ev} />
            </span>
            {parseDetails(ev.details).length > 0 && ev.kind === "expense_edited" && (
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

  // ---- Balances: Smart Settle suggestions + everyone's balance ----
  function BalancesTab() {
    const before = pairwiseDebtCount(activeExpenses, activePayments);
    return (
      <div className="space-y-10">
        <section>
          <h2 className="font-display text-lg font-semibold tracking-tight">Smart Settle</h2>
          <p className="mb-4 text-sm text-gray-500">
            The fewest payments that clear every debt in the group.
            {transfers.length > 0 && before > transfers.length && ` ${transfers.length} instead of ${before}.`}
          </p>
          {sp.paid === "1" && <p className="mb-3 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent-dark">Payment recorded. Balances updated.</p>}
          {transfers.length === 0 ? (
            <p className="rounded-2xl bg-mist px-4 py-6 text-center text-sm text-gray-600">Everyone is settled up.</p>
          ) : (
            <ul className="space-y-2">
              {transfers.map((t) => {
                const involvesMe = t.from === myId || t.to === myId;
                return (
                  <li key={`${t.from}-${t.to}`} className={`rounded-2xl border px-4 py-3 ${involvesMe ? "border-gray-300 bg-mist/60" : "border-gray-100"}`}>
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
                    <form action={recordPayment} className="mt-2 flex justify-end">
                      <input type="hidden" name="groupId" value={group.id} />
                      <input type="hidden" name="fromId" value={t.from} />
                      <input type="hidden" name="toId" value={t.to} />
                      <input type="hidden" name="amount" value={t.amount} />
                      <button type="submit" className="border border-line px-3 py-1.5 text-sm font-medium text-fg active:bg-mist">
                        Mark as paid
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-gray-400">“Mark as paid” only records it here. The app never moves real money.</p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold tracking-tight">Everyone’s balance</h2>
          <p className="mb-4 text-sm text-gray-500">
            {ledgers.length > 0
              ? `Bars in ${group.currency}${hasMarkup ? ", including card markup" : ""}. Small figures: ${ledgers.map((l) => l.currency).join(", ")} expenses only, without markup.`
              : `In ${group.currency}.`}
          </p>
          <BalanceMeter
            rows={group.members.map((m) => ({
              key: m.id,
              label: m.id === myId ? "You" : m.name,
              sublabel:
                ledgers.length > 0
                  ? ledgers.map((l) => `${signed(l.net[m.id] ?? 0, l.currency)}`).join(" · ")
                  : ((net[m.id] ? eq(net[m.id] ?? 0) : null) ?? undefined),
              value: net[m.id] ?? 0,
              currency: group.currency,
            }))}
          />
        </section>
      </div>
    );
  }

  // ---- Charts ----
  function ChartsTab() {
    if (activeExpenses.length === 0) {
      return <p className="rounded-2xl bg-mist px-4 py-8 text-center text-sm text-gray-600">Charts appear once the group has expenses.</p>;
    }

    const sumBy = (keyOf: (e: (typeof activeExpenses)[number]) => string[], amountOf: (e: (typeof activeExpenses)[number], k: string) => number) => {
      const m = new Map<string, number>();
      for (const e of activeExpenses) for (const k of keyOf(e)) m.set(k, (m.get(k) ?? 0) + amountOf(e, k));
      return m;
    };

    const byCat = sumBy((e) => [getCategory(e.category).id], (e) => e.amount);
    const catData = CATEGORIES.filter((c) => byCat.has(c.id))
      .map((c) => ({ key: c.id, label: c.label, icon: c.emoji, value: byCat.get(c.id)!, valueText: `${money(byCat.get(c.id)!)} · ${Math.round((byCat.get(c.id)! / spent) * 100)}%` }))
      .sort((a, b) => b.value - a.value);

    const paid = sumBy((e) => [e.paidById], (e) => e.amount);
    const shares = sumBy((e) => e.shares.map((s) => s.memberId), (e, k) => e.shares.find((s) => s.memberId === k)?.amount ?? 0);
    const people = (m: Map<string, number>) =>
      group.members
        .map((mem) => ({ key: mem.id, label: mem.id === myId ? "You" : mem.name, value: m.get(mem.id) ?? 0, valueText: money(m.get(mem.id) ?? 0) }))
        .sort((a, b) => b.value - a.value);

    // Spending per day (Indian time), every day from the first expense to the last (up to 21 days).
    const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const perDay = sumBy((e) => [dayKey(e.createdAt)], (e) => e.amount);
    const keys = [...perDay.keys()].sort();
    const days: string[] = [];
    for (let d = new Date(`${keys[0]}T00:00:00Z`); d <= new Date(`${keys[keys.length - 1]}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
      days.push(d.toISOString().slice(0, 10));
    }
    const shownDays = days.slice(-21);
    const dayData = shownDays.map((k) => ({ key: k, label: niceDate(k).replace(/ \d{4}$/, ""), value: perDay.get(k) ?? 0, valueText: money(perDay.get(k) ?? 0) }));

    return (
      <div className="space-y-10">
        <HBarChart title="Spending by category" data={catData} total={money(spent)} />
        <HBarChart
          title="Spent by currency"
          data={spentByCurrency(activeExpenses).map((r) => ({
            key: r.currency,
            label: r.currency === group.currency ? `${r.currency} (group currency)` : r.currency,
            value: r.group,
            valueText: r.currency === group.currency ? money(r.group) : `${formatMoney(r.original, r.currency)} = ${money(r.group)}`,
          }))}
        />
        <ColumnChart title={shownDays.length < days.length ? "Spending by day (last 21 days)" : "Spending by day"} data={dayData} />
        <HBarChart title="Who paid" data={people(paid)} />
        <HBarChart title="Each person’s share" data={people(shares)} />
      </div>
    );
  }
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={`flex justify-between gap-3 ${strong ? "font-semibold text-ink" : ""}`}>
      <span className="whitespace-pre">{label}</span>
      <span className="text-right">{value}</span>
    </p>
  );
}
