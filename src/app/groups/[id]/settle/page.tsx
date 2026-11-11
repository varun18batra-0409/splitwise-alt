import { Confetti } from "@/components/Confetti";
import Link from "@/components/Link";
import { SquareSeal } from "@/components/DrawnIcons";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getMyMemberId } from "@/lib/identity";
import { loadGroup } from "@/lib/group-data";
import { formatMoney, overpayLine, PAYMENT_LINE, toInputAmount } from "@/lib/money";
import { applySettleMin, pairwiseDebtCount } from "@/lib/settle";
import { planKey } from "@/lib/settle-all";
import { canUndo } from "@/lib/undo";
import { recordCustomPayment, settleEverything } from "@/app/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { FreshKey } from "@/components/FreshKey";
import { UndoBar } from "@/components/UndoBar";
import { Avatar, ErrorNote, PageHeader, secondaryButtonClass } from "@/components/ui";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { payButtons, type PayWays } from "@/lib/pay-links";
import { needsOkFor, waitingForMe } from "@/lib/payment-ok";
import { claimsWaitingFor, declinedNote, myDeclinedClaims, myWaitingClaims } from "@/lib/payment-claims";
import { claimPaidAction, confirmClaimAction, confirmPaymentAction, declineClaimAction, markAllPaidAction, rejectPaymentAction, withdrawClaimAction } from "@/app/pay-actions";

const RING = 2 * Math.PI * 46;

