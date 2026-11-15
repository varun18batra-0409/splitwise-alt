import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { canDeleteMoment, canReactToMoment, canReportMoment, loadMomentViewer } from "@/lib/moments-access";
import { loadMomentCard } from "@/lib/moments-db";
import { memoriesBack } from "@/lib/home/memories";
import { MomentBig } from "../_components/MomentBig";

export const metadata = { title: "Moment", robots: { index: false } };
export const dynamic = "force-dynamic";

// One moment, full size, with its words, day and reactions. The "⋯" menu holds Delete (the author), Remove (whoever looks after the
// group), and Report and Block. Anyone who may not see it gets "not found", the same as a moment that doesn't exist.
export default async function MomentPage({ params, searchParams }: { params: Promise<{ id: string; momentId: string }>; searchParams: Promise<{ from?: string; g?: string }> }) {
  const { id, momentId } = await params;
  const { from: cameFrom, g: filter } = (await searchParams) ?? {};
  const away = memoriesBack(cameFrom, filter); // "/" from Home, "/memories" from the Memories page, else null
  const viewer = await loadMomentViewer(id);
  const card = await loadMomentCard(viewer, momentId);
  if (!viewer || !card) notFound();
  const group = await db.group.findUnique({ where: { id }, select: { name: true } });
  if (!group) notFound();
  const here = `/groups/${id}/moments`;
  return (
    <div className="pb-16">
      {/* Opened from Home's Memories row: Back goes home. From the Memories page: Back goes there (with its group filter). Anything else about `from` is ignored. */}
      <PageHeader title="Moment" back={away ?? here} />
      <MomentBig
        card={card}
        place={group.name.replace(/\s+trip$/i, "").trim() || group.name}
        canReact={canReactToMoment(viewer, card)}
        canDelete={canDeleteMoment(viewer, card)}
        canReport={canReportMoment(viewer, card)}
        guest={viewer.accountId === null}
        back={`${here}/${card.id}`}
        from={cameFrom === "home" ? "home" : cameFrom === "memories" ? "memories" : "view"}
        now={new Date()}
      />
    </div>
  );
}
