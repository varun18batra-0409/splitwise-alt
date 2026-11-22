"use client";

import { useState } from "react";
import Link from "@/components/Link";
import { ExpenseGlyph } from "@/components/ExpenseGlyph";
import { guessCategory, isCategory } from "@/lib/categories";
import { draftTitle, rowLine } from "@/lib/offline/describe";
import { W } from "@/lib/offline/words";
import type { Draft } from "@/lib/offline/types";

// "N expenses waiting on this phone", with the words from the approved mockup.
export function WaitingCard({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <section aria-label="Waiting on this phone" className="mb-5 rounded-[18px] border border-line bg-white px-4 py-3.5" data-offline-waiting>
      <p className="text-[14px] font-semibold">{W.waitingTitle(count)}</p>
      <p className="mt-1 text-[13px] leading-snug text-fg/65">{W.waitingNote}</p>
    </section>
  );
}

const tag = "shrink-0 rounded-full border border-fg/25 px-2.5 py-1 text-[12px] text-fg/75";

// One waiting expense, as a row in the list. A refused one says why, and offers Open and fix and Remove from this phone.
export function DraftRow({ draft, nameOf, canFix, onRemove }: { draft: Draft; nameOf: (id: string) => string; canFix: boolean; onRemove: (key: string) => void }) {
  const [asking, setAsking] = useState(false);
  const category = isCategory(draft.category) ? draft.category : guessCategory(draft.name);
  return (
    <li className="border-b border-line py-3" data-draft-row data-draft-status={draft.status}>
      <div className="flex items-center gap-3.5">
        <ExpenseGlyph title={draft.name} category={category} label="" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words text-[15px] font-semibold leading-snug tracking-tight">{draftTitle(draft)}</p>
          <p className="mt-0.5 break-words text-[13px] leading-snug text-fg/60">{rowLine(draft, nameOf)}</p>
        </div>
        <span className={tag}>{W.onThisPhone}</span>
      </div>
      {draft.status === "refused" && draft.reason && (
        <p role="status" className="mt-2 pl-[3.25rem] text-[13px] leading-snug text-owe" data-draft-reason>
          {draft.reason}
        </p>
      )}
      {(draft.status === "refused" || canFix) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-5 pl-[3.25rem]">
          {draft.status === "refused" && canFix && (
            <Link href={`/groups/${draft.groupId}/add?fix=${encodeURIComponent(draft.key)}`} className="flex min-h-11 items-center text-[14px] font-semibold text-fg underline underline-offset-4" data-draft-fix>
              {W.openAndFix}
            </Link>
          )}
          {asking ? (
            <span className="flex items-center gap-4 text-[14px]">
              <button type="button" onClick={() => onRemove(draft.key)} className="min-h-11 font-semibold text-owe" data-draft-remove-yes>
                Yes, remove it
              </button>
              <button type="button" onClick={() => setAsking(false)} className="min-h-11 text-fg/75">
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setAsking(true)} className="min-h-11 text-[14px] text-fg/75 underline underline-offset-4" data-draft-remove>
              {W.removeFromPhone}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
