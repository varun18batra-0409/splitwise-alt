import Link from "@/components/Link";
import { MomentMenu } from "./MomentMenu";
import { MomentReactions } from "./MomentReactions";
import { timeAgo } from "@/lib/moments-text";
import type { MomentCard } from "@/lib/moments-db";

// One moment as a big card: who and when, the photo, the words in Fraunces, where and which day, and the reactions.
// A plain <img>, never next/image: the photo is private and Next's image service has no cookies, so it could not fetch it.
export function MomentBig({
  card,
  place,
  canReact,
  canDelete,
  canReport,
  guest,
  back,
  link,
  from,
  now,
}: {
  card: MomentCard;
  place: string;
  canReact: boolean;
  canDelete: boolean;
  canReport: boolean;
  guest: boolean;
  back: string;
  link?: string; // the photo opens the viewer (on the list); on the viewer itself there is none
  from: "list" | "view" | "home";
  now: Date;
}) {
  const ratio = card.width > 0 && card.height > 0 ? `${card.width} / ${card.height}` : "4 / 3";
  const photo = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={card.full} alt={card.caption || "A moment from the trip"} width={card.width || 1200} height={card.height || 900} loading="lazy" decoding="async" style={{ aspectRatio: ratio }} className="max-h-[75svh] w-full bg-mist object-cover" />
  );
  return (
    <article id={`m-${card.id}`} className="overflow-hidden rounded-[20px] border border-line bg-white" data-moment={card.id}>
      <header className="flex items-center gap-3 px-4 py-3">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1f1f24] text-lg font-semibold text-fg">
          {card.authorInitial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{card.authorName}</p>
          <p className="text-[13px] text-fg/55">{timeAgo(card.createdAt, now)}</p>
        </div>
        <MomentMenu card={card} back={back} canDelete={canDelete} canReport={canReport} guest={guest} openHref={link} />
      </header>
      {link ? (
        <Link href={link} aria-label="Open this moment">
          {photo}
        </Link>
      ) : (
        photo
      )}
      <div className="px-4 pb-4 pt-3">
        {card.caption && <p className="emoji-font-display break-words font-display text-[22px] font-semibold leading-snug">{card.caption}</p>}
        <p className="mb-3 mt-0.5 text-[13px] text-fg/55">{[place, card.day].filter(Boolean).join(" · ")}</p>
        <MomentReactions card={card} canReact={canReact} from={from} />
      </div>
    </article>
  );
}
