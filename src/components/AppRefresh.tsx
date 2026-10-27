"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buzz } from "@/lib/haptics";

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
    // The app is open: from now on, coming back to Home shows a quick outline, not the opening screen.
    (window as { __lpBooted?: boolean }).__lpBooted = true;
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
      if (start.current === null) return;
      const was = pullRef.current;
      pullRef.current = Math.min(1, Math.max(0, (e.touches[0].clientY - start.current) / 90));
      if (was < 1 && pullRef.current >= 1) buzz("tap"); // far enough: let go to refresh
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
        className={`flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white text-fg shadow-[0_10px_24px_rgba(0,0,0,0.5)] ${busy ? "animate-spin" : ""}`}
        style={{ opacity: busy ? 1 : Math.max(0.25, pull), transform: busy ? undefined : `translateY(${pull * 14}px) rotate(${pull * 300}deg) scale(${0.7 + pull * 0.3})` }}
        aria-hidden
        data-pull-refresh
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path d="M20 4v5h-5" />
        </svg>
      </span>
    </div>
  );
}
