"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useDragToClose } from "@/lib/use-drag-close";
import { postDraft } from "@/lib/offline/client";
import { amountText, draftTitle, sheetLine, timeText } from "@/lib/offline/describe";
import { phoneLock } from "@/lib/offline/idb";
import { checkWaiting, draftsFor, patchDraft, removeDraft, sendWaiting } from "@/lib/offline/store";
import { W } from "@/lib/offline/words";
import type { Draft } from "@/lib/offline/types";
import type { KV } from "@/lib/offline/store";
import { primaryButtonClass } from "@/components/ui";

// "You're back online": the approved sheet. It opens when the app is open with a signal and expenses are waiting on this phone for
// the group. First it asks the server about each one WITHOUT saving anything (the duplicate questions, anything refused, anything
// already added), then the person chooses. "Add 2 to Goa trip" sends the ticked ones, one at a time, oldest first, each through the
// same checks as an ordinary Add. "Not now" keeps everything on the phone.
export function BackOnlineSheet({
  kv,
  groupId,
  groupName,
  currency,
  tz,
  nameOf,
  onClose,
}: {
  kv: KV;
  groupId: string;
  groupName: string;
  currency: string;
  tz: string;
  nameOf: (id: string) => string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set()); // unticked
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const lock = useMemo(() => phoneLock(), []);
  const dragRef = useDragToClose(onClose);
  const layer = useFocusTrap(true, { onEscape: onClose });

  // The ones the sheet is about: waiting, or waiting on a duplicate answer (refused ones are on the group page, with Open and fix).
  const load = useCallback(async () => {
    const all = await draftsFor(kv, groupId);
    setRows(all.filter((d) => d.status !== "refused"));
    return all;
  }, [kv, groupId]);

  const closed = useRef(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      await load();
      const r = await checkWaiting(kv, postDraft, { lock, groupId });
      if (!live) return;
      const all = await load();
      if (r.stopped) setNote("Couldn’t reach Loopin just now. Nothing is lost: your expenses are still on this phone.");
      // Nothing left to ask about (all already added, or only refused ones, which the group page shows): done.
      if (!all.some((d) => d.status !== "refused") && !closed.current) {
        closed.current = true;
        router.refresh();
        onClose();
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ticked = (rows ?? []).filter((d) => !off.has(d.key));
  const count = ticked.length;

  async function addThem() {
    if (!count || busy) return;
    setBusy(true);
    setNote("");
    const r = await sendWaiting(kv, postDraft, { lock, groupId, keys: ticked.map((d) => d.key) });
    const left = (await load()).filter((d) => d.status !== "refused");
    setBusy(false);
    router.refresh();
    if (r.stopped) setNote("Couldn’t add them just now. Nothing is lost: they are still on this phone. Try again in a moment.");
    else if (!left.length) onClose();
  }

  const same = async (d: Draft) => {
    await removeDraft(kv, d.key);
    await load();
  };
  const keepBoth = async (d: Draft) => {
    await patchDraft(kv, d.key, { keepBoth: true });
    await load();
  };

  return (
    <div ref={layer} className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" role="presentation" onClick={onClose}>
      <section
        ref={dragRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-title"
        data-back-online
        className="sheet-enter max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[24px] border-t border-line bg-canvas px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden className="mx-auto mb-4 block h-1 w-10 rounded-full bg-fg/20" />
        <h2 id="sync-title" className="font-display text-[22px] font-semibold">
          {W.backOnline}
        </h2>
        {rows === null ? (
          <p className="mt-2 text-sm text-fg/65">Checking…</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-fg/70">{W.sheetIntro(rows.length, groupName)}</p>
            <ul className="mt-4 divide-y divide-line">
              {rows.map((d) => {
                const checked = !off.has(d.key);
                return (
                  <li key={d.key} className="py-2.5" data-sheet-row data-draft-status={d.status}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setOff((s) => { const n = new Set(s); if (n.has(d.key)) n.delete(d.key); else n.add(d.key); return n; })}
                        className="h-5 w-5 shrink-0 accent-[#f4f2ec]"
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[15px] font-medium">{draftTitle(d)}</span>
                        <span className="text-[13px] text-fg/60">{sheetLine(d, tz, nameOf)}</span>
                      </span>
                      <span className="money shrink-0 text-[15px] font-semibold tabular-nums">{amountText(d)}</span>
                    </label>
                    {d.status === "duplicate" && d.dup && !d.keepBoth && (
                      <div className="mt-1 rounded-2xl border border-line px-3.5 py-3" data-sheet-duplicate>
                        <p className="flex items-start gap-2 text-[14px] leading-snug">
                          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffab6b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 8v5M12 16.5v.5" />
                          </svg>
                          <span>{W.duplicateQ(d.dup.byId === d.memberId ? "You" : d.dup.by, d.dup.description, formatMoney(d.dup.amount, currency), timeText(Date.parse(d.dup.addedAt ?? d.dup.when), tz))}</span>
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" onClick={() => void same(d)} className="min-h-11 rounded-full border border-fg/25 px-4 text-[14px] font-semibold" data-sheet-same>
                            {W.sameRemove}
                          </button>
                          <button type="button" onClick={() => void keepBoth(d)} className="min-h-11 rounded-full border border-fg/25 px-4 text-[14px] font-semibold" data-sheet-keep>
                            {W.differentKeep}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {note && (
              <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {note}
              </p>
            )}
            <button type="button" onClick={() => void addThem()} disabled={!count || busy} className={`${primaryButtonClass} mt-5`} data-sheet-add>
              {busy ? "Adding…" : W.addN(count, groupName)}
            </button>
            <button type="button" onClick={onClose} className="mx-auto mt-1 flex min-h-11 items-center px-4 text-[15px] font-medium text-fg/80" data-sheet-notnow>
              {W.notNow}
            </button>
            <p className="pb-1 text-center text-[13px] text-fg/60">{W.notNowNote}</p>
          </>
        )}
      </section>
    </div>
  );
}
