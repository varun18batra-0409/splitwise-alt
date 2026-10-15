"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// In the installed app there's no browser refresh button, so:
//  - coming back to the app (after 20+ seconds away) loads the latest changes;
//  - pulling down at the top of any screen refreshes it (iPhone and Android).
export function AppRefresh() {
  const router = useRouter();
  const [pull, setPull] = useState(0); // 0..1
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > 20_000) router.refresh();
    };
    document.addEventListener("visibilitychange", onVis);

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!standalone) return () => document.removeEventListener("visibilitychange", onVis);

    const onStart = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && !document.querySelector("[role=dialog]") ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = e.touches[0].clientY - start.current;
      setPull(dy > 0 ? Math.min(1, dy / 90) : 0);
    };
    const onEnd = () => {
      if (start.current !== null && pullRef.current >= 1) {
        setBusy(true);
        router.refresh();
        setTimeout(() => setBusy(false), 900);
      }
      start.current = null;
      setPull(0);
    };
    const pullRef = { current: 0 };
    const track = (e: TouchEvent) => {
      onMove(e);
      if (start.current !== null) pullRef.current = Math.min(1, Math.max(0, (e.touches[0].clientY - start.current) / 90));
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", track, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", track);
      window.removeEventListener("touchend", onEnd);
    };
  }, [router]);

  if (!pull && !busy) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-40 flex justify-center">
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-full border border-line bg-canvas text-fg shadow-lg ${busy ? "animate-spin" : ""}`}
        style={{ opacity: busy ? 1 : pull, transform: busy ? undefined : `rotate(${pull * 270}deg)` }}
        aria-hidden
      >
        ↻
      </span>
    </div>
  );
}
