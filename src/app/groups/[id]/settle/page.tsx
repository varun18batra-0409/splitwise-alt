import { neutralGameText } from "@/lib/game-words";
import { bounceIfDirect } from "@/lib/direct-db";
import { Confetti } from "@/components/Confetti";
import Link from "@/components/Link";
import { SquareSeal } from "@/components/DrawnIcons";
import { coverFor } from "@/lib/covers";
import { tripPhotoSrc } from "@/lib/places";
import { groupMark } from "@/lib/home/money-card";
import { recordedWords } from "@/lib/pay-words";
import { CREAM, type StubCover } from "@/components/HomeMoney";
import { firstName, OUTLINE_PILL, PayTicket, PayView, QUIET, RecordedView, SettleProgress } from "@/components/PayScreens";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getMyMemberId, privatePath } from "@/lib/identity";
import { eventsFrom, loadGroup, loadGroupSettle } from "@/lib/group-data";
import { formatMoney, PAYMENT_LINE, toInputAmount } from "@/lib/money";
import { applySettleMin } from "@/lib/settle";
import { planKey } from "@/lib/settle-all";
import { canUndo, leaverUndoChecks, originAtDb, paymentsForUndo } from "@/lib/undo";
import { isGroupAdmin } from "@/lib/group-admin";
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
import { notReceivedDone, notReceivedQuestion } from "@/lib/payment-words";
import { planSettleRow, settleMainAction, settleRowFacts, tripEnded } from "@/lib/settle-row";
import { listMoney } from "@/lib/money-display";
import { leaverMoneyLine, settledPercent, squareWords } from "@/lib/settle-ui";
import { confirmPaymentAction, markAllPaidAction, rejectPaymentAction } from "@/app/pay-actions";
import { readNotes } from "@/lib/flash";

// Settle up inside one group: the fewest payments that clear every debt.
// Each can be recorded in full with one tap, or for a smaller amount
// (change the number first). The app only records payments; it never moves money. A recorded payment counts straight away and the
// other person is told; only the two people in it can delete it afterwards.
const quietLinkClass = "inline-flex min-h-11 items-center text-sm font-medium text-fg/70 underline underline-offset-4";

