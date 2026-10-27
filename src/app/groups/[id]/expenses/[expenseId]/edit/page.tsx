import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { dayKey } from "@/lib/dates";
import { getTimeZone } from "@/lib/tz";
import { splitNameFor } from "@/lib/group-types";
import { parsePayers } from "@/lib/payers";
import { initialFromExpense } from "@/lib/expense-initial";
import { deleteExpense } from "@/app/actions";
import { AddExpenseForm } from "@/components/AddExpenseForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PageHeader } from "@/components/ui";
import { SheetPage } from "@/components/SheetPage";
import { coverFor, coverOf } from "@/lib/covers";
import { placePhoto } from "@/lib/places";

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
  // A game's result is worked out from the game: changes happen there (the host reopens it).
  if (e.kind === "pot") {
    const g = await db.potGame.findFirst({ where: { resultId: e.id, groupId: group.id }, select: { id: true } });
    redirect(g ? `/groups/${group.id}/pot/${g.id}` : `/groups/${group.id}?tab=games`);
  }

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

  const groupWeights = Object.fromEntries(group.members.map((m) => [m.id, m.splitWeight]));
  const savedPayers = parsePayers(e.payers);
  const initial = initialFromExpense(e, { groupMarkupBp: group.cardMarkupBp, groupWeights, tz, today: dayKey(new Date(), tz) }, "edit");

  const own = coverOf(group) === "own";
  return (
    <SheetPage
      title="Edit expense"
      back={back}
      cover={coverFor(group)}
      photo={!own && group.type === "trip" ? placePhoto(group.name)?.src : undefined}
      uid={group.id}
      letter={group.name}
    >
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
        spin={group.type !== "pot"}
      />

      <form action={deleteExpense} className="mt-10 border-t border-gray-100 pt-6">
        <input type="hidden" name="groupId" value={group.id} />
        <input type="hidden" name="expenseId" value={e.id} />
        <p className="mb-3 text-sm text-gray-500">
          Deleting removes it from balances and charts. It stays in the history, and you can restore it.
        </p>
        <ConfirmButton
          message={`Delete “${e.description}”? Everyone in the group will be notified.`}
          className="w-full rounded-full border border-red-200 px-4 py-3.5 text-base font-semibold text-red-700 active:scale-[0.98] active:bg-red-50"
        >
          Delete expense
        </ConfirmButton>
      </form>
    </SheetPage>
  );
}
