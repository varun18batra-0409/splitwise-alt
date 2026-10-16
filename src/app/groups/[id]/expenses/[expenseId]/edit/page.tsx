import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { toInputAmount } from "@/lib/money";
import { dayKey } from "@/lib/dates";
import { getTimeZone } from "@/lib/tz";
import { allocateByWeights, sharesBack, type ForMode, type SplitType } from "@/lib/split";
import { splitNameFor } from "@/lib/group-types";
import { parsePayers, scalePayers } from "@/lib/payers";
import type { PaymentMethod } from "@/lib/conversion";
import { deleteExpense } from "@/app/actions";
import { AddExpenseForm, type ExpenseInitial } from "@/components/AddExpenseForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PageHeader } from "@/components/ui";

// Edit an expense: everything can change (name, amount, currency, category,
// who paid, who it was for, how it's split). Anyone in the group can; the change
// is logged with their name and everyone else is notified.
export default async function EditExpensePage({ params }: { params: Promise<{ id: string; expenseId: string }> }) {
  const { id, expenseId } = await params;
  const group = await db.group.findUnique({
    where: { id },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, leftAt: true, splitWeight: true } } },
  });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  const tz = await getTimeZone();
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");

  const e = await db.expense.findFirst({ where: { id: expenseId, groupId: group.id }, include: { shares: true } });
  if (!e) notFound();

  const back = `/groups/${group.id}?tab=activity`;
  const blocked =
    e.deletedAt
        ? "This expense was deleted. Restore it from the Activity list to change it."
        : group.closed
          ? "This group is closed. Reopen it to change expenses."
          : null;
  if (blocked) {
    return (
      <>
        <PageHeader title={e.description} back={back} />
        <p className="text-gray-600">{blocked}</p>
        <Link href={back} className="mt-6 inline-block font-medium text-accent">
          Back to the group
        </Link>
      </>
    );
  }

  // Rebuild what was typed, from what was saved.
  const shares = e.shares.filter((s) => s.amount > 0);
  const weights = shares.map((s) => ({ memberId: s.memberId, weight: s.amount }));
  const exact = Object.fromEntries(
    allocateByWeights(e.originalAmount, weights).map((s) => [s.memberId, toInputAmount(s.amount, e.originalCurrency)]),
  );
  const percent = Object.fromEntries(allocateByWeights(10000, weights).map((s) => [s.memberId, String(s.amount / 100)]));
  const groupWeights = Object.fromEntries(group.members.map((m) => [m.id, m.splitWeight]));
  const sharesText = e.splitType === "shares" ? sharesBack(e.amount, shares, groupWeights) : null;
  const savedPayers = parsePayers(e.payers);
  const foreignCard = e.originalCurrency !== e.baseCurrency && e.paymentMethod === "card";

  const initial: ExpenseInitial = {
    name: e.description,
    amount: toInputAmount(e.originalAmount, e.originalCurrency),
    currency: e.originalCurrency,
    category: e.category,
    paidById: e.paidById,
    forMode: (["everyone", "selected", "one"].includes(e.forMode) ? e.forMode : "everyone") as ForMode,
    selected: shares.map((s) => s.memberId),
    onePersonId: shares.length === 1 ? shares[0].memberId : "",
    // Shares that can't be rebuilt exactly are edited as amounts instead.
    splitType: (e.splitType === "shares" ? (sharesText ? "shares" : "exact") : ["equal", "exact", "percent"].includes(e.splitType) ? e.splitType : "equal") as SplitType,
    exact,
    percent,
    shares: sharesText ?? undefined,
    kind: e.kind === "refund" ? "refund" : "expense",
    multiPay: savedPayers.length > 1,
    payers: Object.fromEntries(scalePayers(savedPayers, e.originalAmount).map((p) => [p.memberId, toInputAmount(p.amount, e.originalCurrency)])),
    paymentMethod: (["card", "cash", "bank"].includes(e.paymentMethod) ? e.paymentMethod : "card") as PaymentMethod,
    markupChoice: !foreignCard || e.markupBp === group.cardMarkupBp ? "group" : e.markupBp === 0 ? "none" : "custom",
    markupCustom: foreignCard && e.markupBp !== group.cardMarkupBp ? String(e.markupBp / 100) : "",
    rate: e.exchangeRate,
    rateDate: e.rateDate,
    date: dayKey(e.spentAt ?? e.createdAt, tz),
    notes: e.notes,
    version: (e.editedAt ?? e.createdAt).toISOString(),
  };

  return (
    <>
      <PageHeader title="Edit expense" back={back} />
      <AddExpenseForm
        groupId={group.id}
        baseCurrency={group.currency}
        groupMarkupBp={group.cardMarkupBp}
        members={group.members
          .filter((m) => !m.leftAt || m.id === e.paidById || e.shares.some((s) => s.memberId === m.id) || savedPayers.some((p) => p.memberId === m.id))
          .map(({ id, name }) => ({ id, name }))}
        myId={myId}
        tz={tz}
        expenseId={e.id}
        initial={initial}
        weights={groupWeights}
        splitName={splitNameFor(group.type)}
      />

      <form action={deleteExpense} className="mt-10 border-t border-gray-100 pt-6">
        <input type="hidden" name="groupId" value={group.id} />
        <input type="hidden" name="expenseId" value={e.id} />
        <p className="mb-3 text-sm text-gray-500">
          Deleting removes it from balances and charts. It stays in the history, and you can restore it.
        </p>
        <ConfirmButton
          message={`Delete “${e.description}”? Everyone in the group will be notified.`}
          className="w-full rounded-xl border border-red-200 px-4 py-3.5 text-base font-medium text-red-700 active:bg-red-50"
        >
          Delete expense
        </ConfirmButton>
      </form>
    </>
  );
}
