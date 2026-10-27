"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { shareCountdownInLoopin } from "@/app/countdown-actions";
import { useDragToClose } from "@/lib/use-drag-close";

// "Share": a small panel with three ways to share the countdown.
// - WhatsApp: the story-sized picture (for a chat or Status) through the
//   phone's share step; where pictures can't be shared, WhatsApp opens with the words.
// - Everyone in the trip, in Loopin: in their Alerts and a buzz on their phones.
// - More apps: Instagram and the rest, through the phone's share step.
export function ShareCountdown({ groupId, line, className }: { groupId: string; line: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const dragRef = useDragToClose(useCallback(() => setOpen(false), []));
  const [busy, setBusy] = useState<"" | "wa" | "app" | "more">("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const url = `/groups/${groupId}/countdown-image`;
  const words = `${line} ✨`;

  // The picture is made as soon as the panel opens, so a tap on WhatsApp shares
  // it straight away (phones only allow sharing right after the tap: waiting
  // for the picture first made it fall back to plain text).
  const pic = useRef<Promise<File | null> | null>(null);
  useEffect(() => {
    if (!open) return;
    pic.current ??= fetch(url)
      .then(async (res) => (res.ok ? new File([await res.blob()], "countdown.png", { type: "image/png" }) : null))
      .catch(() => null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, url]);

  async function shareFile(): Promise<"shared" | "closed" | "cant"> {
    const file = await (pic.current ?? Promise.resolve(null));
    if (file && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: words });
        return "shared";
      } catch (e) {
        return (e as Error)?.name === "AbortError" ? "closed" : "cant";
      }
    }
    return "cant";
  }

  async function whatsapp() {
    setBusy("wa");
    setNote(null);
    const r = await shareFile();
    if (r === "cant") {
      // No picture sharing here: WhatsApp with the words. Straight into the app on a
      // phone (wa.me's web page mangled the emoji into “�”), its web page elsewhere.
      const text = encodeURIComponent(`${words} Counting the days on Loopin: ${window.location.origin}`);
      if (/Android|iPhone|iPad/i.test(navigator.userAgent)) window.location.href = `whatsapp://send?text=${text}`;
      else window.open(`https://api.whatsapp.com/send?text=${text}`, "_blank", "noopener");
    }
    setBusy("");
  }

  async function more() {
    setBusy("more");
    setNote(null);
    const r = await shareFile();
    if (r === "cant") window.open(url, "_blank", "noopener"); // the picture opens, to save it
    setBusy("");
  }

  async function inLoopin() {
    setBusy("app");
    setNote(null);
    try {
      const r = await shareCountdownInLoopin(groupId);
      setNote({ ok: r.ok, text: r.message });
    } catch {
      setNote({ ok: false, text: "Couldn’t send it. Check your connection and try again." });
    }
    setBusy("");
  }

  const row = "flex w-full items-center gap-3.5 rounded-2xl border border-line px-4 py-3.5 text-left active:bg-mist disabled:opacity-60";
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setNote(null);
          setOpen(true);
        }}
        aria-haspopup="dialog"
        className={className ?? "inline-flex h-8 items-center gap-1.5 rounded-full border border-fg/20 bg-fg/[0.08] px-3 text-xs font-semibold active:bg-fg/20"}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14" />
        </svg>
        Share
      </button>
      {open &&
        createPortal(
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Share the countdown"
            onClick={(e) => e.stopPropagation()}
            ref={dragRef}
            className="sheet-enter w-full max-w-md rounded-t-[28px] border-t border-line bg-canvas px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 text-fg"
          >
            <span aria-hidden className="mx-auto mb-4 block h-1 w-10 rounded-full bg-fg/20" />
            <p className="font-display text-xl font-semibold tracking-tight">Share the countdown</p>
            <p className="mt-1 text-sm text-fg/60">{words}</p>
            <div className="mt-5 space-y-2.5">
              <button type="button" onClick={whatsapp} disabled={busy !== ""} className={row}>
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#25d366]/15 text-[#25d366]">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{busy === "wa" ? "Getting the picture…" : "WhatsApp"}</span>
                  <span className="block text-xs text-fg/50">The picture, for a chat or your Status</span>
                </span>
              </button>
              <button type="button" onClick={inLoopin} disabled={busy !== ""} className={row}>
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-owed/[0.14] text-owed">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{busy === "app" ? "Sending…" : "Everyone in the trip"}</span>
                  <span className="block text-xs text-fg/50">In Loopin: their Alerts and a buzz on their phones</span>
                </span>
              </button>
            </div>
            {/* Instagram and the rest: a small link, so the choice is simply WhatsApp or Loopin. */}
            <button type="button" onClick={more} disabled={busy !== ""} className="mt-3 w-full text-center text-xs font-semibold text-fg/50 underline disabled:opacity-60">
              {busy === "more" ? "Getting the picture…" : "Other apps (Instagram…) or save the picture"}
            </button>
            {note && (
              <p role="status" className={`mt-4 rounded-xl px-4 py-3 text-sm ${note.ok ? "bg-owed/10 text-owed" : "bg-owe/10 text-owe"}`}>
                {note.text}
              </p>
            )}
            <button type="button" onClick={() => setOpen(false)} className="mt-4 w-full py-2.5 text-sm font-semibold text-fg/60">
              Close
            </button>
          </div>
        </div>,
        // On the page itself, so the card's rounded corners and swipe row don't clip it.
        document.body,
      )}
    </>
  );
}
