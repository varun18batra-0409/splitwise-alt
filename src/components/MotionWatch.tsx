"use client";

import { useEffect } from "react";

// Icons that move once (a group's expense list): each plays its motion the
// first time it scrolls into view, then rests. One watcher for the whole app;
// it also picks up icons that appear later (a new screen, "show more").
export function MotionWatch() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("lp-go");
          seen.unobserve(e.target);
        }
      },
      { threshold: 0.6 },
    );
    const scan = () => document.querySelectorAll(".lp-mo-once:not(.lp-go)").forEach((el) => seen.observe(el));
    scan();
    let queued = false;
    const changes = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        scan();
      });
    });
    changes.observe(document.body, { childList: true, subtree: true });
    return () => {
      changes.disconnect();
      seen.disconnect();
    };
  }, []);
  return null;
}
