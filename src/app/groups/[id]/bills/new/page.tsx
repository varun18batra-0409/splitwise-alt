import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { PageHeader } from "@/components/ui";
import { BillForm } from "@/components/BillForm";
import { splitNameFor, weightsLabel } from "@/lib/group-types";

export default async function NewBillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const group = await db.group.findUnique({
    where: { id },
    include: { members: { where: { leftAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, splitWeight: true } } },
  });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  return (
    <>
      <PageHeader title="Add a regular bill" back={`/groups/${group.id}?tab=bills`} />
      <BillForm
        groupId={group.id}
        members={group.members.map(({ id, name }) => ({ id, name }))}
        myId={myId}
        splitName={splitNameFor(group.type)}
        splitLabel={weightsLabel(group.members.map((m) => m.splitWeight))}
        currency={group.currency}
        error={error?.slice(0, 160)}
      />
    </>
  );
}
