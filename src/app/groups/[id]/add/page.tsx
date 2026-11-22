import { notFound, redirect } from "next/navigation";
import { aiReady } from "@/lib/ai";
import { db } from "@/lib/db";
import { Notice } from "@/components/Notice";
import { getMyMemberId, privatePath } from "@/lib/identity";
import { PageHeader, primaryButtonClass } from "@/components/ui";
import { setGroupClosed } from "@/app/actions";
import { AddExpenseForm } from "@/components/AddExpenseForm";
import { SheetPage } from "@/components/SheetPage";
import { coverFor } from "@/lib/covers";
import { placePhoto } from "@/lib/places";
import { getTimeZone } from "@/lib/tz";
import { splitNameFor } from "@/lib/group-types";
import { initialFromExpense } from "@/lib/expense-initial";
import { todayKey } from "@/lib/dates";
import { formatMoney, toInputAmount } from "@/lib/money";
import { billExpenseInput, prepaidFor } from "@/lib/home/bills-db";
import { dailyTotal, payerFor } from "@/lib/home/bills";
import type { ExpenseInitial } from "@/lib/expense-initial";
import { OfflineFix } from "@/components/offline/OfflineFix";
import { offlineOn } from "@/lib/offline/words";

export default async function AddExpensePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ again?: string; from?: string; bill?: string; period?: string; fix?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const group = await db.group.findUnique({
    where: { id },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, leftAt: true, removedAt: true, splitWeight: true } } },
  });
  if (!group || group.deletedAt) notFound();

  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(await privatePath(id));

  // Someone who left or was removed comes first, even in a closed group: they can't reopen it, so the Reopen button would only fail.
  const me = group.members.find((m) => m.id === myId);
  if (me?.leftAt || me?.removedAt) {
    return (
      <>
        <PageHeader title={`Add to ${group.name}`} back={`/groups/${group.id}`} />
        {me.removedAt ? (
          <>
            <p className="mb-6 text-gray-600">You were removed from this group, so you can’t add expenses. Ask the person who looks after it to invite you again.</p>
            <a href={`/groups/${group.id}`} className={primaryButtonClass}>
              Back to {group.name}
            </a>
          </>
        ) : (
          <>
            <p className="mb-6 text-gray-600">You left this group. Rejoin it to add expenses again.</p>
            <a href={`/groups/${group.id}/people`} className={primaryButtonClass}>
              Go to People
            </a>
          </>
        )}
      </>
    );
  }

  if (group.closed && group.type !== "direct") {
    return (
      <>
        <PageHeader title={`Add to ${group.name}`} back={`/groups/${group.id}`} />
        <p className="mb-6 text-gray-600">This group is closed, so new expenses can’t be added. Reopen it to keep adding.</p>
        <form action={setGroupClosed}>
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="closed" value="0" />
          <button type="submit" className={primaryButtonClass}>
            Reopen group
          </button>
        </form>
      </>
    );
  }

  // Start from another expense: the one just saved ("add another") or an old one ("repeat").
  const tz = await getTimeZone();
  const weights = Object.fromEntries(group.members.map((m) => [m.id, m.splitWeight]));
  const sourceId = sp.again ?? sp.from;
  const source = sourceId ? await db.expense.findFirst({ where: { id: sourceId, groupId: group.id, deletedAt: null }, include: { shares: true } }) : null;
  // "Enter amount" for a bill that's waiting: everything filled in except the amount.
  const waitingRun =
    sp.bill && sp.period && /^\d{4}-\d{2}$/.test(sp.period)
      ? await db.billRun.findFirst({ where: { billId: sp.bill, period: sp.period, status: "waiting", bill: { groupId: group.id, deletedAt: null } }, include: { bill: true } })
      : null;
  const billInitial = waitingRun ? billToInitial(waitingRun.bill, group, sp.period!, myId, (await prepaidFor(waitingRun.bill, sp.period!)).total) : undefined;
  const initial = source
    ? initialFromExpense(source, { groupMarkupBp: group.cardMarkupBp, groupWeights: weights, tz, today: todayKey(new Date(), tz) }, sp.again ? "again" : "repeat")
    : billInitial;

  // An expense with one person: named for them, back to their page, a plain cover (no place photo), nothing to spin for.
  const other = group.type === "direct" ? group.members.find((m) => m.id !== myId) : undefined;
  const pair = other ? { otherId: other.id, otherName: other.name } : undefined;

  return (
    <SheetPage
      title={pair ? `Add expense with ${pair.otherName}` : `Add to ${group.name}`}
      back={pair ? `/people/${group.id}` : `/groups/${group.id}`}
      cover={pair ? { kind: "plain" } : coverFor(group, false, group.members.find((m) => m.id === myId)?.leftAt)}
      photo={!pair && group.type === "trip" && !group.cover ? placePhoto(group.name, group.id)?.src : undefined}
      uid={group.id}
      letter={group.name}
      person={pair?.otherName}
    >
      {sp.again && source && (
        <Notice tone="success" className="-mt-2 mb-5">
          Saved {source.description} ({formatMoney(source.amount, group.currency)}). Add the next one.
        </Notice>
      )}
      {waitingRun && (
        <p className="-mt-2 mb-5 rounded-xl bg-mist px-4 py-3 text-sm" role="status">
          {waitingRun.bill.name} for {new Date(`${sp.period}-15T12:00:00Z`).toLocaleString("en-IN", { month: "long", timeZone: "UTC" })}: {waitingRun.bill.nature === "varies" ? "enter the amount from the bill." : "check it and add it."}
        </p>
      )}
      {(() => {
        const formProps = {
          groupId: group.id,
          baseCurrency: group.currency,
          groupMarkupBp: group.cardMarkupBp,
          members: group.members.filter((m) => !m.leftAt).map(({ id, name }) => ({ id, name })),
          myId,
          tz,
          weights: Object.fromEntries(group.members.filter((m) => !m.leftAt).map((m) => [m.id, m.splitWeight])),
          splitName: splitNameFor(group.type),
          spin: !pair && group.type !== "pot",
          pair,
          ai: aiReady(),
        };
        // "Open and fix" for an expense kept on this phone (only with the switch on, and never for a pair).
        if (sp.fix && offlineOn() && !pair) return <OfflineFix draftKey={sp.fix.slice(0, 64)} formProps={formProps} back={`/groups/${group.id}`} />;
        return (
          <AddExpenseForm
            key={sourceId ?? (waitingRun ? `bill-${waitingRun.id}` : "new")}
            initial={initial}
            billRun={waitingRun ? { billId: waitingRun.billId, period: waitingRun.period } : undefined}
            {...formProps}
          />
        );
      })()}
    </SheetPage>
  );
}

