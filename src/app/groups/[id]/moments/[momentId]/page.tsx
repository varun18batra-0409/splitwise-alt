import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { canDeleteMoment, canReactToMoment, canReportMoment, loadMomentViewer } from "@/lib/moments-access";
import { loadMomentCard } from "@/lib/moments-db";
import { MomentBig } from "../_components/MomentBig";

export const metadata = { title: "Moment", robots: { index: false } };
export const dynamic = "force-dynamic";

// One moment, full size, with its words, day and reactions. The "⋯" menu holds Delete (the author), Remove (whoever looks after the
// group), and Report and Block. Anyone who may not see it gets "not found", the same as a moment that doesn't exist.
export default async function MomentPage({ params, searchParams }: { params: Promise<{ id: string; momentId: string }>; searchParams: Promise<{ from?: string }> }) {
  const { id, momentId } = await params;
  const { from: cameFrom } = (await searchParams) ?? {};
  const viewer = await loadMomentViewer(id);
  const card = await loadMomentCard(viewer, momentId);
  if (!viewer || !card) notFound();
  const group = await db.group.findUnique({ where: { id }, select: { name: true } });
  if (!group) notFound();
  const here = `/groups/${id}/moments`;
  return (
    <div className="pb-16">
      {/* Opened from Home's Memories row: Back goes home. Anything else about `from` is ignored. */}
      <PageHeader title="Moment" back={cameFrom === "home" ? "/" : here} />
      <MomentBig
        card={card}
        place={group.name.replace(/\s+trip$/i, "").trim() || group.name}
        canReact={canReactToMoment(viewer, card)}
        canDelete={canDeleteMoment(viewer, card)}
        canReport={canReportMoment(viewer, card)}
        guest={viewer.accountId === null}
        back={`${here}/${card.id}`}
        from={cameFrom === "home" ? "home" : "view"}
        now={new Date()}
      />
    </div>
  );
}
