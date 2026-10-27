import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getMyMemberId } from "@/lib/identity";
import { loadGroup } from "@/lib/group-data";
import { formatMoney, toInputAmount } from "@/lib/money";
import { applySettleMin, pairwiseDebtCount } from "@/lib/settle";
import { planKey } from "@/lib/settle-all";
import { nudgeLink } from "@/lib/nudge";
import { canUndo } from "@/lib/undo";
import { recordCustomPayment, settleEverything } from "@/app/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { newRequestKey } from "@/lib/once";
import { UndoBar } from "@/components/UndoBar";
import { ErrorNote, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { payButtons, type PayWays } from "@/lib/pay-links";
import { waitingForMe } from "@/lib/payment-ok";
import { confirmPaymentAction, markAllPaidAction, rejectPaymentAction } from "@/app/pay-actions";
import { SITE_URL } from "@/lib/site";

// Settle up inside one group: the fewest payments that clear every debt.
// Each can be recorded in full with one tap, or for a smaller amount
// (change the number first). The app only records payments; it never moves money.
export default async function GroupSettle({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string; error?: string; did?: string; undone?: string; ok?: string; notgot?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const data = await loadGroup(id);
  if (!data) notFound();
  const { group, transfers, expenses, payments } = data;
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");

  const nameOf = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const money = (n: number) => formatMoney(n, group.currency);
  const before = pairwiseDebtCount(expenses, payments);
  // The group's rule "leave out small amounts" hides tiny payments here (they stay in the balances).
  const { shown, hidden } = applySettleMin(transfers, group.settleMin);
  const ordered = [
    ...shown.filter((t) => t.from === myId || t.to === myId),
    ...shown.filter((t) => t.from !== myId && t.to !== myId),
  ];
  const justDid = sp.did ? group.events.find((e) => e.id === sp.did) : undefined;
  const showUndo = justDid && canUndo(justDid, group.events).ok;

  // How each person here likes to be paid (from their You page), my own account,
  // and payments others recorded to me that wait for my "Got it".
  const accountIds = [...new Set(group.members.map((m) => m.accountId).filter((a): a is string => Boolean(a)))];
  const [accounts, me, waiting] = await Promise.all([
    accountIds.length ? db.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, upiId: true, payLink: true } }) : Promise.resolve([]),
    getAccount(),
    waitingForMe(group.id, myId),
  ]);
  const waysOf = (mid: string): PayWays | null => {
    const acc = group.members.find((m) => m.id === mid)?.accountId;
    const a = acc ? accounts.find((x) => x.id === acc) : undefined;
    return a && (a.upiId || a.payLink) ? { upiId: a.upiId, payLink: a.payLink } : null;
  };
  const myWays = waysOf(myId);
  const owedToMe = ordered.some((t) => t.to === myId);

  return (
    <>
      <PageHeader title="Settle up" back={`/groups/${group.id}?tab=balances`} />
      <p className="-mt-4 mb-6 text-sm text-gray-500">
        {group.name}
        {transfers.length > 0 && ` · ${transfers.length} ${transfers.length === 1 ? "payment" : "payments"} clear everything`}
        {transfers.length > 0 && before > transfers.length && ` (instead of ${before})`}
      </p>

      {sp.error && <ErrorNote>{sp.error}</ErrorNote>}
      {sp.paid === "all" && !sp.undone && <Notice params={["paid"]} className="mb-4">All marked paid ✓ The group stays open.</Notice>}
      {sp.paid === "1" && !sp.undone && <Notice params={["paid"]} className="mb-4">Payment recorded. Balances updated. If the person paid is on Loopin, they’re asked to confirm.</Notice>}
      {group.closed && <p className="mb-4 rounded-xl bg-mist px-4 py-3 text-sm text-gray-600">This group is closed. Reopen it to record payments.</p>}

      {sp.ok === "1" && <Notice params={["ok"]} className="mb-4">Confirmed ✓ They’ll see it.</Notice>}
      {sp.notgot === "1" && !sp.undone && (
        <Notice params={["notgot"]} className="mb-4">
          Taken off the balances, and they’ll see you haven’t received it.
        </Notice>
      )}

      {/* Payment tracking: someone said they paid you. */}
      {waiting.length > 0 && (
        <section aria-label="Did you get these?" className="mb-6 rounded-2xl border border-owed/40 bg-owed/[0.06] px-4 py-3.5">
          <h2 className="text-sm font-semibold">Did you get {waiting.length === 1 ? "this" : "these"}?</h2>
          <ul className="mt-2 divide-y divide-line">
            {waiting.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5" data-waiting={p.from.name}>
                <span className="min-w-0 flex-1 text-sm">
                  <strong className="font-semibold">{p.from.name}</strong> says they paid you <strong className="font-semibold tabular-nums">{money(p.amount)}</strong>
                </span>
                <span className="flex shrink-0 gap-2">
                  <form action={confirmPaymentAction}>
                    <input type="hidden" name="paymentId" value={p.id} />
                    <button type="submit" className="rounded-full bg-fg px-3.5 py-1.5 text-xs font-semibold text-canvas">
                      Got it ✓
                    </button>
                  </form>
                  <form action={rejectPaymentAction}>
                    <input type="hidden" name="paymentId" value={p.id} />
                    <ConfirmButton message={`Haven’t received ${money(p.amount)} from ${p.from.name}? It comes off the balances (you can undo).`} className="rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold">
                      Not received
                    </ConfirmButton>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hidden > 0 && (
        <p className="mb-4 rounded-xl bg-mist px-4 py-3 text-sm text-gray-600">
          {hidden} small {hidden === 1 ? "amount" : "amounts"} under {money(group.settleMin)} left out. {hidden === 1 ? "It stays" : "They stay"} in the balances.
        </p>
      )}

      {transfers.length === 0 ? (
        <div className="rounded-2xl bg-mist px-4 py-10 text-center">
          <p className="text-3xl" aria-hidden>
            🎉
          </p>
          <p className="mt-2 font-display text-xl font-semibold">All square</p>
          <p className="mt-1 text-sm text-gray-500">Nobody owes anybody here.</p>
          {expenses.length > 0 && (
            <Link href={`/groups/${group.id}/square`} className="mt-4 inline-block rounded-full bg-fg px-4 py-2 text-sm font-semibold text-canvas">
              Share the moment 🎉
            </Link>
          )}
        </div>
      ) : ordered.length === 0 ? (
        <div className="rounded-2xl bg-mist px-4 py-10 text-center">
          <p className="font-display text-xl font-semibold">Nearly square</p>
          <p className="mt-1 text-sm text-gray-500">
            Only small amounts are left, all under {money(group.settleMin)}, so no payments are suggested. They stay in the balances; change the minimum in
            settings to see them.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {ordered.map((t) => {
            const mine = t.from === myId || t.to === myId;
            return (
              <li key={`${t.from}-${t.to}`} className={`border px-4 py-4 ${mine ? "border-gray-300 bg-white" : "border-line"}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-[15px]">
                    <strong className="font-medium">{nameOf(t.from)}</strong>
                    <span className="text-gray-500"> {t.from === myId ? "pay" : "pays"} </span>
                    <strong className="font-medium">{t.to === myId ? "you" : nameOf(t.to)}</strong>
                  </p>
                  <p className={`shrink-0 font-display text-lg font-semibold tabular-nums ${t.to === myId ? "text-owed" : t.from === myId ? "text-owe" : ""}`}>
                    {money(t.amount)}
                  </p>
                </div>
                {/* Pay in one tap: the payment app opens with the amount filled in. */}
                {t.from === myId &&
                  (() => {
                    const buttons = payButtons(waysOf(t.to), { amount: t.amount, currency: group.currency, toName: group.members.find((m) => m.id === t.to)?.name ?? "", note: group.name });
                    return buttons.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2" data-pay-buttons>
                        {buttons.map((b) => (
                          <a
                            key={b.kind}
                            href={b.href}
                            {...(b.kind === "upi" ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                            className="pop inline-flex items-center gap-1.5 bg-owed px-4 py-2.5 text-sm font-semibold text-canvas [--pop-edge:#1f6b4a]"
                            data-pay={b.kind}
                          >
                            Pay {money(t.amount)} · {b.label}
                          </a>
                        ))}
                        <span className="basis-full text-xs text-gray-400">Paid? Tap Mark paid below so it counts.</span>
                      </div>
                    ) : null;
                  })()}
                {!group.closed && (
                  <form action={recordCustomPayment} className="mt-3 flex items-center gap-2">
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="fromId" value={t.from} />
                    <input type="hidden" name="toId" value={t.to} />
                    <input type="hidden" name="back" value="settle" />
                    <input type="hidden" name="rid" value={newRequestKey()} />
                    <label className="flex min-w-0 flex-1 items-center rounded-xl border border-line bg-mist px-3 focus-within:border-accent">
                      <span className="shrink-0 text-xs text-gray-400">{group.currency}</span>
                      <input
                        name="amount"
                        inputMode="decimal"
                        defaultValue={toInputAmount(t.amount, group.currency)}
                        aria-label={`Amount ${nameOf(t.from)} paid ${t.to === myId ? "you" : nameOf(t.to)}`}
                        autoComplete="off"
                        className="w-full bg-transparent px-2 py-2.5 text-right text-base tabular-nums outline-none"
                      />
                    </label>
                    <button type="submit" className="pop shrink-0 bg-fg px-4 py-2.5 text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
                      Mark paid
                    </button>
                  </form>
                )}
                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-400">
                  <span>Paid less? Change the amount first.</span>
                  {t.to === myId && !group.closed && (
                    <a
                      href={nudgeLink(group.members.find((m) => m.id === t.from)?.phone ?? "", nameOf(t.from), money(t.amount), group.name, { ways: myWays, link: `${SITE_URL}/groups/${group.id}/settle` })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 font-medium text-fg"
                    >
                      Remind
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Everything at once, but keep the group open (a card group plays again next week). */}
      {!group.closed && ordered.length > 1 && (
        <form action={markAllPaidAction} className="mt-4">
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="plan" value={planKey(transfers)} />
          <input type="hidden" name="rid" value={newRequestKey()} />
          <ConfirmButton
            message={`Mark all ${ordered.length} payments paid? The group stays open, everyone is told, and you can undo it.`}
            className="pop block w-full bg-fg px-4 py-3 text-center text-sm font-semibold text-canvas [--pop-edge:#6e6b63]"
          >
            Mark all {ordered.length} paid
          </ConfirmButton>
        </form>
      )}

      {owedToMe && !myWays && me && (
        <p className="mt-4 rounded-xl bg-mist px-4 py-3 text-sm text-gray-600">
          Get paid in one tap: add your UPI ID or PayPal / Venmo link on{" "}
          <Link href="/account#pay" className="font-semibold text-fg underline underline-offset-2">
            your You page
          </Link>
          . People who owe you get a Pay button.
        </p>
      )}

      {!group.closed && (
        <Link href={`/groups/${group.id}/pay`} className="mt-4 block border border-line px-4 py-3 text-center text-sm font-medium text-fg active:bg-mist">
          + Record a different payment
        </Link>
      )}

      {!group.closed && (
        <section id="close" className="mt-10 scroll-mt-4 border-t border-line pt-6">
          <h2 className="text-base font-semibold">{transfers.length > 0 ? "Settled outside the app?" : "Done with this group?"}</h2>
          <p className="mb-4 mt-1 text-sm text-gray-500">
            {transfers.length > 0 ? "Mark every payment above as paid and close the group in one go." : "Everyone’s square, so you can close it."}
          </p>
          <form action={settleEverything}>
            <input type="hidden" name="groupId" value={group.id} />
            <input type="hidden" name="plan" value={planKey(transfers)} />
            <ConfirmButton
              message={
                transfers.length > 0
                  ? `Mark all ${transfers.length} payments as paid and close ${group.name}? Everyone will be notified. You can undo this.`
                  : `Close ${group.name}? You can reopen it any time.`
              }
              className="block w-full border border-line px-4 py-3 text-center text-sm font-semibold text-fg active:bg-mist"
            >
              {transfers.length > 0 ? "Settle everything & close" : "Close group"}
            </ConfirmButton>
          </form>
        </section>
      )}
      {group.type === "trip" && (
        <Link href={`/groups/${group.id}/report`} className="mt-6 block text-center text-sm font-medium text-fg underline underline-offset-4">
          See the trip report
        </Link>
      )}
      <p className="mt-6 text-xs text-gray-400">Loopin only records payments. It never moves money.</p>

      {showUndo && (
        <UndoBar
          key={justDid.id}
          text={sp.undone ? "Undone." : `${nameOf(justDid.actorId)} ${justDid.text}`}
          groupId={group.id}
          eventId={justDid.id}
          back="settle"
          redo={sp.undone === "1"}
        />
      )}
    </>
  );
}
