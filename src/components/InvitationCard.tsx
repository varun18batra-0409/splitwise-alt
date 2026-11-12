import { answerInvitation } from "@/app/actions";
import { GroupCover } from "@/components/GroupCover";
import { coverFor } from "@/lib/covers";
import type { Invitation } from "@/lib/invitations";

export const kindWord = (type: string) => (type === "trip" ? "Trip" : type === "home" ? "Home" : type === "couple" ? "Couple" : type === "pot" ? "Game night" : "Group");

// "Asha added you to Goa trip": Join or Not now. Shown on Home and in Alerts. The group isn't
// in your groups until you tap Join; Not now just hides the card.
export function InvitationCard({ inv }: { inv: Invitation }) {
  return (
    <section aria-label={`Invitation to ${inv.groupName}`} className="vault overflow-hidden rounded-[26px]" data-invitation>
      <div className="relative h-[132px] overflow-hidden" aria-hidden>
        <GroupCover {...coverFor(inv.cover, true)} uid={`inv-${inv.key.slice(0, 12)}`} sizes="(max-width: 448px) 100vw, 448px" />
        <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(13,13,15,0.05),rgba(13,13,15,0.65))]" />
        <span className="absolute bottom-3.5 left-[18px] text-[13px] text-fg/80">
          {kindWord(inv.type)} · {inv.people} {inv.people === 1 ? "person" : "people"}
        </span>
      </div>
      <form action={answerInvitation} className="space-y-3.5 px-[18px] pb-[18px] pt-4">
        <input type="hidden" name="key" value={inv.key} />
        <div>
          <p className="text-sm text-fg/65">{inv.byName} added you to</p>
          <p className="font-display text-[26px] font-semibold leading-tight tracking-tight" data-invitation-name>{inv.groupName}</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="submit" name="answer" value="join" className="pop h-12 bg-fg text-[15px] font-semibold text-canvas [--pop-edge:#6e6b63]">
            Join
          </button>
          <button type="submit" name="answer" value="later" className="h-12 rounded-full border border-fg/20 text-[15px] font-semibold text-fg transition-transform active:scale-[0.97]">
            Not now
          </button>
        </div>
      </form>
    </section>
  );
}
