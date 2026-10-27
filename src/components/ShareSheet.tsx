"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDragToClose } from "@/lib/use-drag-close";

// Share a story-sized picture (All square, Wrapped, your passport): WhatsApp
// first (the picture through the phone's share step; where pictures can't be
// shared, WhatsApp opens with the words), and a small link for other apps or
// to save it. The pictures are fetched as soon as the panel opens, because
// phones only allow sharing right after the tap.
//
// With an album (the passport's pages), WhatsApp gets every page at once, so
// it arrives as a little booklet; the single picture stays as an option for Status.
export function ShareSheet({
  image,
  fileName,
  title,
  words,
  label = "Share",
  className,
  album,
}: {
  image: string;
  fileName: string;
  title: string;
  words: string;
  label?: string;
  className?: string;
  album?: string[];
}) {
  const [open, setOpen] = useState(false);
  const dragRef = useDragToClose(useCallback(() => setOpen(false), []));
  const [busy, setBusy] = useState<"" | "wa" | "one" | "more">("");
  const pic = useRef<Promise<File | null> | null>(null);
  const pages = useRef<Promise<File[]> | null>(null);
  const many = Boolean(album && album.length > 1);

  useEffect(() => {
    if (!open) return;
    const grab = (src: string, name: string) =>
      fetch(src)
        .then(async (res) => (res.ok ? new File([await res.blob()], name, { type: "image/png" }) : null))
        .catch(() => null);
    pic.current ??= grab(image, fileName);
    if (many && album) {
      const base = fileName.replace(/\.png$/, "");
      pages.current ??= Promise.all(album.map((src, i) => grab(src, `${base}-${i + 1}.png`))).then((fs) => (fs.every(Boolean) ? (fs as File[]) : []));
    }
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, image, fileName, many, album]);

  async function shareFiles(files: File[]): Promise<"shared" | "closed" | "cant"> {
    if (files.length && navigator.canShare?.({ files })) {
      try {
        await navigator.share({ files, text: words });
        return "shared";
      } catch {
        // Closed, or the phone reported back oddly after WhatsApp took it: either
        // way never send a second, plain-text message on top.
        return "closed";
      }
    }
    return "cant";
  }
  const one = async () => {
    const f = await (pic.current ?? Promise.resolve(null));
    return f ? [f] : [];
  };
  const booklet = async () => (many ? await (pages.current ?? Promise.resolve([])) : []);

  async function whatsapp() {
    setBusy("wa");
    // One thing only: the pages (or the picture); words with a link only when this phone can't share pictures at all.
    const files = many ? await booklet() : await one();
    const r = await shareFiles(files.length ? files : await one());
    if (r === "cant") {
      const text = encodeURIComponent(`${words} ${window.location.origin}`);
      if (/Android|iPhone|iPad/i.test(navigator.userAgent)) window.location.href = `whatsapp://send?text=${text}`;
      else window.open(`https://api.whatsapp.com/send?text=${text}`, "_blank", "noopener");
    }
    setBusy("");
  }

  async function single() {
    setBusy("one");
    if ((await shareFiles(await one())) === "cant") window.open(image, "_blank", "noopener");
    setBusy("");
  }

  async function more() {
    setBusy("more");
    if ((await shareFiles(many ? await booklet() : await one())) === "cant") window.open(image, "_blank", "noopener");
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
              ref={dragRef}
              className="sheet-enter w-full max-w-md rounded-t-[28px] border-t border-line bg-canvas px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 text-fg"
            >
              <span aria-hidden className="mx-auto mb-4 block h-1 w-10 rounded-full bg-fg/20" />
              <p className="font-display text-xl font-semibold tracking-tight">{title}</p>
              <p className="mt-1 text-sm text-fg/60">{words}</p>
              {many && album && (
                // The pages, fanned out like a booklet.
                <div className="mt-4 flex items-end gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-album-preview={album.length}>
                  {album.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={src}
                      src={src}
                      alt={i === 0 ? "Cover" : `Page ${i + 1}`}
                      width={72}
                      height={90}
                      className="lp-fan h-[90px] w-[72px] shrink-0 rounded-[8px] border border-line bg-mist object-cover shadow-[0_8px_18px_-10px_rgba(0,0,0,0.9)]"
                      style={{ animationDelay: `${i * 60}ms` }}
                    />
                  ))}
                </div>
              )}
              <button type="button" onClick={whatsapp} disabled={busy !== ""} className="mt-5 flex w-full items-center gap-3.5 rounded-2xl border border-line px-4 py-3.5 text-left active:bg-mist disabled:opacity-60">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#25d366]/15 text-[#25d366]">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{busy === "wa" ? (many ? "Getting the pages…" : "Getting the picture…") : "WhatsApp"}</span>
                  <span className="block text-xs text-fg/50">{many && album ? `The whole booklet: ${album.length} pages, as an album` : "The picture, for a chat or your Status"}</span>
                </span>
              </button>
              {many && (
                <button type="button" onClick={single} disabled={busy !== ""} className="mt-3 flex w-full items-center gap-3.5 rounded-2xl border border-line px-4 py-3.5 text-left active:bg-mist disabled:opacity-60">
                  <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fg/[0.07] text-fg/80">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
                      <path d="M10 18.5h4" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{busy === "one" ? "Getting the picture…" : "One picture"}</span>
                    <span className="block text-xs text-fg/50">Everything on one page, made for Status</span>
                  </span>
                </button>
              )}
              <button type="button" onClick={more} disabled={busy !== ""} className="mt-3 w-full text-center text-xs font-semibold text-fg/50 underline disabled:opacity-60">
                {busy === "more" ? "Getting it ready…" : many ? "Other apps (Instagram…) or save the pages" : "Other apps (Instagram…) or save the picture"}
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
