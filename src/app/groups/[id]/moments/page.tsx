import { notFound } from "next/navigation";
import Link from "@/components/Link";
import { db } from "@/lib/db";
import { getTimeZone } from "@/lib/tz";
import { dayKey } from "@/lib/dates";
import { niceDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { Stories } from "@/components/Stories";
import { CameraPlusIcon, ChevronRightIcon, SavedIcon } from "@/components/MomentIcons";
import { canAddMoment, canDeleteMoment, canOpenMoments, canReactToMoment, canReportMoment, loadMomentViewer } from "@/lib/moments-access";
import { listMoments, type MomentCard } from "@/lib/moments-db";
import { momentPageStories } from "@/lib/moments-stories";
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
  const [group, cards, tz] = await Promise.all([db.group.findUnique({ where: { id }, select: { name: true } }), listMoments(viewer), getTimeZone()]);
  if (!group) notFound();
  const now = new Date();
  const where = place(group.name);
  const here = `/groups/${id}/moments`;
  const canAdd = canAddMoment(viewer);
  const guest = viewer.accountId === null;
  const [newest, ...older] = cards;
  const flags = (c: MomentCard) => ({
    canReact: canReactToMoment(viewer, c),
    canDelete: canDeleteMoment(viewer, c),
    canReport: canReportMoment(viewer, c),
  });
  const stories = momentPageStories(cards, id, group.name, now);

  // With 20 or more, the older ones are grouped by day.
  const rows = (list: MomentCard[]) =>
    list.map((c) => (
      <li key={c.id}>
        <Link href={`${here}/${c.id}`} id={`m-${c.id}`} className="flex min-h-[4.5rem] items-center gap-3 rounded-[14px] border border-line bg-white p-2.5 active:bg-mist" data-moment-row={c.id}>
          {/* A plain image on purpose: moment photos are private and never go through Next's image service. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.thumb} alt="" width={72} height={56} loading="lazy" className="h-14 w-[4.5rem] shrink-0 rounded-[10px] bg-mist object-cover" />
          <span className="min-w-0 flex-1 border-l border-line pl-3">
            <span className="block truncate text-[15px] font-semibold">{c.authorIsMe ? "You added a moment" : `${c.authorName} added a moment`}</span>
            {c.caption && <span className="block truncate font-display text-[15px] italic text-fg/75">“{c.caption}”</span>}
          </span>
          <ChevronRightIcon size={20} className="shrink-0 text-fg/55" />
        </Link>
      </li>
    ));
  const grouped = older.length + 1 >= 20;
  const days = grouped ? [...new Set(older.map((c) => dayKey(c.createdAt, tz)))] : [];

  return (
    <div className="pb-48">
      <PageHeader title="Our moments" back={`/groups/${id}`} hideTitle />
      {stories.length > 0 && <Stories stories={stories} className="-mt-3 mb-5" />}
      <p aria-hidden className="font-display text-[34px] font-semibold leading-tight tracking-[-0.02em]">
        Our moments
      </p>
      <p className="mb-5 mt-1 text-base text-fg/55">{where} · Only your group</p>
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
          {older.length > 0 && !grouped && <ul className="mt-4 space-y-3">{rows(older)}</ul>}
          {grouped &&
            days.map((d) => (
              <section key={d} className="mt-5">
                <h2 className="mb-2 text-[13px] font-medium text-fg/55">{niceDate(d)}</h2>
                <ul className="space-y-3">{rows(older.filter((c) => dayKey(c.createdAt, tz) === d))}</ul>
              </section>
            ))}
          <p className="mt-6 flex items-center justify-center gap-2 text-[15px] text-fg/75">
            <SavedIcon size={20} className="text-fg/55" />
            Saved with this trip
          </p>
        </>
      )}

      {canAdd ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-[416px]">
            <Link href={`${here}/new`} className="pointer-events-auto pop flex min-h-14 w-full items-center justify-center gap-3 bg-fg px-5 text-base font-semibold text-canvas">
              <CameraPlusIcon size={24} />
              Add your moment
            </Link>
            <p className="mt-2 text-center font-display text-[13px] italic text-fg/55">One photo. A few words. Our story.</p>
          </div>
        </div>
      ) : guest ? (
        <p className="mt-8 text-center text-sm text-fg/75">
          <Link href={`/signin?${new URLSearchParams({ back: `${here}/new` })}`} className="font-semibold underline underline-offset-4">
            Sign in to add a moment
          </Link>
        </p>
      ) : viewer.leftAt ? (
        <p className="mt-8 text-center text-sm text-fg/55">You left this group, so you can look back but not add.</p>
      ) : null}
    </div>
  );
}
