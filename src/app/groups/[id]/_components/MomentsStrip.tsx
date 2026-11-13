import Link from "@/components/Link";
import { CameraIcon, PlusSmallIcon } from "@/components/MomentIcons";
import { momentPhotoSrc } from "@/lib/moments-db";

// A small "Our moments" row on a trip group's page: the latest photos and how many. Tapping opens the Our moments page.
// Empty: one line that opens the add form. Someone who left sees it read-only (no "+"); someone who can't add and has nothing to see gets nothing.
export function MomentsStrip({ groupId, count, latest, canAdd }: { groupId: string; count: number; latest: string[]; canAdd: boolean }) {
  if (count === 0) {
    if (!canAdd) return null;
    return (
      <Link href={`/groups/${groupId}/moments/new`} className="mb-5 flex h-16 items-center gap-3 rounded-[20px] border border-line bg-white px-4 text-[15px] font-semibold active:bg-mist" data-moments-strip="empty">
        <CameraIcon size={22} className="text-fg/75" />
        Add the first moment
      </Link>
    );
  }
  return (
    <div className="mb-5 flex h-16 items-center gap-3 rounded-[20px] border border-line bg-white pl-4 pr-2" data-moments-strip={count}>
      <Link href={`/groups/${groupId}/moments`} className="flex min-w-0 flex-1 items-center gap-3 self-stretch" aria-label={`Our moments, ${count}`}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold leading-tight">Our moments</span>
          <span className="block text-[13px] text-fg/55">{count}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {latest.slice(0, 4).map((id, i) => (
            // A plain image on purpose: moment photos are private and never go through Next's image service.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={momentPhotoSrc(id, "t")} alt="" width={44} height={44} loading="lazy" className={`h-11 w-11 rounded-[10px] bg-mist object-cover ${i === 2 ? "hidden min-[360px]:block" : i >= 3 ? "hidden min-[420px]:block" : ""}`} />
          ))}
        </span>
      </Link>
      {canAdd && (
        <Link href={`/groups/${groupId}/moments/new`} aria-label="Add a moment" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-fg/25 text-fg active:bg-fg/10">
          <PlusSmallIcon size={22} />
        </Link>
      )}
    </div>
  );
}
