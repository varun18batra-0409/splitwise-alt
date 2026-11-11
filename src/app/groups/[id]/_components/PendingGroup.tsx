import { answerInvitation } from "@/app/actions";
import { GroupCover } from "@/components/GroupCover";
import { kindWord } from "@/components/InvitationCard";
import { coverFor } from "@/lib/covers";
import type { Invitation } from "@/lib/invitations";

// A group someone added you to, before you have joined it: only its picture, its name and how many
// people are in it. No names and no amounts until you tap Join.
export function PendingGroup({ inv }: { inv: Invitation }) {
  return (
    <div data-pending-group>
      <div className="relative -mx-5 -mt-[max(1.5rem,env(safe-area-inset-top))] h-[230px] overflow-hidden" aria-hidden>
        <GroupCover {...coverFor(inv.cover, true)} uid={`pending-${inv.groupId}`} sizes="(max-width: 448px) 100vw, 448px" priority />
        <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(13,13,15,0.3)_0%,rgba(13,13,15,0)_30%,#0d0d0f_100%)]" />
      </div>
      <div className="relative -mt-10">
        <p className="text-[13px] text-fg/65">
          {kindWord(inv.type)} · {inv.people} {inv.people === 1 ? "person" : "people"}
        </p>
        <h1 className="font-display text-[34px] font-semibold leading-tight tracking-tight">{inv.groupName}</h1>
        <p className="mt-1 text-[15px] text-fg/70">{inv.byName} added you to this group.</p>
      </div>

      <section className="mt-6 rounded-2xl border border-line px-4 py-4" aria-label="When you join">
        <h2 className="text-sm font-semibold text-fg/70">When you join</h2>
        <ul className="mt-2.5 space-y-2.5 text-[14.5px] leading-snug">
          {[
            "You’ll see its expenses and who owes what",
            "You’ll get its alerts, and people in it can see your trip passport",
            "You can add expenses and settle up",
          ].map((t) => (
            <li key={t} className="flex items-start gap-2.5">
              <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-owed)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </section>

      {inv.used > 0 && (
        <p className="mt-4 text-sm text-fg/65" data-pending-used>
          You’re already in {inv.used} of its {inv.used === 1 ? "expense" : "expenses"}. That stays as it is whether you join or not.
        </p>
      )}

      <form action={answerInvitation} className="mt-6 space-y-2.5">
        <input type="hidden" name="key" value={inv.key} />
        <button type="submit" name="answer" value="join" className="pop block w-full bg-fg px-5 py-3.5 text-center text-base font-semibold text-canvas">
          Join {inv.groupName}
        </button>
        <button type="submit" name="answer" value="later" className="block w-full rounded-full border border-fg/15 bg-fg/[0.06] px-5 py-3.5 text-center text-base font-semibold text-fg transition-transform active:scale-[0.97]">
          Not now
        </button>
      </form>
    </div>
  );
}