// Settle up inside one group: the fewest payments that clear every debt.
// Each can be recorded in full with one tap, or for a smaller amount
// (change the number first). The app only records payments; it never moves money.
export default async function GroupSettle({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string; error?: string; did?: string; undone?: string; ok?: string; notgot?: string; claimed?: string; withdrawn?: string; declined?: string; overclaim?: string; over?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const data = await loadGroup(id, { viewer: await getMyMemberId(id) });
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
  // (Someone who left can answer "Confirm received" / "Not received" but can't undo it, so no Undo bar for them.)
  const showUndo = justDid && !group.members.find((m) => m.id === myId)?.leftAt && canUndo(justDid, group.events).ok;

  // How each person here likes to be paid (from their You page), my own account,
  // payments others recorded to me that wait for my "Confirm received" (older ones that already count),
  // and "I've paid" claims (not in the balances yet) waiting for me or made by me.
  const accountIds = [...new Set(group.members.map((m) => m.accountId).filter((a): a is string => Boolean(a)))];
  const [accounts, me, waiting, claimsToMe, myClaims, myDeclined] = await Promise.all([
    accountIds.length ? db.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, upiId: true, payLink: true } }) : Promise.resolve([]),
    getAccount(),
    waitingForMe(group.id, myId),
    claimsWaitingFor(group.id, myId),
    myWaitingClaims(group.id, myId),
    myDeclinedClaims(group.id, myId),
  ]);
  const overClaim = sp.over && /^\d{1,12}$/.test(sp.over) ? Number(sp.over) : 0;
  const waysOf = (mid: string): PayWays | null => {
    const acc = group.members.find((m) => m.id === mid)?.accountId;
    const a = acc ? accounts.find((x) => x.id === acc) : undefined;
    return a && (a.upiId || a.payLink) ? { upiId: a.upiId, payLink: a.payLink } : null;
  };
  const myWays = waysOf(myId);
  const owedToMe = ordered.some((t) => t.to === myId);
  const iLeft = Boolean(group.members.find((m) => m.id === myId)?.leftAt); // someone who left can answer "Confirm received", but not say they paid
  // Paid back so far, out of everything that needed paying back (payments made + what's still left).
  const paidSoFar = payments.reduce((t, p) => t + p.amount, 0);
  const left = transfers.reduce((t, x) => t + x.amount, 0);
  const settledPct = paidSoFar + left > 0 ? Math.round((paidSoFar / (paidSoFar + left)) * 100) : 100;

  return (
    <>
      <PageHeader title="Settle up" back={`/groups/${group.id}?tab=balances`} />
      {/* How far the group is: a ring of what's been paid back so far, and how many payments are left. */}
      <div className="relative -mt-2 mb-7 flex items-center gap-5">
        <span aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(111,227,168,0.14),transparent_65%)]" />
        <span className="relative h-[108px] w-[108px] shrink-0" role="img" aria-label={`${settledPct}% settled`} data-settled-pct={settledPct}>
          <svg width="108" height="108" viewBox="0 0 108 108" aria-hidden>
            <circle cx="54" cy="54" r="46" fill="none" stroke="var(--color-mist)" strokeWidth="9" />
            <circle
              cx="54"
              cy="54"
              r="46"
              fill="none"
              stroke="var(--color-owed)"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={RING}
              strokeDashoffset={RING * (1 - settledPct / 100)}
              transform="rotate(-90 54 54)"
              className="lp-ring"
            />
          </svg>
          <span className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="money text-[26px] leading-none">{settledPct}%</span>
            <span className="text-[11px] text-fg/50">settled</span>
          </span>
        </span>
        <div className="relative min-w-0">
          <p className="font-display text-[28px] font-semibold leading-[1.04] tracking-[-0.02em]">
            {transfers.length === 0 ? "All square" : `${transfers.length === 1 ? "One payment" : `${transfers.length} payments`} and you’re all square`}
          </p>
          <p className="mt-1.5 text-[13px] leading-snug text-fg/55">
            {group.name}
            {transfers.length > 0 && before > transfers.length ? `: ${transfers.length} instead of ${before}` : ""}
          </p>
        </div>
      </div>

      {sp.error && <ErrorNote>{sp.error}</ErrorNote>}
      {sp.paid === "all" && !sp.undone && <Notice params={["paid"]} className="mb-4">All marked paid ✓ The group stays open.</Notice>}
      {sp.paid === "1" && !sp.undone && <Notice params={["paid"]} className="mb-4">Payment recorded. Balances updated. If the person paid is on Loopin, they’re asked to confirm received.</Notice>}
      {sp.claimed === "1" && <Notice params={["claimed"]} className="mb-4">Sent. They’re asked to confirm, and the balances change once they do.</Notice>}
      {sp.withdrawn === "1" && <Notice params={["withdrawn"]} className="mb-4">Taken back. Tap I’ve paid again once you’ve paid.</Notice>}
      {sp.declined === "1" && <Notice params={["declined"]} className="mb-4">Marked as not received. The balances haven’t changed, and they’ll see it.</Notice>}
      {group.closed && <p className="mb-4 rounded-xl bg-mist px-4 py-3 text-sm text-gray-600">This group is closed. Reopen it to record payments.</p>}

      {sp.ok === "1" && <Notice params={["ok"]} className="mb-4">Confirmed ✓ It’s in the balances, and they’ll see it.</Notice>}
      {sp.notgot === "1" && !sp.undone && (
        <Notice params={["notgot"]} className="mb-4">
          Taken off the balances, and they’ll see you haven’t received it.
        </Notice>
      )}

      {/* Someone said they paid you. A new "I've paid" is a claim: nothing is in the balances until you confirm. */}
      {(claimsToMe.length > 0 || waiting.length > 0) && (
        <section aria-label="Did you get these?" className="mb-6 rounded-[22px] border border-owed/40 bg-owed/[0.06] px-4 py-3.5">
          <h2 className="text-sm font-semibold">Did you get {claimsToMe.length + waiting.length === 1 ? "this" : "these"}?</h2>
          <ul className="mt-2 divide-y divide-line">
            {claimsToMe.map((c) => (
              <li key={c.id} className="py-2.5" data-waiting={c.fromName} data-claim={c.id}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="min-w-0 flex-1 text-sm">
                    <strong className="font-semibold">{c.fromName}</strong> says they paid you <strong className="font-semibold tabular-nums">{formatMoney(c.amount, c.currency)}</strong>
                  </span>
                  {sp.overclaim !== c.id && (
                    <span className="flex shrink-0 gap-2">
                      <form action={confirmClaimAction}>
                        <input type="hidden" name="claimId" value={c.id} />
                        <button type="submit" data-haptic="success" className="rounded-full bg-fg px-3.5 py-1.5 text-xs font-semibold text-canvas">
                          Confirm received
                        </button>
                      </form>
                      <form action={declineClaimAction}>
                        <input type="hidden" name="claimId" value={c.id} />
                        <ConfirmButton message={`Haven’t received ${formatMoney(c.amount, c.currency)} from ${c.fromName} yet? Nothing changes in the balances, and ${c.fromName} is asked to check.`} className="rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold">
                          Not received
                        </ConfirmButton>
                      </form>
                    </span>
                  )}
                </div>
                {/* More than what's owed now: ask once. Cancel comes first and has the focus. */}
                {sp.overclaim === c.id && overClaim > 0 && (
                  <div role="alert" className="mt-3 rounded-2xl border border-[#5a3a20] bg-owe-soft px-4 py-3 text-sm" data-over-warning>
                    <p>{overpayLine(overClaim, 0, c.currency, "Confirm anyway?")}</p>
                    <div className="mt-3 flex gap-2">
                      <a href={`/groups/${group.id}/settle`} autoFocus className="rounded-full bg-fg px-4 py-2 text-sm font-semibold text-canvas">
                        Cancel
                      </a>
                      <form action={confirmClaimAction}>
                        <input type="hidden" name="claimId" value={c.id} />
                        <input type="hidden" name="over" value="1" />
                        <button type="submit" className="rounded-full border border-line px-4 py-2 text-sm font-semibold">
                          Confirm anyway
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </li>
            ))}
            {waiting.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5" data-waiting={p.from.name}>
                <span className="min-w-0 flex-1 text-sm">
                  <strong className="font-semibold">{p.from.name}</strong> says they paid you <strong className="font-semibold tabular-nums">{money(p.amount)}</strong>
                </span>
                <span className="flex shrink-0 gap-2">
                  <form action={confirmPaymentAction}>
                    <input type="hidden" name="paymentId" value={p.id} />
                    <button type="submit" data-haptic="success" className="rounded-full bg-fg px-3.5 py-1.5 text-xs font-semibold text-canvas">
                      Confirm received
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
        <div className="rounded-[26px] bg-mist px-4 py-10 text-center">
          {expenses.length > 0 && <Confetti id={`${group.id}:${expenses.length}:${payments.length}`} />}
          <SquareSeal size={56} className="mx-auto" />
          <p className="mt-3 font-display text-xl font-semibold">All square</p>
          <p className="mt-1 text-sm text-gray-500">Nobody owes anybody here.</p>
          {expenses.length > 0 && (
            <Link href={`/groups/${group.id}/square`} className="mt-4 inline-block rounded-full bg-fg px-4 py-2 text-sm font-semibold text-canvas">
              Share the moment
            </Link>
          )}
        </div>
      ) : ordered.length === 0 ? (
        <div className="rounded-[26px] bg-mist px-4 py-10 text-center">
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
            const other = t.from === myId ? t.to : t.from;
            const receiver = group.members.find((m) => m.id === t.to);
            // My own "I've paid" (a claim) is for when the person I'm paying can tap "Confirm received".
            const claimable = t.from === myId && !group.closed && !iLeft && needsOkFor(receiver, myId);
            const myClaim = t.from === myId ? myClaims.find((c) => c.toId === t.to) : undefined;
            const notReceived = t.from === myId && !myClaim ? myDeclined.find((c) => c.toId === t.to) : undefined;
            const buttons = t.from === myId ? payButtons(waysOf(t.to), { amount: t.amount, currency: group.currency, toName: group.members.find((m) => m.id === t.to)?.name ?? "", note: group.name }) : [];
            return (
              <li
                key={`${t.from}-${t.to}`}
                data-transfer-row
                className={`rounded-[22px] border px-4 py-3.5 ${t.from === myId ? "border-owe/25 bg-[linear-gradient(180deg,rgba(255,171,107,0.07),rgba(255,171,107,0.02))]" : mine ? "border-line bg-white" : "border-line"}`}
              >
                <div className="flex items-center gap-3">
                  <Avatar name={nameOf(mine ? other : t.from)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold">
                      {nameOf(t.from)} {t.from === myId ? "pay" : "pays"} {t.to === myId ? "you" : nameOf(t.to)}
                    </p>
                    <p className={`money text-[22px] leading-tight ${t.to === myId ? "text-owed" : t.from === myId ? "text-owe" : "text-fg/80"}`}>{money(t.amount)}</p>
                  </div>
                  {t.to === myId && !group.closed && (
                    <a
                      href={`/groups/${group.id}/remind?from=${encodeURIComponent(t.from)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line bg-mist px-3.5 text-sm font-semibold active:scale-[0.97]"
                      data-remind={t.from}
                    >
                      <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 3 10 14M21 3l-7 18-4-7-7-4Z" />
                      </svg>
                      Remind
                    </a>
                  )}
                </div>
                {/* Pay in one tap: the payment app opens with the amount filled in. */}
                {buttons.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 pl-12" data-pay-buttons>
                    {buttons.map((b) => (
                      <a
                        key={b.kind}
                        href={b.href}
                        {...(b.kind === "upi" ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                        className="pop inline-flex h-10 items-center gap-1.5 bg-fg px-4 text-sm font-semibold text-canvas"
                        data-pay={b.kind}
                      >
                        Open payment app{b.kind === "upi" ? "" : ` (${b.label})`}
                      </a>
                    ))}
                    <span className="basis-full text-xs text-gray-400">
                      {claimable ? `Pay ${money(t.amount)}, then tap I’ve paid. It counts once ${receiver?.name ?? "they"} confirm${receiver?.name ? "s" : ""}.` : "Paid? Tap Mark paid below so it counts."}
                    </span>
                  </div>
                )}
                {claimable ? (
                  myClaim ? (
                    <div className="mt-3 pl-12" data-claim-waiting={t.to}>
                      <p className="text-sm font-semibold text-fg/80">Waiting for {receiver?.name} to confirm</p>
                      <form action={withdrawClaimAction}>
                        <input type="hidden" name="claimId" value={myClaim.id} />
                        <button type="submit" className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-fg/70 underline underline-offset-4">
                          Tapped by mistake? Take it back
                        </button>
                      </form>
                    </div>
                  ) : (
                    <div className="mt-3 pl-12">
                      {notReceived && (
                        <p className="mb-2 rounded-xl border border-owe/30 bg-owe-soft px-3 py-2 text-sm" role="status" data-claim-declined={t.to}>
                          {declinedNote(receiver?.name ?? "They", notReceived.amount, notReceived.currency)}
                        </p>
                      )}
                      <form action={claimPaidAction}>
                        <input type="hidden" name="groupId" value={group.id} />
                        <input type="hidden" name="fromId" value={t.from} />
                        <input type="hidden" name="toId" value={t.to} />
                        <input type="hidden" name="amount" value={t.amount} />
                        <button type="submit" data-haptic="success" data-i-paid className="pop block w-full bg-owed px-4 py-3 text-center text-[15px] font-semibold text-canvas [--pop-edge:#1f6b4a]">
                          I’ve paid {money(t.amount)}
                        </button>
                      </form>
                      <Link href={`/groups/${group.id}/pay?${new URLSearchParams({ from: t.from, to: t.to, amount: toInputAmount(t.amount, group.currency) })}`} className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-fg/70 underline underline-offset-4">
                        Paid a different amount?
                      </Link>
                    </div>
                  )
                ) : (
                  !group.closed && (
                    <>
                      <form action={recordCustomPayment} className="mt-3 flex items-center gap-2 pl-12">
                        <input type="hidden" name="groupId" value={group.id} />
                        <input type="hidden" name="fromId" value={t.from} />
                        <input type="hidden" name="toId" value={t.to} />
                        <input type="hidden" name="back" value="settle" />
                        <FreshKey name="rid" />
                        <label className="flex h-10 min-w-0 flex-1 items-center rounded-full border border-line bg-mist px-3.5 focus-within:border-fg/40">
                          <span className="nobreak shrink-0 text-xs text-gray-400">{group.currency}</span>
                          <input
                            name="amount"
                            inputMode="decimal"
                            defaultValue={toInputAmount(t.amount, group.currency)}
                            aria-label={`Amount ${nameOf(t.from)} paid ${t.to === myId ? "you" : nameOf(t.to)}`}
                            autoComplete="off"
                            className="w-full bg-transparent px-2 text-right text-base tabular-nums outline-none"
                          />
                        </label>
                        <button type="submit" data-haptic="success" className="h-10 shrink-0 rounded-full border border-fg/18 bg-fg/[0.07] px-4 text-sm font-semibold text-fg active:scale-[0.97]">
                          Mark paid
                        </button>
                      </form>
                      <p className="mt-1.5 pl-12 text-xs text-gray-400">Paid less? Change the amount first.</p>
                    </>
                  )
                )}
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
          <FreshKey name="rid" />
          <ConfirmButton
            message={`Mark all ${ordered.length} payments paid? The group stays open, everyone is told, and you can undo it.`}
            className="pop block w-full bg-fg px-4 py-3.5 text-center text-[15px] font-semibold text-canvas"
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
        <Link href={`/groups/${group.id}/pay`} className={`mt-3 ${secondaryButtonClass} text-[15px]`}>
          Record a different payment
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
              className={`${secondaryButtonClass} text-[15px]`}
            >
              {transfers.length > 0 ? "Settle everything & close" : "Close group"}
            </ConfirmButton>
          </form>
        </section>
      )}
      {group.type === "trip" && (
        <Link href={`/groups/${group.id}/report`} className="mt-4 flex min-h-11 items-center justify-center text-sm font-medium text-fg underline underline-offset-4">
          See the trip report
        </Link>
      )}
      <p className="mt-6 text-xs text-gray-400">{PAYMENT_LINE}</p>

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
