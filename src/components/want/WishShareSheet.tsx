"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";
import { shareWishesAction } from "@/app/wish-actions";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useDragToClose } from "@/lib/use-drag-close";
import { SHARE_ALL } from "@/lib/wishes";

// "Share": show one place, or the whole list, to friends you are in a group with. Ticked friends can see it; unticking stops it.
// The server checks everything again (only current friends, only places on your list); this sheet only asks.
export type ShareFriend = { id: string; name: string };
export type ShareRow = { friendId: string; country: string };
export type SharePlace = { code: string; name: string };

export function WishShareSheet({
  friends,
  places,
  shares,
  scope: startScope = SHARE_ALL,
  label = "Share",
  className,
}: {
  friends: ShareFriend[];
  places: SharePlace[];
  shares: ShareRow[]; // rows of people you can see today, from the server
  scope?: string; // a country code, or "*" for the whole list
  label?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const dragRef = useDragToClose(useCallback(() => setOpen(false), []));
  const layer = useFocusTrap(open, { onEscape: () => setOpen(false) });
  const [scope, setScope] = useState(startScope);
  const tickedFor = useCallback((s: string) => shares.filter((r) => r.country === s).map((r) => r.friendId), [shares]);
  const [ticked, setTicked] = useState<string[]>(() => tickedFor(startScope));
  const key = shares.map((r) => `${r.friendId}:${r.country}`).join();
  useEffect(() => {
    // Sharing was saved (the page sent new rows): close and start from what is true now.
    setOpen(false);
    setTicked(tickedFor(scope));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  const pick = (s: string) => {
    setScope(s);
    setTicked(tickedFor(s));
  };
  const toggle = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const one = places.find((p) => p.code === scope);
  const choices = useMemo(() => [{ value: SHARE_ALL, label: "Whole list" }, ...places.map((p) => ({ value: p.code, label: `Just ${p.name}` }))], [places]);
  const disabled = places.length === 0;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" disabled={disabled} className={className ?? "flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-fg/25 px-3 text-[15px] text-fg active:bg-fg/10 disabled:opacity-40"} data-wish-share>
        {label}
      </button>
      {open &&
        createPortal(
          <div ref={layer} className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70" onClick={() => setOpen(false)}>
            <form action={shareWishesAction} role="dialog" aria-modal="true" aria-label="Share your list" onClick={(e) => e.stopPropagation()} ref={dragRef} className="sheet-enter flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-[24px] border border-line bg-canvas text-fg">
              <div className="flex items-center justify-between px-5 pb-2 pt-4">
                <p className="font-display text-xl font-semibold">Share with friends</p>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-xl text-fg/60 active:bg-mist">
                  ×
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2">
                {ticked.map((id) => (
                  <input key={id} type="hidden" name="friend" value={id} />
                ))}
                <label className="block">
                  <span className="mb-1.5 block text-sm text-fg/75">What to share</span>
                  <select name="scope" value={scope} onChange={(e) => pick(e.target.value)} className="h-12 w-full rounded-2xl border border-line bg-mist px-4 text-base text-fg">
                    {choices.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-2 text-sm text-fg/65">
                  {scope === SHARE_ALL ? "The whole list includes places you add later." : `Friends you tick can see ${one?.name ?? "this place"} on your list.`} Only people in a group with you right now can see it.
                </p>
                {friends.length === 0 ? (
                  <p className="mt-4 text-sm text-fg/75">Share places with friends once you are in a group together.</p>
                ) : (
                  <ul className="mt-3" aria-label="Friends">
                    {friends.map((f) => (
                      <li key={f.id}>
                        <label className="flex min-h-12 items-center gap-3 rounded-xl px-1 active:bg-mist">
                          <input type="checkbox" checked={ticked.includes(f.id)} onChange={() => toggle(f.id)} className="h-5 w-5 shrink-0" aria-label={f.name} />
                          <span className="min-w-0 flex-1">{f.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="border-t border-line px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
                <SaveButton none={friends.length === 0} />
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}

function SaveButton({ none }: { none: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={none || pending} className="pop block w-full bg-fg px-4 py-3.5 text-center font-semibold text-canvas [--pop-edge:#6e6b63] disabled:opacity-50">
      {pending ? "Saving…" : "Save"}
    </button>
  );
}