export default async function GroupSettle({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string; error?: string; did?: string; undone?: string; ok?: string; notgot?: string; back?: string; pay?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const notes = await readNotes(sp, `/groups/${id}/settle`);
  await bounceIfDirect(id, sp, `/groups/${id}/settle`); // a pair of two people has no group screens: its person page instead (messages travel with it)
  // What the page shows comes from the database's own sums, not from loading every expense: the settle buttons
  // below recompute the plan on the full data and compare (planKey is the same on both).
  const data = await loadGroupSettle(id, await getMyMemberId(id));
  if (!data) notFound();
  const { group, transfers, expenseCount, paymentCount, paidSoFar, before } = data;
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(await privatePath(id));

  const nameOf = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const money = (n: number) => formatMoney(n, group.currency);
  // The payment rows: if any has paise, every row keeps its two decimals so they line up (₹2,670.00 beside ₹30,723.44).
  const listFmt = listMoney(transfers.map((t) => t.amount), group.currency);
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
  // (canUndo knows who may undo what: someone who left gets the bar only for their own move-out.)
  // (payments: who is in the payment this change is about, since only the payer and the person paid may undo it; whoever recorded it for others may for 10 minutes)
  const undoViewer = { id: myId, isAdmin: await isGroupAdmin(group.id, myId), closed: group.closed, members: group.members, payments: justDid ? await paymentsForUndo(group.id, justDid.undo) : [] };
  const leaverChecks = data.leaver && !data.leaver.removed ? await leaverUndoChecks(group.id, undoViewer, new Date()) : null; // a leaver's own move-out: judged on the full history
  const showUndo = justDid && (leaverChecks?.get(justDid.id) ?? canUndo(justDid, undoEvents, new Date(), undoViewer, await originAtDb(justDid))).ok; // (the 10 minutes count from the original recording, as on the server)

  // How each person here likes to be paid (from their You page), my own account, and the flat move-out payments waiting for my
  // "Got it / Not received" (the only payments that still ask; every other payment counts at once).
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
  const othersToMark = ordered.filter((t) => t.from !== myId); // "Mark all N paid" covers only payments someone else makes (mine go through "I've paid")
  const iLeft = Boolean(group.members.find((m) => m.id === myId)?.leftAt); // someone who left can answer "Got it / Not received", but not say they paid
  const today = dayKey(new Date(), await getTimeZone()); // the viewer's today: a trip is "ended" from its last day
  const ended = tripEnded(group, today);
  const mainAction = settleMainAction({ type: group.type, transfers: transfers.length, shown: ordered.length, left: iLeft, ended });
  // Paid back so far, out of everything that needed paying back (payments made + what's still left).
  const left = transfers.reduce((t, x) => t + x.amount, 0);
  const settledPct = settledPercent(paidSoFar, left);
  const words = squareWords({ leaver: Boolean(data.leaver) });

  const cover: StubCover = { id: group.id, cover: coverFor(group), photo: tripPhotoSrc(group), name: group.name };
  const mark = groupMark(group.type);
  // The pass's small labelled field: how many expenses the group holds (the group's name is already the line under the title).
  const passFieldsHere = expenseCount > 0 ? [{ key: "items" as const, label: "Expenses", value: String(expenseCount) }] : [];
  const settleHref = `/groups/${group.id}/settle`;
  const confirmCount = waiting.length;
  const mineList = ordered.filter((t) => t.from === myId || t.to === myId);
  const othersList = ordered.filter((t) => t.from !== myId && t.to !== myId);

  // Everything one payment offers, worked out once: the same plan, buttons and forms as before, drawn in the new layout.
  const factsOf = (t: (typeof ordered)[number]) => {
    const other = t.from === myId ? t.to : t.from;
    const receiver = group.members.find((m) => m.id === t.to);
    const buttons = t.from === myId ? payButtons(waysOf(t.to), { amount: t.amount, currency: group.currency, toName: receiver?.name ?? "", note: group.name }) : [];
    const plan = planSettleRow(settleRowFacts({ transfer: t, myId, closed: group.closed, iLeft, payApps: buttons.length }));
    const label = plan.actionLabel;
    const aria = `${label}: ${nameOf(t.from)} ${t.from === myId ? "pay" : "pays"} ${t.to === myId ? "you" : nameOf(t.to)} ${money(t.amount)}`;
    // The one action that says it was paid ("I've paid" or "Mark paid"), as a button of any look. It records the payment: it counts straight away
    // and the other person is told.
    const actionButton = (cls: string): React.ReactNode =>
      plan.action === "record" ? (
        <form action={recordCustomPayment} className="flex">
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="fromId" value={t.from} />
          <input type="hidden" name="toId" value={t.to} />
          <input type="hidden" name="amount" value={toInputAmount(t.amount, group.currency)} />
          <input type="hidden" name="back" value="settle" />
          <FreshKey name="rid" />
          <button type="submit" data-haptic="success" data-mark-paid data-i-paid={t.from === myId ? "" : undefined} className={cls} aria-label={aria}>
            {label}
          </button>
        </form>
      ) : null;
    const more = plan.differentAmount ? <DifferentAmountLink href={differentAmountFor(group.id, t.from, t.to, toInputAmount(t.amount, group.currency))} /> : null;
    return { other, receiver, buttons, plan, actionButton, more };
  };

  // ---- Pay Nupur: the steps (only for a payment of mine that can be paid and recorded) ----
  const payTarget = sp.pay ? mineList.find((t) => t.from === myId && t.to === sp.pay) : undefined;
  if (payTarget) {
    const f = factsOf(payTarget);
    // Someone who left, or a closed group, can't record (no action) but can still open their payment app.
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

  // ---- Payment recorded: where a recorded payment lands (and a move-out payment confirmed with Got it) ----
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
          {transfers.length === 0 ? words.headline : data.leaver ? leaverMoneyLine(transfers, myId, (id) => nameOf(id).split(/\s+/)[0], money) : `${transfers.length === 1 ? "One payment" : `${transfers.length} payments`} and you’re all square`}
        </p>
        <p className="mt-1.5 text-[13px] leading-snug text-fg/55">
          {group.name}
          {!data.leaver && transfers.length > 0 && before > transfers.length ? `: ${transfers.length} instead of ${before}` : ""}
        </p>
        {paymentCount + transfers.length > 0 && <SettleProgress pct={settledPct} />}
      </div>

      {notes.error && <ErrorNote>{notes.error}</ErrorNote>}
      {sp.paid === "all" && !sp.undone && <Notice params={["paid"]} className="mb-4">All marked paid ✓ The group stays open.</Notice>}
      {sp.paid === "1" && !sp.undone && <Notice params={["paid"]} className="mb-4">Payment recorded. Balances updated, and they’re told.</Notice>}
      {group.closed && <div className="mb-4 rounded-[20px] border border-line bg-white px-4 py-3 text-sm text-fg/70">This group is closed. Reopen it to record payments.</div>}

      {sp.ok === "1" && <Notice params={["ok"]} className="mb-4">Confirmed ✓ It’s in the balances, and they’ll see it.</Notice>}
      {sp.notgot === "1" && !sp.undone && (
        <Notice params={["notgot", "back"]} className="mb-4">
          {notReceivedDone({
            others: (sp.back ?? "").split(",").filter((id) => id && id !== myId).map((id) => group.members.find((m) => m.id === id)?.name ?? "").filter(Boolean),
            iBack: (sp.back ?? "").split(",").includes(myId),
            groupName: group.name,
          })}
        </Notice>
      )}

      {/* A flat move-out's final payment to you: it already counts, and you can say Got it or Not received. Every other payment counts at once, with no question. */}
      {confirmCount > 0 && (
        <section aria-label="Did you get these?" className="mb-6">
          <h2 className="mb-2.5 px-1 text-[13px] font-semibold text-fg/55">Did you get {confirmCount === 1 ? "this" : "these"}?</h2>
          <ul className="space-y-3">
            {waiting.map((p, i) => (
              <PayTicket
                plain
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
                    <button type="submit" data-haptic="success" className={`${i === 0 ? CREAM : OUTLINE_PILL} w-full`}>
                      Confirm received
                    </button>
                  </form>
                  <form action={rejectPaymentAction}>
                    <input type="hidden" name="paymentId" value={p.id} />
                    <ConfirmButton message={notReceivedQuestion({ amount: money(p.amount), fromName: p.from.name, fromLeft: Boolean(p.from.leftAt || p.from.removedAt), iLeft, groupName: group.name })} className={QUIET}>
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
          <p className="mt-3 font-display text-xl font-semibold">{words.headline}</p>
          <p className="mt-1 text-sm text-fg/60">{words.line}</p>
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
                      plain
                      key={`${t.from}-${t.to}`}
                      attrs={{ "data-transfer-row": "" }}
                      stub={{ letter: nameOf(f.other) }}
                      from={nameOf(t.from)}
                      to={nameOf(t.to)}
                      mark={mark}
                      amount={listFmt(t.amount)}
                      fields={passFieldsHere}
                      tone={iPay ? "owe" : "owed"}
                      sr={`${nameOf(t.from)} ${iPay ? "pay" : "pays"} ${t.to === myId ? "you" : nameOf(t.to)} ${money(t.amount)}`}
                    >
                      <div className="mt-auto pt-3">
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
                          <p className="font-display text-[20px] font-medium leading-tight tracking-[-0.02em] lining-nums tabular-nums">{listFmt(t.amount)}</p>
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