// A waiting bill as a ready-made Add expense form (blank amount).
function billToInitial(
  bill: Parameters<typeof billExpenseInput>[0],
  group: { id: string; currency: string; members: { id: string; name: string; leftAt: Date | null; splitWeight: number }[] },
  period: string,
  myId: string,
  prepaid = 0,
): ExpenseInitial {
  const active = group.members.filter((m) => !m.leftAt).map((m) => m.id);
  const payer = payerFor(bill, period, active) ?? myId;
  const x = billExpenseInput(bill, group.id, group.currency, period, 0, payer, group.members);
  // A fixed bill waiting only because its payer left: fill in the usual amount (daily: the month's total).
  const known = bill.nature === "fixed" ? bill.amount : bill.nature === "daily" ? Math.max(0, dailyTotal(bill, period).amount - prepaid) : 0; // daily: the month's total, less what someone who moved out already paid
  return {
    name: x.name,
    amount: known > 0 ? toInputAmount(known, group.currency) : "",
    currency: x.currency,
    category: x.category,
    paidById: payer,
    forMode: x.forMode,
    selected: x.selected,
    onePersonId: "",
    splitType: x.splitType,
    exact: x.exact ?? {},
    percent: x.percent ?? {},
    shares: x.shares,
    kind: "expense",
    paymentMethod: "cash",
    markupChoice: "group",
    markupCustom: "",
    rate: "",
    rateDate: "",
    date: x.date ?? "",
    notes: "",
    version: "",
  };
}
