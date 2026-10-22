"use client";

import { useState } from "react";

// "Your Loopin friends": people you share a group with. Tap to add them to a
// collection; they're told inside Loopin (Alerts and their phone), not on WhatsApp.
export function FriendPicker({ friends, className = "" }: { friends: { id: string; name: string }[]; className?: string }) {
  const [on, setOn] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  if (!friends.length) return null;
  const shown = all ? friends : friends.slice(0, 12);
  const toggle = (id: string) =>
    setOn((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className={className}>
      <p className="mb-2 text-sm font-medium text-gray-600">
        Your Loopin friends <span className="font-normal text-gray-400">(they get it in the app)</span>
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Your Loopin friends">
        {shown.map((f) => {
          const picked = on.has(f.id);
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={picked}
              onClick={() => toggle(f.id)}
              className={`flex h-9 items-center gap-2 rounded-full border pl-1 pr-3 text-[13px] ${picked ? "border-owed/50 bg-owed/[0.12] text-fg" : "border-line text-fg/80 active:bg-mist"}`}
            >
              <span aria-hidden className={`flex h-7 w-7 items-center justify-center rounded-full font-display text-[12px] font-semibold ${picked ? "bg-owed text-canvas" : "bg-fg/[0.08]"}`}>
                {picked ? "✓" : f.name.charAt(0).toUpperCase()}
              </span>
              {f.name}
            </button>
          );
        })}
        {!all && friends.length > 12 && (
          <button type="button" onClick={() => setAll(true)} className="h-9 rounded-full px-3 text-[13px] text-gray-500 underline">
            +{friends.length - 12} more
          </button>
        )}
      </div>
      {[...on].map((id) => (
        <input key={id} type="hidden" name="friends" value={id} />
      ))}
    </div>
  );
}
