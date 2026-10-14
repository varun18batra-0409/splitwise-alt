import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { PageHeader, primaryButtonClass } from "@/components/ui";
import { setGroupClosed } from "@/app/actions";
import { AddExpenseForm } from "@/components/AddExpenseForm";

export default async function AddExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = await db.group.findUnique({
    where: { id },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, leftAt: true } } },
  });
  if (!group) notFound();

  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(`/join/${group.inviteCode}`);

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

  return (
    <>
      <PageHeader title={`Add to ${group.name}`} back={`/groups/${group.id}`} />
      <AddExpenseForm
        groupId={group.id}
        baseCurrency={group.currency}
        groupMarkupBp={group.cardMarkupBp}
        members={group.members.filter((m) => !m.leftAt).map(({ id, name }) => ({ id, name }))}
        myId={myId}
      />
    </>
  );
}
