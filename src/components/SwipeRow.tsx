"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { buzz } from "@/lib/haptics";

export const SWIPE_ACTION_WIDTH = 76;

// Swipe a row to the left to show its quick actions (Edit, Delete), like Mail or WhatsApp.
// The row is the <summary> inside `children` (a <details>), so tapping still opens the details;
// a tap right after a swipe, or on an open row, just closes it instead.
// Touch only: with a mouse, the same actions sit in the row's details.
export function SwipeRow({ actions, count, children }: { actions: ReactNode; count: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const width = SWIPE_ACTION_WIDTH * count;

  useEffect(() => {
    const el = box.current;
    const row = el?.querySelector("summary") as HTMLElement | null;
    if (!el || !row) return;
    row.style.position = "relative";
    row.style.zIndex = "1";
    row.style.background = "var(--color-canvas)";
    row.style.touchAction = "pan-y";

    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let base = 0;
    let mode: "" | "x" | "y" = "";
    let swiped = false;
    let ticked = false;
    let isOpen = false;

    const place = (x: number, animate: boolean) => {
      row.style.transition = animate ? "transform 280ms cubic-bezier(.2,.9,.25,1)" : "none";
      row.style.transform = x ? `translate3d(${x}px,0,0)` : "";
    };
    const settle = (o: boolean) => {
      isOpen = o;
      setOpen(o);
      place(o ? -width : 0, true);
    };

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      mode = "";
      swiped = false;
      ticked = isOpen;
      base = isOpen ? -width : 0;
      dx = base;
      if (tray.current) tray.current.style.height = `${row.offsetHeight}px`;
    };
    const move = (e: TouchEvent) => {
      const mx = e.touches[0].clientX - x0;
      const my = e.touches[0].clientY - y0;
      if (!mode) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        mode = Math.abs(mx) > Math.abs(my) * 1.2 ? "x" : "y";
      }
      if (mode !== "x") return;
      e.preventDefault();
      swiped = true;
      const raw = base + mx;
      // Follows the finger; past the actions it gets heavier, and it never goes right of home.
      dx = raw > 0 ? 0 : raw < -width ? -width + (raw + width) * 0.3 : raw;
      place(dx, false);
      if (!ticked && dx < -width * 0.5) {
        ticked = true;
        buzz("tap");
      }
    };
    const end = () => {
      if (mode === "x") settle(dx < -width * 0.4);
      mode = "";
    };
    // A tap that ends a swipe, or lands on an open row, must not open the details.
    const click = (e: MouseEvent) => {
      if (swiped || isOpen) {
        e.preventDefault();
        e.stopPropagation();
        if (!swiped) settle(false);
        swiped = false;
      }
    };
    // Touching anywhere else closes an open row.
    const outside = (e: TouchEvent) => {
      if (isOpen && !el.contains(e.target as Node)) settle(false);
    };

    row.addEventListener("touchstart", start, { passive: true });
    row.addEventListener("touchmove", move, { passive: false });
    row.addEventListener("touchend", end);
    row.addEventListener("touchcancel", end);
    row.addEventListener("click", click, true);
    document.addEventListener("touchstart", outside, { passive: true });
    return () => {
      row.removeEventListener("touchstart", start);
      row.removeEventListener("touchmove", move);
      row.removeEventListener("touchend", end);
      row.removeEventListener("touchcancel", end);
      row.removeEventListener("click", click, true);
      document.removeEventListener("touchstart", outside);
    };
  }, [width]);

  return (
    <div ref={box} className="relative overflow-x-clip" data-swipe-row={open ? "open" : "closed"}>
      <div ref={tray} inert={!open} aria-hidden={!open} className="absolute right-0 top-0 flex overflow-hidden" style={{ width, height: 0 }}>
        {actions}
      </div>
      {children}
    </div>
  );
}
