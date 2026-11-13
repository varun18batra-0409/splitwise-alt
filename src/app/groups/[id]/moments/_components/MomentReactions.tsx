import { reactMomentAction } from "@/app/moment-actions";
import { MORE_REACTIONS, REACTIONS } from "@/lib/reactions";
import { PlusSmallIcon } from "@/components/MomentIcons";
import type { MomentCard } from "@/lib/moments-db";

// Reaction chips: outline pills, your own with the one selected style (1.5 px off-white edge). Tap one to react, again to take it back.
// "+" opens the emoji choices. Someone who can't react (left the group, or signed out) sees the counts only. No script needed.
const chip = "inline-flex h-11 min-w-[3.25rem] items-center justify-center gap-1.5 rounded-full px-3 text-[15px] tabular-nums";
const plain = `${chip} border border-fg/25 text-fg/75`;
const mine = `${chip} border-[1.5px] border-fg text-fg`;

export function MomentReactions({ card, canReact, from }: { card: MomentCard; canReact: boolean; from: "list" | "view" }) {
  const hidden = (
    <>
      <input type="hidden" name="momentId" value={card.id} />
      <input type="hidden" name="from" value={from} />
    </>
  );
  return (
    <div className="flex flex-wrap items-center gap-2" data-reactions={card.id}>
      {card.reactions.map((r) =>
        canReact ? (
          <form key={r.emoji} action={reactMomentAction}>
            {hidden}
            <button type="submit" name="emoji" value={r.emoji} aria-pressed={r.mine} aria-label={`${r.emoji} ${r.count}${r.mine ? ", yours. Tap to take it back" : ""}`} className={r.mine ? mine : plain}>
              <span aria-hidden>{r.emoji}</span> {r.count}
            </button>
          </form>
        ) : (
          <span key={r.emoji} className={plain}>
            <span aria-hidden>{r.emoji}</span> {r.count}
          </span>
        ),
      )}
      {canReact && (
        <details className="relative">
          <summary aria-label="React" className={`${plain} cursor-pointer list-none px-0 [&::-webkit-details-marker]:hidden`} style={{ width: 44, minWidth: 44 }}>
            <PlusSmallIcon size={20} />
          </summary>
          <form action={reactMomentAction} className="absolute bottom-12 left-0 z-10 grid w-[15.5rem] grid-cols-6 gap-1 rounded-[14px] border border-line bg-white p-2 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]">
            {hidden}
            {[...REACTIONS, ...MORE_REACTIONS].map((e) => (
              <button key={e} type="submit" name="emoji" value={e} aria-label={`React ${e}`} className="flex h-10 w-10 items-center justify-center rounded-full text-xl active:bg-mist">
                {e}
              </button>
            ))}
          </form>
        </details>
      )}
    </div>
  );
}
