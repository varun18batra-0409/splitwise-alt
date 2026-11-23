import { notFound, redirect } from "next/navigation";
import { bounceIfDirect } from "@/lib/direct-db";
import { db } from "@/lib/db";
import { getMyMemberId, privatePath } from "@/lib/identity";
import { PageHeader } from "@/components/ui";
import { BillForm } from "@/components/BillForm";
import { splitNameFor, weightsLabel } from "@/lib/group-types";
import { leaverOf } from "@/lib/left-view-db";
import { readNotes } from "@/lib/flash";

export default async function NewBillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  await bounceIfDirect(id); // a pair of two people has no group screens: its person page instead
  const sp = await searchParams;
  const notes = await readNotes(sp, `/groups/${id}/bills/new`);
  const group = await db.group.findUnique({
    where: { id },
    include: { members: { where: { leftAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, splitWeight: true } } },
  });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(await privatePath(id));
  // Someone who left (or was removed) reads the group only on its main screen, up to the day they left.
  if (await leaverOf(myId)) redirect(`/groups/${group.id}`);
  return (
    <>
      <PageHeader title="Add a regular bill" back={`/groups/${group.id}?tab=bills`} />
      {/* A change of the group's currency redraws the form, so an amount typed in the old currency is never sent under the new one. */}
      <BillForm
        key={group.currency}
        groupId={group.id}
        members={group.members.map(({ id, name }) => ({ id, name }))}
        myId={myId}
        splitName={splitNameFor(group.type)}
        splitLabel={weightsLabel(group.members.map((m) => m.splitWeight))}
        currency={group.currency}
        error={notes.error?.slice(0, 160)}
      />
    </>
  );
}
