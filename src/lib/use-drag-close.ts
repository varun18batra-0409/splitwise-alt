"use client";

import { useCallback, useRef } from "react";
import { buzz } from "./haptics";

// Bottom sheets: drag down to close, like any phone sheet. Put the returned ref on the sheet panel.
// The drag only starts when nothing inside is scrolled down and you're not in a text box;
// `from: "top"` limits it to the sheet's top strip (for sheets that are mostly a scrolling list).
export function useDragToClose(onClose: () => void, { from = "anywhere" }: { from?: "anywhere" | "top" } = {}) {
  const cleanup = useRef<(() => void) | undefined>(undefined);
  return useCallback(
    (el: HTMLElement | null) => {
      cleanup.current?.();
      cleanup.current = undefined;
      if (!el) return;

      let x0 = 0;
      let y0 = 0;
      let dy = 0;
      let mode: "" | "drag" | "off" = "";

      const scrolledInside = (target: EventTarget | null) => {
        for (let n = target as HTMLElement | null; n && n !== el; n = n.parentElement) if (n.scrollTop > 0) return true;
        return el.scrollTop > 0;
      };
      const start = (e: TouchEvent) => {
        const t = e.touches[0];
        x0 = t.clientX;
        y0 = t.clientY;
        dy = 0;
        mode = "";
        const target = e.target as HTMLElement;
        if (e.touches.length !== 1) mode = "off";
        else if (from === "top" && t.clientY - el.getBoundingClientRect().top > 72) mode = "off";
        else if (target.closest?.("input, textarea, select, [contenteditable]")) mode = "off";
        else if (scrolledInside(target)) mode = "off";
      };
      const move = (e: TouchEvent) => {
        if (mode === "off") return;
        const mx = e.touches[0].clientX - x0;
        const my = e.touches[0].clientY - y0;
        if (!mode) {
          if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
          mode = my > 0 && my > Math.abs(mx) ? "drag" : "off";
          if (mode === "off") return;
          el.style.animation = "none"; // the opening animation would otherwise hold the sheet in place
        }
        e.preventDefault();
        dy = Math.max(0, my);
        el.style.transition = "none";
        el.style.transform = `translate3d(0,${dy}px,0)`;
      };
      const end = () => {
        if (mode !== "drag") {
          mode = "";
          return;
        }
        mode = "";
        if (dy > Math.min(140, el.offsetHeight * 0.25)) {
          buzz("tap");
          el.style.transition = "transform 200ms ease-in";
          el.style.transform = `translate3d(0,${el.offsetHeight}px,0)`;
          setTimeout(onClose, 180);
        } else {
          el.style.transition = "transform 280ms cubic-bezier(.2,.9,.25,1)";
          el.style.transform = "";
        }
      };

      el.addEventListener("touchstart", start, { passive: true });
      el.addEventListener("touchmove", move, { passive: false });
      el.addEventListener("touchend", end);
      el.addEventListener("touchcancel", end);
      el.dataset.dragClose = from;
      cleanup.current = () => {
        el.removeEventListener("touchstart", start);
        el.removeEventListener("touchmove", move);
        el.removeEventListener("touchend", end);
        el.removeEventListener("touchcancel", end);
      };
    },
    [onClose, from],
  );
}
