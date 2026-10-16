import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getMyMemberId } from "@/lib/identity";
import { loadGroup } from "@/lib/group-data";
import { formatMoney, toInputAmount } from "@/lib/money";
import { pairwiseDebtCount } from "@/lib/settle";
import { planKey } from "@/lib/settle-all";
import { nudgeLink } from "@/lib/nudge";
import { canUndo } from "@/lib/undo";
import { recordCustomPayment, settleEverything } from "@/app/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { newRequestKey } from "@/lib/once";
import { UndoBar } from "@/components/UndoBar";
import { ErrorNote, PageHeader } from "@/components/ui";

// Settle up inside one group: the fewest payments that clear every debt.
// Each can be recorded in full with one tap, or for a smaller amount
// (change the number first). The app only records payments; it never moves money.
export default async function GroupSettle({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string; error?: string; did?: string; undone?: string }>;
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
  const ordered = [
    ...transfers.filter((t) => t.from === myId || t.to === myId),
    ...transfers.filter((t) => t.from !== myId && t.to !== myId),
  ];
  const justDid = sp.did ? group.events.find((e) => e.id === sp.did) : undefined;
  const showUndo = justDid && canUndo(justDid, group.events).ok;

  return (
    <>
      <PageHeader title="Settle up" back={`/groups/${group.id}?tab=balances`} />
      <p className="-mt-4 mb-6 text-sm text-gray-500">
        {group.name}
        {transfers.length > 0 && ` · ${transfers.length} ${transfers.length === 1 ? "payment" : "payments"} clear everything`}
        {transfers.length > 0 && before > transfers.length && ` (instead of ${before})`}
      </p>

      {sp.error && <ErrorNote>{sp.error}</ErrorNote>}
      {sp.paid === "1" && !sp.undone && <p className="mb-4 rounded-xl bg-mist px-4 py-3 text-sm text-fg">Payment recorded. Balances updated.</p>}
      {group.closed && <p className="mb-4 rounded-xl bg-mist px-4 py-3 text-sm text-gray-600">This group is closed. Reopen it to record payments.</p>}

      {transfers.length === 0 ? (
        <div className="rounded-2xl bg-mist px-4 py-10 text-center">
          <p className="text-3xl" aria-hidden>
            🎉
          </p>
          <p className="mt-2 font-display text-xl font-semibold">All square</p>
          <p className="mt-1 text-sm text-gray-500">Nobody owes anybody here.</p>
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
                      href={nudgeLink(group.members.find((m) => m.id === t.from)?.phone ?? "", nameOf(t.from), money(t.amount), group.name)}
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

      {!group.closed && (
        <Link href={`/groups/${group.id}/pay`} className="mt-4 block border border-line px-4 py-3 text-center text-sm font-medium text-fg active:bg-mist">
          + Record a different payment
        </Link>
      )}

      {!group.closed && (
        <section className="mt-10 border-t border-line pt-6">
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
