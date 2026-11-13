import Link from "@/components/Link";
import { ConfirmButton } from "@/components/ConfirmButton";
import { DotsIcon } from "@/components/MomentIcons";
import { SafetyLinks } from "@/components/SafetyLinks";
import { deleteMomentAction } from "@/app/moment-actions";
import type { MomentCard } from "@/lib/moments-db";

export const DELETE_MOMENT_TEXT = "This removes the photo for everyone. It can’t be undone.";

// The "⋯" menu on a moment (a plain details element: no script). Delete (the author) and Remove (whoever looks after the group) are quiet
// links that ask first; Report and Block are for everyone else.
export function MomentMenu({ card, back, canDelete, canReport, guest, openHref }: { card: MomentCard; back: string; canDelete: boolean; canReport: boolean; guest: boolean; openHref?: string }) {
  const quiet = "flex min-h-11 w-full items-center px-3 text-left text-[15px] font-medium text-fg/75 active:text-fg";
  const first = card.authorName === "You" ? "" : card.authorName;
  if (!openHref && !canDelete && !canReport && !guest) return null;
  return (
    <details className="relative" data-moment-menu={card.id}>
      <summary aria-label="More for this moment" className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full text-fg/75 active:bg-mist [&::-webkit-details-marker]:hidden">
        <DotsIcon size={22} />
      </summary>
      <div className="absolute right-0 top-11 z-10 w-60 rounded-[14px] border border-line bg-white py-1 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]">
        {openHref && (
          <Link href={openHref} className={quiet}>
            Open
          </Link>
        )}
        {canDelete && (
          <form action={deleteMomentAction}>
            <input type="hidden" name="momentId" value={card.id} />
            <ConfirmButton message={DELETE_MOMENT_TEXT} className={quiet}>
              {card.authorIsMe ? "Delete this moment" : "Remove this moment"}
            </ConfirmButton>
          </form>
        )}
        {canReport && <SafetyLinks kind="moment" targetId={card.id} accountId={card.authorAccountId} name={first || "them"} back={back} className="justify-start" />}
        {!canReport && guest && !card.authorIsMe && (
          <Link href={`/report?${new URLSearchParams({ kind: "moment", id: card.id, back })}`} className={quiet}>
            Report
          </Link>
        )}
      </div>
    </details>
  );
}
