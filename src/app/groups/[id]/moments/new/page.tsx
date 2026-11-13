import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { newRequestKey } from "@/lib/once";
import { canAddMoment, canOpenMoments, loadMomentViewer } from "@/lib/moments-access";
import { tripDays } from "@/lib/moments-text";
import { MomentForm } from "./MomentForm";

export const metadata = { title: "Add a moment", robots: { index: false } };
export const dynamic = "force-dynamic";

// Add a moment. Only a current member of a trip group with an account gets the form: a guest is asked to sign in, someone who left
// goes back to the list, and anyone else gets "not found". (The upload is checked again on the server.)
export default async function NewMomentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await loadMomentViewer(id);
  if (!canOpenMoments(viewer) || viewer.groupType !== "trip") notFound();
  if (viewer.accountId === null) redirect(`/signin?${new URLSearchParams({ back: `/groups/${id}/moments/new` })}`);
  if (!canAddMoment(viewer)) redirect(`/groups/${id}/moments`);
  const group = await db.group.findUnique({ where: { id }, select: { tripStart: true, tripEnd: true } });
  const days = tripDays(group?.tripStart ?? "", group?.tripEnd ?? "").map((value, i) => ({ value, label: `Day ${i + 1}` }));
  return (
    <>
      <PageHeader title="Add a moment" back={`/groups/${id}/moments`} />
      <p className="-mt-3 mb-5 text-sm text-fg/55">One photo and a few words. Only people in this group see it.</p>
      <MomentForm groupId={id} days={days} initialKey={newRequestKey()} />
    </>
  );
}
