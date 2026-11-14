import Image from "next/image";
import { DotsIcon, LockIcon } from "@/components/PassportIcons";
import { stampInk } from "@/components/stamps/StampArt";
import { removeWishAction } from "@/app/wish-actions";

// One place on your Want to go list: the same card shape as a stamp card (photo left, words right), without a stamp.
// It says who can see it ("Only you" / "Shared with Nupur") and has a menu to take it off the list. Sharing is the one Share button
// under the list (it can share just this place or the whole list), so the card doesn't repeat it.

const PAPER_STYLE = {
  backgroundColor: "#efe8d6",
  backgroundImage:
    "radial-gradient(circle at 50% 120%, transparent 0 38%, rgba(43,76,126,0.06) 38.5% 39%, transparent 39.5% 45%, rgba(43,76,126,0.05) 45.5% 46%, transparent 46.5%), repeating-linear-gradient(115deg, rgba(38,35,29,0.035) 0 1px, transparent 1px 7px)",
} as const;

export function WishCard({
  code,
  name,
  photo,
  lock,
  away,
}: {
  code: string;
  name: string;
  photo?: string | null;
  lock: string; // "Only you" or "Shared with Nupur"
  away?: string; // "Shared with Riya · when you’re in a group together" (kept, but showing nothing today)
}) {
  const ink = stampInk(code, name);
  return (
    <article className="grid grid-cols-[36%_1fr] gap-1 overflow-hidden rounded-[20px] border border-line bg-white p-1.5" data-wish-card={code}>
      {photo ? (
        <div className="relative min-h-[132px] overflow-hidden rounded-[14px] bg-mist">
          <Image src={photo} alt="" fill sizes="140px" className="object-cover" />
        </div>
      ) : (
        <div className="flex min-h-[132px] items-center justify-center overflow-hidden rounded-[14px]" style={PAPER_STYLE} data-wish-panel>
          <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-full border-[3px] font-display text-[22px] font-extrabold" style={{ color: ink, borderColor: ink }}>
            {code}
          </span>
        </div>
      )}
      <div className="relative min-w-0 py-2 pl-2.5 pr-2">
        <h3 className="font-display text-[22px] font-semibold leading-tight tracking-tight [overflow-wrap:normal] [word-break:normal]">{name}</h3>
        <p className="mt-1.5 flex items-start gap-1.5 text-[14px] leading-snug text-fg/75" data-wish-lock>
          <LockIcon size={16} className="mt-px shrink-0" />
          <span className="min-w-0">{lock}</span>
        </p>
        {away && <p className="mt-1 text-[13px] leading-snug text-fg/55">{away}</p>}
        <div className="h-9" aria-hidden />
        <details className="absolute bottom-0 right-0">
          <summary aria-label={`More for ${name}`} className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full text-fg/75 active:bg-mist [&::-webkit-details-marker]:hidden">
            <DotsIcon size={20} />
          </summary>
          <form action={removeWishAction} className="absolute bottom-full right-0 z-10 mb-1 w-52 rounded-[14px] border border-line bg-canvas p-1 shadow-[0_12px_30px_-12px_rgba(0,0,0,0.9)]">
            <input type="hidden" name="country" value={code} />
            <button type="submit" className="flex min-h-11 w-full items-center rounded-[10px] px-3 text-left text-[14px] text-fg active:bg-mist">
              Remove from list
            </button>
          </form>
        </details>
      </div>
    </article>
  );
}
