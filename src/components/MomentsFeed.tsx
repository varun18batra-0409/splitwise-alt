import Link from "@/components/Link";
import { ChevronRightIcon } from "@/components/MomentIcons";
import { timeAgo } from "@/lib/moments-text";
import type { MomentCard } from "@/lib/moments-db";

// A list of moments as rows (a small photo, who added it and when, the words). Used by the Our moments page and by a group's Memories tab,
// so a row looks and works the same in both. Each row opens the viewer. A plain <img> on purpose: moment photos are private and never go
// through Next's image service.
export function MomentsFeed({ cards, groupId, now, className = "space-y-3" }: { cards: MomentCard[]; groupId: string; now: Date; className?: string }) {
  const here = `/groups/${groupId}/moments`;
  return (
    <ul className={className}>
      {cards.map((c) => (
        <li key={c.id}>
          <Link href={`${here}/${c.id}`} id={`m-${c.id}`} className="flex min-h-[4.5rem] items-center gap-3 rounded-[14px] border border-line bg-white p-2.5 active:bg-mist" data-moment-row={c.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.thumb} alt="" width={72} height={56} loading="lazy" className="h-14 w-[4.5rem] shrink-0 rounded-[10px] bg-mist object-cover" />
            <span className="min-w-0 flex-1 border-l border-line pl-3">
              {/* Two lines: the name (never cut) and when, then the words. Each truncates on its own. */}
              <span className="flex min-w-0 items-baseline gap-1.5 text-[15px]">
                <span className="shrink-0 font-semibold">{c.authorName}</span>
                <span className="min-w-0 truncate text-fg/55">added a moment</span>
                <span className="shrink-0 whitespace-nowrap text-fg/55" data-moment-time>· {timeAgo(c.createdAt, now)}</span>
              </span>
              {c.caption && <span className="emoji-font-display block truncate font-display text-[15px] italic text-fg/75">“{c.caption}”</span>}
            </span>
            <ChevronRightIcon size={20} className="shrink-0 text-fg/55" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
