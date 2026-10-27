"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Share a story-sized picture (All square, Wrapped, your passport): WhatsApp
// first (the picture through the phone's share step; where pictures can't be
// shared, WhatsApp opens with the words), and a small link for other apps or
// to save it. The picture is fetched as soon as the panel opens, because phones
// only allow sharing right after the tap.
export function ShareSheet({ image, fileName, title, words, label = "Share", className }: { image: string; fileName: string; title: string; words: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"" | "wa" | "more">("");
  const pic = useRef<Promise<File | null> | null>(null);

  useEffect(() => {
    if (!open) return;
    pic.current ??= fetch(image)
      .then(async (res) => (res.ok ? new File([await res.blob()], fileName, { type: "image/png" }) : null))
      .catch(() => null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, image, fileName]);

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
    if ((await shareFile()) === "cant") {
      const text = encodeURIComponent(`${words} ${window.location.origin}`);
      if (/Android|iPhone|iPad/i.test(navigator.userAgent)) window.location.href = `whatsapp://send?text=${text}`;
      else window.open(`https://api.whatsapp.com/send?text=${text}`, "_blank", "noopener");
    }
    setBusy("");
  }

  async function more() {
    setBusy("more");
    if ((await shareFile()) === "cant") window.open(image, "_blank", "noopener");
    setBusy("");
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={className ?? "pop block w-full bg-fg px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63]"}>
        {label}
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60" onClick={() => setOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={title}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-t-[28px] border-t border-line bg-canvas px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 text-fg"
            >
              <span aria-hidden className="mx-auto mb-4 block h-1 w-10 rounded-full bg-fg/20" />
              <p className="font-display text-xl font-semibold tracking-tight">{title}</p>
              <p className="mt-1 text-sm text-fg/60">{words}</p>
              <button type="button" onClick={whatsapp} disabled={busy !== ""} className="mt-5 flex w-full items-center gap-3.5 rounded-2xl border border-line px-4 py-3.5 text-left active:bg-mist disabled:opacity-60">
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
              <button type="button" onClick={more} disabled={busy !== ""} className="mt-3 w-full text-center text-xs font-semibold text-fg/50 underline disabled:opacity-60">
                {busy === "more" ? "Getting the picture…" : "Other apps (Instagram…) or save the picture"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="mt-4 w-full py-2.5 text-sm font-semibold text-fg/60">
                Close
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
