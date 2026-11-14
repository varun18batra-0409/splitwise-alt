import { notFound } from "next/navigation";
import Link from "@/components/Link";
import { db } from "@/lib/db";
import { getTimeZone } from "@/lib/tz";
import { dayKey } from "@/lib/dates";
import { niceDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { Stories } from "@/components/Stories";
import { CameraPlusIcon, SavedIcon } from "@/components/MomentIcons";
import { MomentsFeed } from "@/components/MomentsFeed";
import { canAddMoment, canDeleteMoment, canOpenMoments, canReactToMoment, canReportMoment, loadMomentViewer } from "@/lib/moments-access";
import { listMoments, type MomentCard } from "@/lib/moments-db";
import { momentPageStories } from "@/lib/moments-stories";
import { coverFor } from "@/lib/covers";
import { tripPhotoSrc } from "@/lib/places";
import { MomentBig } from "./_components/MomentBig";

export const metadata = { title: "Our moments", robots: { index: false } };
export const dynamic = "force-dynamic";

const place = (name: string) => name.replace(/\s+trip$/i, "").trim() || name;

// "Our moments": a group's photos and a few words. The newest is a big card; older ones are rows that open the viewer.
// Only people in the group get here (a stranger, or a signed-out phone, gets "not found"); someone who left sees what was added before they left.
export default async function MomentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ removed?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const viewer = await loadMomentViewer(id);
  if (!canOpenMoments(viewer) || viewer.groupType !== "trip") notFound();
  const [group, cards, tz] = await Promise.all([db.group.findUnique({ where: { id }, select: { id: true, name: true, type: true, cover: true, coverAt: true, tripPlace: true } }), listMoments(viewer), getTimeZone()]);
  if (!group) notFound();
  const now = new Date();
  const where = place(group.name);
  const here = `/groups/${id}/moments`;
  const canAdd = canAddMoment(viewer);
  const guest = viewer.accountId === null;
  const leftAlready = Boolean(viewer.leftAt);
  const [newest, ...older] = cards;
  // The Add button floats at the bottom only when there is a long list to scroll; on a short one it sits at the end of the list, so it
  // never covers the first post's caption or reactions.
  const floating = canAdd && cards.length > 2;
  const addLink = (
    <Link href={`${here}/new`} className="pop flex min-h-14 w-full items-center justify-center gap-3 bg-fg px-5 text-base font-semibold text-canvas">
      <CameraPlusIcon size={24} />
      Add your moment
    </Link>
  );
  const flags = (c: MomentCard) => ({
    canReact: canReactToMoment(viewer, c),
    canDelete: canDeleteMoment(viewer, c),
    canReport: canReportMoment(viewer, c),
  });
  const stories = momentPageStories(cards, id, group.name, now, { photo: tripPhotoSrc(group), cover: coverFor(group) });

  // With 20 or more, the older ones are grouped by day (the rows are MomentsFeed, shared with the group's Memories tab).
  const grouped = older.length + 1 >= 20;
  const days = grouped ? [...new Set(older.map((c) => dayKey(c.createdAt, tz)))] : [];

  return (
    <div className={floating ? "pb-60" : "pb-10"}>
      <PageHeader title="Our moments" back={`/groups/${id}`} hideTitle />
      {stories.length > 0 && <Stories stories={stories} className="-mt-3 mb-5" />}
      <p aria-hidden className="font-display text-[34px] font-semibold leading-tight tracking-[-0.02em]">
        Our moments
      </p>
      <p className="mb-5 mt-1 text-base text-fg/55">{where} · {leftAlready ? "From your time in the group" : "Only your group"}</p>
      {sp.removed && (
        <p role="status" className="mb-4 text-sm text-fg/75">
          That moment is gone.
        </p>
      )}

      {!newest ? (
        <div className="rounded-[20px] border border-line bg-white px-5 py-6" data-moments-empty>
          <p className="font-display text-xl font-semibold">No moments yet</p>
          <p className="mt-1 text-sm text-fg/55">One photo and a few words. Only people in this group see them.</p>
        </div>
      ) : (
        <>
          <MomentBig card={newest} place={where} {...flags(newest)} guest={guest} back={here} link={`${here}/${newest.id}`} from="list" now={now} />
          {older.length > 0 && !grouped && <MomentsFeed cards={older} groupId={id} now={now} className="mt-4 space-y-3" />}
          {grouped &&
            days.map((d) => (
              <section key={d} className="mt-5">
                <h2 className="mb-2 text-[13px] font-medium text-fg/55">{niceDate(d)}</h2>
                <MomentsFeed cards={older.filter((c) => dayKey(c.createdAt, tz) === d)} groupId={id} now={now} />
              </section>
            ))}
          <p className="mt-6 flex items-center justify-center gap-2 text-[15px] text-fg/75">
            <SavedIcon size={20} className="text-fg/55" />
            Saved with this trip
          </p>
        </>
      )}

      {canAdd && !floating ? (
        <div className="mt-6" data-moments-add-inline>
          {addLink}
        </div>
      ) : canAdd ? (
        <div className="fixed inset-x-0 bottom-0 z-20 bg-[#0d0d0f] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3" data-moments-add-panel>
          <div className="mx-auto max-w-[416px]">
            {addLink}
          </div>
        </div>
      ) : guest ? (
        <p className="mt-8 text-center text-sm text-fg/75">
          <Link href={`/signin?${new URLSearchParams({ back: `${here}/new` })}`} className="font-semibold underline underline-offset-4">
            Sign in to add a moment
          </Link>
        </p>
      ) : leftAlready ? (
        <p className="mt-8 text-center text-sm text-fg/55">You left this group, so you can look back but not add.</p>
      ) : null}
    </div>
  );
}
