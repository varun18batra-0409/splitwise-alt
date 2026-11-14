import { neutralGameText } from "@/lib/game-words";
import { Confetti } from "@/components/Confetti";
import Link from "@/components/Link";
import { SquareSeal } from "@/components/DrawnIcons";
import { coverFor } from "@/lib/covers";
import { tripPhotoSrc } from "@/lib/places";
import { groupMark } from "@/lib/home/money-card";
import { recordedWords } from "@/lib/pay-words";
import { CREAM, type StubCover } from "@/components/HomeMoney";
import { firstName, OUTLINE_PILL, PayTicket, PayView, QUIET, RecordedView, SettleProgress, WaitingView } from "@/components/PayScreens";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getMyMemberId, privatePath } from "@/lib/identity";
import { eventsFrom, loadGroup, loadGroupSettle } from "@/lib/group-data";
import { formatMoney, overpayLine, PAYMENT_LINE, toInputAmount } from "@/lib/money";
import { applySettleMin } from "@/lib/settle";
import { planKey } from "@/lib/settle-all";
import { canUndo } from "@/lib/undo";
import { recordCustomPayment, settleEverything, undoChange } from "@/app/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { DifferentAmountLink, differentAmountFor, filledActionClass, outlineButtonClass, PayAppButtons } from "@/components/SettleRow";
import { FreshKey } from "@/components/FreshKey";
import { UndoBar } from "@/components/UndoBar";
import { ErrorNote, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { dayKey } from "@/lib/dates";
import { getTimeZone } from "@/lib/tz";
import { getAccount } from "@/lib/identity";
import { payButtons, type PayWays } from "@/lib/pay-links";
import { waitingForMe } from "@/lib/payment-ok";
import { planSettleRow, settleMainAction, settleRowFacts, tripEnded } from "@/lib/settle-row";
import { claimsWaitingFor, declinedNote, myDeclinedClaims, myWaitingClaims } from "@/lib/payment-claims";
import { claimPaidAction, confirmClaimAction, confirmPaymentAction, declineClaimAction, markAllPaidAction, rejectPaymentAction, withdrawClaimAction } from "@/app/pay-actions";

// Settle up inside one group: the fewest payments that clear every debt.
// Each can be recorded in full with one tap, or for a smaller amount
// (change the number first). The app only records payments; it never moves money.
const quietLinkClass = "inline-flex min-h-11 items-center text-sm font-medium text-fg/70 underline underline-offset-4";

export default async function GroupSettle({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string; error?: string; did?: string; undone?: string; ok?: string; notgot?: string; claimed?: string; withdrawn?: string; declined?: string; overclaim?: string; over?: string; pay?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  // What the page shows comes from the database's own sums, not from loading every expense: the settle buttons
  // below recompute the plan on the full data and compare (planKey is the same on both).
  const data = await loadGroupSettle(id, await getMyMemberId(id));
  if (!data) notFound();
  const { group, transfers, expenseCount, paymentCount, paidSoFar, before } = data;
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(await privatePath(id));

  const nameOf = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const money = (n: number) => formatMoney(n, group.currency);
  // The group's rule "leave out small amounts" hides tiny payments here (they stay in the balances).
  const { shown, hidden } = applySettleMin(transfers, group.settleMin);
  const ordered = [
    ...shown.filter((t) => t.from === myId || t.to === myId),
    ...shown.filter((t) => t.from !== myId && t.to !== myId),
  ];
  // The history isn't loaded here; the Undo bar needs only that change and the ones after it
  // (someone who left keeps the full, scoped history).
  const undoEvents: Awaited<ReturnType<typeof eventsFrom>> = sp.did ? (data.leaver ? ((await loadGroup(id, { viewer: myId }))?.group.events ?? []) : await eventsFrom(group.id, sp.did)) : [];
  const justDid = sp.did ? undoEvents.find((e) => e.id === sp.did) : undefined;
  // (Someone who left can answer "Confirm received" / "Not received" but can't undo it, so no Undo bar for them.)
  const showUndo = justDid && !group.members.find((m) => m.id === myId)?.leftAt && canUndo(justDid, undoEvents).ok;

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
  const othersToMark = ordered.filter((t) => t.from !== myId); // "Mark all N paid" covers only payments someone else makes (mine go through "I've paid")
  const iLeft = Boolean(group.members.find((m) => m.id === myId)?.leftAt); // someone who left can answer "Confirm received", but not say they paid
  const today = dayKey(new Date(), await getTimeZone()); // the viewer's today: a trip is "ended" from its last day
  const ended = tripEnded(group, today);
  const mainAction = settleMainAction({ type: group.type, transfers: transfers.length, shown: ordered.length, left: iLeft, ended });
  // Paid back so far, out of everything that needed paying back (payments made + what's still left).
  const left = transfers.reduce((t, x) => t + x.amount, 0);
  const settledPct = paidSoFar + left > 0 ? Math.round((paidSoFar / (paidSoFar + left)) * 100) : 100;

  const cover: StubCover = { id: group.id, cover: coverFor(group), photo: tripPhotoSrc(group), name: group.name };
  const mark = groupMark(group.type);
  // The pass's small labelled field: how many expenses the group holds (the group's name is already the line under the title).
  const passFieldsHere = expenseCount > 0 ? [{ key: "items" as const, label: "Expenses", value: String(expenseCount) }] : [];
  const settleHref = `/groups/${group.id}/settle`;
  const confirmCount = claimsToMe.length + waiting.length;
  const mineList = ordered.filter((t) => t.from === myId || t.to === myId);
  const othersList = ordered.filter((t) => t.from !== myId && t.to !== myId);

  // Everything one payment offers, worked out once: the same plan, buttons and forms as before, drawn in the new layout.
  const factsOf = (t: (typeof ordered)[number]) => {
    const other = t.from === myId ? t.to : t.from;
    const receiver = group.members.find((m) => m.id === t.to);
    const myClaim = t.from === myId ? myClaims.find((c) => c.toId === t.to) : undefined;
    const notReceived = t.from === myId && !myClaim ? myDeclined.find((c) => c.toId === t.to) : undefined;
    const buttons = t.from === myId ? payButtons(waysOf(t.to), { amount: t.amount, currency: group.currency, toName: receiver?.name ?? "", note: group.name }) : [];
    const theirClaim = t.to === myId ? (claimsToMe.find((c) => c.fromId === t.from) ?? waiting.find((p) => p.fromId === t.from)) : undefined; // answered in "Did you get these?" above
    const plan = planSettleRow(
      settleRowFacts({ transfer: t, myId, closed: group.closed, iLeft, receiver, payApps: buttons.length, myClaimWaiting: Boolean(myClaim), theirClaimWaiting: Boolean(theirClaim) }),
    );
    const label = plan.actionLabel;
    const aria = `${label}: ${nameOf(t.from)} ${t.from === myId ? "pay" : "pays"} ${t.to === myId ? "you" : nameOf(t.to)} ${money(t.amount)}`;
    // The one action that says it was paid ("I've paid" = a claim, or recorded straight away where they can't confirm; "Mark paid"), as a button of any look.
    const actionButton = (cls: string): React.ReactNode =>
      plan.action === "claim" ? (
        <form action={claimPaidAction} className="flex">
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="fromId" value={t.from} />
          <input type="hidden" name="toId" value={t.to} />
          <input type="hidden" name="amount" value={t.amount} />
          <button type="submit" data-haptic="success" data-i-paid className={cls} aria-label={aria}>
            {label}
          </button>
        </form>
      ) : plan.action === "record" ? (
        // The other person can't tap "Confirm received" (not on Loopin, or a record for someone else): it counts straight away.
        <form action={recordCustomPayment} className="flex">
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="fromId" value={t.from} />
          <input type="hidden" name="toId" value={t.to} />
          <input type="hidden" name="amount" value={toInputAmount(t.amount, group.currency)} />
          <input type="hidden" name="back" value="settle" />
          <FreshKey name="rid" />
          <button type="submit" data-haptic="success" data-mark-paid className={cls} aria-label={aria}>
            {label}
          </button>
        </form>
      ) : null;
    const more = plan.differentAmount ? <DifferentAmountLink href={differentAmountFor(group.id, t.from, t.to, toInputAmount(t.amount, group.currency))} /> : null;
    return { other, receiver, myClaim, notReceived, buttons, theirClaim, plan, actionButton, more };
  };

  // ---- Pay Nupur: the steps (only for a payment of mine that can be paid or claimed) ----
  const payTarget = sp.pay ? mineList.find((t) => t.from === myId && t.to === sp.pay) : undefined;
  if (payTarget) {
    const f = factsOf(payTarget);
    // Someone who left, or a closed group, can't claim (no action) but can still open their payment app.
    const payOnly = f.plan.main === "pay-app" && (iLeft || group.closed);
    if ((f.plan.action || payOnly) && f.receiver) {
      return (
        <>
          <PageHeader title={`Pay ${firstName(f.receiver.name)}`} back={settleHref} />
          <PayView
            name={f.receiver.name}
            amount={money(payTarget.amount)}
            cover={cover}
            groupName={group.name}
            ways={waysOf(payTarget.to)}
            payApp={f.buttons.length > 0 ? <PayAppButtons buttons={f.buttons} /> : undefined}
            tellButton={f.actionButton(f.buttons.length > 0 ? outlineButtonClass : filledActionClass)}
            noClaimNote={iLeft ? "You left this group, so Loopin can’t record it here." : group.closed ? "This group is closed, so Loopin can’t record it here." : undefined}
          />
        </>
      );
    }
  }

  // ---- Waiting for Nupur: right after "I've paid" (a claim) ----
  const claimedNow = sp.claimed === "1" ? [...myClaims].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] : undefined;
  if (claimedNow) {
    const to = group.members.find((m) => m.id === claimedNow.toId);
    return (
      <>
        <PageHeader title="Settle up" back={settleHref} />
        <WaitingView
          name={to?.name ?? "them"}
          amount={formatMoney(claimedNow.amount, claimedNow.currency)}
          cover={cover}
          groupName={group.name}
          groupHref={settleHref}
          backHref={`/groups/${group.id}`}
          toId={claimedNow.toId}
          undo={
            iLeft ? null : (
              <form action={withdrawClaimAction} className="inline-flex">
                <input type="hidden" name="claimId" value={claimedNow.id} />
                <button type="submit" className="inline-flex min-h-11 items-center font-medium text-fg underline underline-offset-4">
                  Undo report
                </button>
              </form>
            )
          }
        />
      </>
    );
  }

  // ---- Payment recorded: where a recorded or confirmed payment lands ----
  const recordedPay = (sp.paid === "1" || sp.ok === "1") && !sp.undone && justDid?.paymentId ? await db.payment.findUnique({ where: { id: justDid.paymentId }, select: { fromId: true, toId: true, amount: true, deletedAt: true } }) : null;
  if (recordedPay && !recordedPay.deletedAt && justDid) {
    const nm = (id: string) => group.members.find((m) => m.id === id)?.name ?? "Someone";
    const words = recordedWords({ payment: { from: recordedPay.fromId, to: recordedPay.toId, amount: recordedPay.amount }, left: transfers, me: myId, name: nm, money, groupName: group.name });
    return (
      <>
        <PageHeader title="Payment recorded" back={settleHref} />
        <RecordedView
          from={nameOf(recordedPay.fromId)}
          to={nameOf(recordedPay.toId)}
          mark={mark}
          amount={money(recordedPay.amount)}
          groupName={group.name}
          headline={words.headline}
          sub={words.sub}
          stubName={nm(recordedPay.fromId)}
          stubLine={words.stubLine}
          note={words.note}
          backHref={`/groups/${group.id}`}
          undo={
            showUndo ? (
              <div role="status" aria-live="polite" className="mt-1 flex justify-center">
                <form action={undoChange}>
                  <input type="hidden" name="groupId" value={group.id} />
                  <input type="hidden" name="eventId" value={justDid.id} />
                  <input type="hidden" name="back" value="settle" />
                  <button type="submit" className={QUIET}>
                    Undo
                  </button>
                </form>
              </div>
            ) : null
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settle up" back={`/groups/${group.id}?tab=balances`} />
      {/* How far the group is: one segment per payment, filled once it is paid. */}
      <div className="-mt-2 mb-7">
        <p className="font-display text-[28px] font-semibold leading-[1.04] tracking-[-0.02em]">
          {transfers.length === 0 ? "All square" : `${transfers.length === 1 ? "One payment" : `${transfers.length} payments`} and you’re all square`}
        </p>
        <p className="mt-1.5 text-[13px] leading-snug text-fg/55">
          {group.name}
          {transfers.length > 0 && before > transfers.length ? `: ${transfers.length} instead of ${before}` : ""}
        </p>
        {paymentCount + transfers.length > 0 && <SettleProgress pct={settledPct} />}
      </div>

      {sp.error && <ErrorNote>{sp.error}</ErrorNote>}
      {sp.paid === "all" && !sp.undone && <Notice params={["paid"]} className="mb-4">All marked paid ✓ The group stays open.</Notice>}
      {sp.paid === "1" && !sp.undone && <Notice params={["paid"]} className="mb-4">Payment recorded. Balances updated. If the person paid is on Loopin, they’re asked to confirm received.</Notice>}
      {sp.claimed === "1" && <Notice params={["claimed"]} className="mb-4">Sent. They’re asked to confirm, and the balances change once they do.</Notice>}
      {sp.withdrawn === "1" && <Notice params={["withdrawn"]} className="mb-4">Taken back. Tap I’ve paid again once you’ve paid.</Notice>}
      {sp.declined === "1" && <Notice params={["declined"]} className="mb-4">Marked as not received. The balances haven’t changed, and they’ll see it.</Notice>}
      {group.closed && <div className="mb-4 rounded-[20px] border border-line bg-white px-4 py-3 text-sm text-fg/70">This group is closed. Reopen it to record payments.</div>}

      {sp.ok === "1" && <Notice params={["ok"]} className="mb-4">Confirmed ✓ It’s in the balances, and they’ll see it.</Notice>}
      {sp.notgot === "1" && !sp.undone && (
        <Notice params={["notgot"]} className="mb-4">
          Taken off the balances, and they’ll see you haven’t received it.
        </Notice>
      )}

      {/* Someone said they paid you. A new "I've paid" is a claim: nothing is in the balances until you confirm. Each is a neutral ticket. */}
      {confirmCount > 0 && (
        <section aria-label="Did you get these?" className="mb-6">
          <h2 className="mb-2.5 px-1 text-[13px] font-semibold text-fg/55">Did you get {confirmCount === 1 ? "this" : "these"}?</h2>
          <ul className="space-y-3">
            {claimsToMe.map((c, i) => (
              <PayTicket
                key={c.id}
                attrs={{ "data-waiting": c.fromName, "data-claim": c.id }}
                stub={{ letter: c.fromName }}
                from={c.fromName}
                to="You"
                mark={mark}
                tone="plain"
                sr={`${c.fromName} says they paid you ${formatMoney(c.amount, c.currency)}`}
                showSr={false}
              >
                <p className="mt-2.5 text-[15px] leading-snug">
                  <strong className="font-semibold">{c.fromName}</strong> says they paid you <strong className="font-display text-[19px] font-medium tabular-nums text-owed">{formatMoney(c.amount, c.currency)}</strong>
                </p>
                {sp.overclaim !== c.id ? (
                  <div className="mt-auto pt-3">
                    <form action={confirmClaimAction}>
                      <input type="hidden" name="claimId" value={c.id} />
                      <button type="submit" data-haptic="success" className={`${i === 0 ? CREAM : OUTLINE_PILL} w-full`}>
                        Confirm received
                      </button>
                    </form>
                    <form action={declineClaimAction}>
                      <input type="hidden" name="claimId" value={c.id} />
                      <ConfirmButton message={`Haven’t received ${formatMoney(c.amount, c.currency)} from ${c.fromName} yet? Nothing changes in the balances, and ${c.fromName} is asked to check.`} className={QUIET}>
                        Not received
                      </ConfirmButton>
                    </form>
                  </div>
                ) : (
                  // More than what's owed now: ask once. Cancel comes first and has the focus.
                  overClaim > 0 && (
                    <div role="alert" className="mt-3 text-sm" data-over-warning>
                      <p>{overpayLine(overClaim, 0, c.currency, "Confirm anyway?")}</p>
                      <div className="mt-3 flex gap-2">
                        <a href={settleHref} autoFocus className={`${CREAM} px-5`}>
                          Cancel
                        </a>
                        <form action={confirmClaimAction}>
                          <input type="hidden" name="claimId" value={c.id} />
                          <input type="hidden" name="over" value="1" />
                          <button type="submit" className={`${OUTLINE_PILL} px-4`}>
                            Confirm anyway
                          </button>
                        </form>
                      </div>
                    </div>
                  )
                )}
              </PayTicket>
            ))}
            {waiting.map((p, i) => (
              <PayTicket
                key={p.id}
                attrs={{ "data-waiting": p.from.name }}
                stub={{ letter: p.from.name }}
                from={p.from.name}
                to="You"
                mark={mark}
                tone="plain"
                sr={`${p.from.name} says they paid you ${money(p.amount)}`}
                showSr={false}
              >
                <p className="mt-2.5 text-[15px] leading-snug">
                  <strong className="font-semibold">{p.from.name}</strong> says they paid you <strong className="font-display text-[19px] font-medium tabular-nums text-owed">{money(p.amount)}</strong>
                </p>
                <div className="mt-auto pt-3">
                  <form action={confirmPaymentAction}>
                    <input type="hidden" name="paymentId" value={p.id} />
                    <button type="submit" data-haptic="success" className={`${claimsToMe.length === 0 && i === 0 ? CREAM : OUTLINE_PILL} w-full`}>
                      Confirm received
                    </button>
                  </form>
                  <form action={rejectPaymentAction}>
                    <input type="hidden" name="paymentId" value={p.id} />
                    <ConfirmButton message={`Haven’t received ${money(p.amount)} from ${p.from.name}? It comes off the balances (you can undo).`} className={QUIET}>
                      Not received
                    </ConfirmButton>
                  </form>
                </div>
              </PayTicket>
            ))}
          </ul>
        </section>
      )}

      {hidden > 0 && (
        <div className="mb-4 rounded-[20px] border border-line bg-white px-4 py-3 text-sm text-fg/70">
          {hidden} small {hidden === 1 ? "amount" : "amounts"} under {money(group.settleMin)} left out. {hidden === 1 ? "It stays" : "They stay"} in the balances.
        </div>
      )}

      {transfers.length === 0 ? (
        <div className="rounded-[20px] border border-line bg-white px-4 py-10 text-center">
          {expenseCount > 0 && <Confetti id={`${group.id}:${expenseCount}:${paymentCount}`} />}
          <SquareSeal size={56} className="mx-auto" />
          <p className="mt-3 font-display text-xl font-semibold">All square</p>
          <p className="mt-1 text-sm text-fg/60">Nobody owes anybody here.</p>
          {expenseCount > 0 && (
            <Link href={`/groups/${group.id}/square`} className={`${OUTLINE_PILL} mx-auto mt-4 inline-flex`}>
              Share the moment
            </Link>
          )}
        </div>
      ) : ordered.length === 0 ? (
        <div className="rounded-[20px] border border-line bg-white px-4 py-10 text-center">
          <p className="font-display text-xl font-semibold">Nearly square</p>
          <p className="mt-1 text-sm text-fg/60">
            Only small amounts are left, all under {money(group.settleMin)}, so no payments are suggested. They stay in the balances; change the minimum in
            settings to see them.
          </p>
        </div>
      ) : (
        <>
          {mineList.length > 0 && (
            <section aria-label="Yours" className="mb-7">
              <h2 className="mb-2.5 px-1 text-[13px] font-semibold text-fg/55">Yours</h2>
              <ul className="space-y-3">
                {mineList.map((t, i) => {
                  const f = factsOf(t);
                  const iPay = t.from === myId;
                  const rName = f.receiver?.name ?? "them";
                  // One cream button on the whole screen: the first ticket's (unless someone is waiting on you to confirm, which comes first).
                  const big = `${i === 0 && confirmCount === 0 ? CREAM : OUTLINE_PILL} w-full`;
                  const them = firstName(nameOf(f.other));
                  return (
                    <PayTicket
                      key={`${t.from}-${t.to}`}
                      attrs={{ "data-transfer-row": "" }}
                      stub={{ letter: nameOf(f.other) }}
                      from={nameOf(t.from)}
                      to={nameOf(t.to)}
                      mark={mark}
                      amount={money(t.amount)}
                      fields={passFieldsHere}
                      tone={iPay ? "owe" : "owed"}
                      sr={`${nameOf(t.from)} ${iPay ? "pay" : "pays"} ${t.to === myId ? "you" : nameOf(t.to)} ${money(t.amount)}`}
                    >
                      {f.notReceived && (
                        <p className="mt-2 text-[13px] leading-snug text-fg/70" role="status" data-claim-declined={t.to}>
                          {declinedNote(rName, f.notReceived.amount, f.notReceived.currency)}
                        </p>
                      )}
                      {f.plan.status === "waiting" && f.myClaim ? (
                        <div className="mt-auto pt-2" data-claim-waiting={t.to}>
                          <p className="text-sm font-semibold text-fg/80">Waiting for {rName} to confirm</p>
                          <form action={withdrawClaimAction}>
                            <input type="hidden" name="claimId" value={f.myClaim.id} />
                            <button type="submit" className={QUIET}>
                              Tapped by mistake? Take it back
                            </button>
                          </form>
                        </div>
                      ) : (
                        <div className="mt-auto pt-3">
                          {f.plan.status === "their-claim" && f.theirClaim && (
                            <p className="mb-1 text-[13px] leading-snug text-fg/70" data-claim-above>
                              {"fromName" in f.theirClaim ? f.theirClaim.fromName : f.theirClaim.from.name} says they paid. Confirm it in the box above.
                            </p>
                          )}
                          {(f.plan.action || f.plan.main === "pay-app") && iPay && (
                            <Link href={`${settleHref}?pay=${encodeURIComponent(t.to)}`} className={big}>
                              Pay {firstName(rName)}
                            </Link>
                          )}
                          {f.plan.main === "remind" && (
                            <a href={`/groups/${group.id}/remind?from=${encodeURIComponent(t.from)}`} target="_blank" rel="noopener noreferrer" className={big} data-remind={t.from}>
                              Remind {them}
                            </a>
                          )}
                          <div className="flex items-start justify-between gap-3">
                            {f.actionButton(QUIET) ?? <span />}
                            {f.more}
                          </div>
                        </div>
                      )}
                    </PayTicket>
                  );
                })}
              </ul>
            </section>
          )}

          {othersList.length > 0 && (
            <section aria-label="Between others" className="mb-6">
              <h2 className="mb-1 px-1 text-[13px] font-semibold text-fg/55">Between others</h2>
              <ul>
                {othersList.map((t) => {
                  const f = factsOf(t);
                  return (
                    <li key={`${t.from}-${t.to}`} data-transfer-row="" className="border-t border-[#26262c] py-3 first:border-t-0">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] text-fg/75">
                            <b className="font-semibold text-fg">{nameOf(t.from)}</b> pays <b className="font-semibold text-fg">{nameOf(t.to)}</b>
                          </p>
                          <p className="font-display text-[20px] font-medium leading-tight tracking-[-0.02em] lining-nums tabular-nums">{money(t.amount)}</p>
                          {f.plan.status === "their-claim" && f.theirClaim && (
                            <span className="sr-only" data-claim-above>
                              {"fromName" in f.theirClaim ? f.theirClaim.fromName : f.theirClaim.from.name} says they paid.
                            </span>
                          )}
                        </div>
                        {f.actionButton("inline-flex min-h-11 shrink-0 items-center rounded-full border border-fg/25 px-4 text-[13.5px] font-semibold text-fg active:scale-[0.97]")}
                      </div>
                      {f.more}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {owedToMe && !myWays && me && (
        <div className="mb-4 rounded-[20px] border border-line bg-white px-4 py-3 text-sm text-fg/70">
          Get paid in one tap: add your UPI ID or PayPal / Venmo link on{" "}
          <Link href="/account/pay" className="font-semibold text-fg underline underline-offset-2">
            your You page
          </Link>
          . People who owe you get a Pay button.
        </div>
      )}

      {/* The closing actions. The rows' own buttons stay the main thing on the screen: "Close group" / "Settle everything & close" is an outline pill,
          and everything else is a quiet link under "Other ways to settle". */}
      {!group.closed && !iLeft && (
        <section id="close" className="mt-2 scroll-mt-4 space-y-1" data-settle-actions>
          {mainAction === "close" && (
            <form action={settleEverything} className="flex justify-center">
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="plan" value={planKey(transfers)} />
              <ConfirmButton
                message={
                  transfers.length > 0
                    ? `Mark all ${transfers.length} payments as paid and close ${group.name}? Everyone will be notified. You can undo this.`
                    : `Close ${group.name}? You can reopen it any time.`
                }
                className={`${OUTLINE_PILL} w-full`}
              >
                {transfers.length > 0 ? "Settle everything & close" : "Close group"}
              </ConfirmButton>
            </form>
          )}
          <div className="flex flex-wrap items-start justify-between gap-x-4">
            <details className="group" data-more-options="settle">
              <summary className={`${QUIET} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                Other ways to settle <span aria-hidden className="ml-1">›</span>
              </summary>
              <div className="space-y-1">
                {/* Only other people's payments: your own go through "I've paid", so they can be confirmed. */}
                {othersToMark.length > 1 && (
                  <form action={markAllPaidAction} className="flex">
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="plan" value={planKey(transfers)} />
                    <FreshKey name="rid" />
                    <ConfirmButton message={`Mark all ${othersToMark.length} paid? These are the payments between other people. The group stays open, everyone is told, and you can undo it.`} className={quietLinkClass}>
                      Mark all {othersToMark.length} paid
                    </ConfirmButton>
                  </form>
                )}
                {mainAction !== "close" && transfers.length > 0 && (
                  <form action={settleEverything} className="flex">
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="plan" value={planKey(transfers)} />
                    <ConfirmButton message={`Mark all ${transfers.length} payments as paid and close ${group.name}? Everyone will be notified. You can undo this.`} className={quietLinkClass}>
                      Settle everything & close
                    </ConfirmButton>
                  </form>
                )}
                <div className="flex">
                  <Link href={`/groups/${group.id}/pay`} className={quietLinkClass}>
                    Record a different payment
                  </Link>
                </div>
                {transfers.length > 0 && <p className="max-w-xs pt-1 text-xs text-fg/55">Settled outside the app? “Settle everything & close” marks every payment above paid and closes the group.</p>}
              </div>
            </details>
            {group.type === "trip" && (
              <Link href={`/groups/${group.id}/report`} aria-label="See the trip report" className={QUIET}>
                Trip report <span aria-hidden className="ml-1">›</span>
              </Link>
            )}
          </div>
        </section>
      )}
      {(group.closed || iLeft) && group.type === "trip" && (
        <Link href={`/groups/${group.id}/report`} aria-label="See the trip report" className={`${QUIET} mt-2`}>
          Trip report <span aria-hidden className="ml-1">›</span>
        </Link>
      )}
      <p className="mt-6 text-xs text-fg/55">{PAYMENT_LINE}</p>

      {showUndo && (
        <UndoBar
          key={justDid.id}
          text={sp.undone ? "Undone." : `${nameOf(justDid.actorId)} ${neutralGameText(justDid.text)}`}
          groupId={group.id}
          eventId={justDid.id}
          back="settle"
          redo={sp.undone === "1"}
        />
      )}
    </>
  );
}
