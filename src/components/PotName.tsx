"use client";

import { useState } from "react";
import { renamePlayerAction } from "@/app/pot-actions";

// A player's name in The Pot: tap it (or press and hold) to fix a spelling slip.
export function PotName({ gameId, memberId, name, shown, editable }: { gameId: string; memberId: string; name: string; shown: string; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  if (!editable) return <span className="block truncate font-medium">{shown}</span>;
  if (!editing)
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        onContextMenu={(e) => {
          e.preventDefault();
          setEditing(true);
        }}
        aria-label={`${shown}: fix the name`}
        className="block max-w-full truncate text-left font-medium underline decoration-dotted decoration-fg/30 underline-offset-4"
      >
        {shown}
      </button>
    );
  return (
    <form action={renamePlayerAction} className="flex gap-1.5" aria-label={`Fix ${name}'s name`}>
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="memberId" value={memberId} />
      <input
        name="name"
        defaultValue={name}
        required
        maxLength={40}
        autoFocus
        autoComplete="off"
        aria-label="Name"
        className="min-w-0 flex-1 rounded-lg border border-line bg-mist px-2.5 py-1.5 text-sm outline-none focus:border-accent"
      />
      <button type="submit" className="shrink-0 rounded-lg bg-fg px-3 text-xs font-semibold text-canvas">
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className="shrink-0 px-1.5 text-xs text-gray-500" aria-label="Cancel">
        ✕
      </button>
    </form>
  );
}
