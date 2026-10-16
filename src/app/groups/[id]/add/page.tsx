import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { PageHeader, primaryButtonClass } from "@/components/ui";
import { setGroupClosed } from "@/app/actions";
import { AddExpenseForm } from "@/components/AddExpenseForm";
import { getTimeZone } from "@/lib/tz";
import { splitNameFor } from "@/lib/group-types";
import { initialFromExpense } from "@/lib/expense-initial";
import { todayKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export default async function AddExpensePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ again?: string; from?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const group = await db.group.findUnique({
    where: { id },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, leftAt: true, splitWeight: true } } },
  });
  if (!group || group.deletedAt) notFound();

  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");

  if (group.closed) {
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

  if (group.members.find((m) => m.id === myId)?.leftAt) {
    return (
      <>
        <PageHeader title={`Add to ${group.name}`} back={`/groups/${group.id}`} />
        <p className="mb-6 text-gray-600">You left this group. Rejoin it to add expenses again.</p>
        <a href={`/groups/${group.id}/people`} className={primaryButtonClass}>
          Go to People
        </a>
      </>
    );
  }

  // Start from another expense: the one just saved ("add another") or an old one ("repeat").
  const tz = await getTimeZone();
  const weights = Object.fromEntries(group.members.map((m) => [m.id, m.splitWeight]));
  const sourceId = sp.again ?? sp.from;
  const source = sourceId ? await db.expense.findFirst({ where: { id: sourceId, groupId: group.id, deletedAt: null }, include: { shares: true } }) : null;
  const initial = source
    ? initialFromExpense(source, { groupMarkupBp: group.cardMarkupBp, groupWeights: weights, tz, today: todayKey(new Date(), tz) }, sp.again ? "again" : "repeat")
    : undefined;

  return (
    <>
      <PageHeader title={`Add to ${group.name}`} back={`/groups/${group.id}`} />
      {sp.again && source && (
        <p className="-mt-2 mb-5 rounded-xl bg-owed/10 px-4 py-3 text-sm text-owed" role="status">
          Saved {source.description} ({formatMoney(source.amount, group.currency)}). Add the next one.
        </p>
      )}
      <AddExpenseForm
        key={sourceId ?? "new"}
        initial={initial}
        groupId={group.id}
        baseCurrency={group.currency}
        groupMarkupBp={group.cardMarkupBp}
        members={group.members.filter((m) => !m.leftAt).map(({ id, name }) => ({ id, name }))}
        myId={myId}
        tz={tz}
        weights={Object.fromEntries(group.members.filter((m) => !m.leftAt).map((m) => [m.id, m.splitWeight]))}
        splitName={splitNameFor(group.type)}
      />
    </>
  );
}
