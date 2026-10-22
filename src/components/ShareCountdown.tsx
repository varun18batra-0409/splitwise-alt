"use client";

import { useState } from "react";

// "Share": the countdown as a story-sized picture, straight to WhatsApp status
// or Instagram (the phone's share sheet). Where pictures can't be shared, the
// picture opens so it can be saved.
export function ShareCountdown({ groupId, text, className }: { groupId: string; text: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const url = `/groups/${groupId}/countdown-image`;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error("no picture");
          const file = new File([await res.blob()], "countdown.png", { type: "image/png" });
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], text });
            return;
          }
          window.open(url, "_blank", "noopener");
        } catch (e) {
          if ((e as Error)?.name !== "AbortError") window.open(url, "_blank", "noopener");
        } finally {
          setBusy(false);
        }
      }}
      className={className ?? "inline-flex h-8 items-center gap-1.5 rounded-full border border-fg/20 bg-fg/[0.08] px-3 text-xs font-semibold active:bg-fg/20 disabled:opacity-60"}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14" />
      </svg>
      {busy ? "Making it…" : "Share"}
    </button>
  );
}
