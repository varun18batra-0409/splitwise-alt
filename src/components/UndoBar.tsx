"use client";

import { useEffect, useState } from "react";
import { undoChange } from "@/app/actions";

// Slides up right after a change: "You deleted Dinner · Undo".
// After an undo it offers "Redo". Hides itself after 10 seconds — the same
// Undo stays available in the group's Activity history.
export function UndoBar({
  text,
  groupId,
  eventId,
  back,
  redo,
}: {
  text: string;
  groupId: string;
  eventId: string;
  back: "group" | "balances" | "home" | "people";
  redo?: boolean;
}) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 10_000);
    return () => clearTimeout(t);
  }, [eventId]);
  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center px-5" role="status" aria-live="polite">
      <div className="sheet-enter pointer-events-auto flex w-full max-w-md items-center gap-3 border border-line bg-white px-4 py-3 shadow-2xl shadow-black/60">
        <p className="min-w-0 flex-1 truncate text-sm">{text}</p>
        <form action={undoChange}>
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="back" value={back} />
          <button type="submit" className="pop shrink-0 bg-fg px-3 py-1.5 text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
            {redo ? "Redo" : "Undo"}
          </button>
        </form>
        <button type="button" onClick={() => setVisible(false)} aria-label="Dismiss" className="shrink-0 px-1 text-lg leading-none text-gray-400">
          ×
        </button>
      </div>
    </div>
  );
}
