import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { PageHeader } from "@/components/ui";
import { AddExpenseForm } from "@/components/AddExpenseForm";

export default async function AddExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = await db.group.findUnique({
    where: { id },
    include: { members: { orderBy: { createdAt: "asc" }, select: { id: true, name: true } } },
  });
  if (!group) notFound();

  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(`/join/${group.inviteCode}`);

  return (
    <>
      <PageHeader title={`Add to ${group.name}`} back={`/groups/${group.id}`} />
      <AddExpenseForm
        groupId={group.id}
        baseCurrency={group.currency}
        groupMarkupBp={group.cardMarkupBp}
        members={group.members}
        myId={myId}
      />
    </>
  );
}
