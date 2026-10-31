"use client";

import { useState } from "react";
import { PostcardBack, PostcardFront, type BackProps, type FrontProps } from "./Card";
import { buzz } from "@/lib/haptics";

// Each side is shown only while it faces you (switching halfway through the turn), so a side never
// shows through mirrored, even where a browser ignores backface-visibility.
export const face = (shown: boolean) => ({ visibility: shown ? ("visible" as const) : ("hidden" as const), transition: "visibility 0s linear 0.4s" });

// A postcard you can turn over (tap, or the button), and send on as two pictures.
export function PostcardFlip({ front, back, className = "", start = "front" }: { front: FrontProps; back: BackProps; className?: string; start?: "front" | "back" }) {
  const [over, setOver] = useState(start === "back");
  return (
    <button
      type="button"
      onClick={() => {
        setOver((o) => !o);
        buzz("tap");
      }}
      aria-label={over ? "Turn to the front" : "Turn over to read it"}
      className={`block w-full text-left [perspective:1600px] ${className}`}
      data-postcard-flip={over ? "back" : "front"}
    >
      <div className="relative transition-transform duration-[900ms] ease-[cubic-bezier(.2,.8,.2,1)] [transform-style:preserve-3d] motion-reduce:transition-none" style={{ transform: over ? "rotateY(180deg)" : "none" }}>
        <div className="[backface-visibility:hidden]" style={face(!over)}>
          <PostcardFront {...front} />
        </div>
        <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]" style={face(over)}>
          <PostcardBack {...back} />
        </div>
      </div>
    </button>
  );
}

export function PostcardShare({ front, back, name }: { front: FrontProps; back: BackProps; name: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function share() {
    setBusy(true);
    setNote("");
    try {
      const { drawBack, drawFront } = await import("./render");
      const [f, b] = await Promise.all([drawFront(front), drawBack(back)]);
      const files = [new File([f], `${name}-front.jpg`, { type: "image/jpeg" }), new File([b], `${name}-back.jpg`, { type: "image/jpeg" })];
      if (navigator.canShare?.({ files })) {
        await navigator.share({ files }).catch(() => {});
      } else {
        for (const file of files) {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(file);
          a.download = file.name;
          a.click();
        }
        setNote("Saved both sides as pictures.");
      }
    } catch {
      setNote("Couldn’t make the pictures on this phone.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" onClick={share} disabled={busy} data-postcard-share className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-fg/18 bg-fg/[0.07] text-[15px] font-semibold active:scale-[0.97] disabled:opacity-60">
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6" />
        </svg>
        {busy ? "Making the pictures…" : "Send on WhatsApp"}
      </button>
      <p className="mt-2 text-center text-xs text-fg/45" role="status">
        {note || "Goes as two pictures: the front, then the back."}
      </p>
    </div>
  );
}
