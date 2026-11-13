"use client";

import { useEffect } from "react";

// Brings one element into view when the page opens. Used after a delete, where the page arrives from a long settings
// screen and Safari can keep that screen's scroll position, leaving the "Recently deleted" box above the top of the screen.
export function ScrollToOnMount({ id }: { id: string }) {
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.6) el.scrollIntoView({ block: "start" });
  }, [id]);
  return null;
}
