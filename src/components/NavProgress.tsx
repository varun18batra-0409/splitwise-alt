"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

// A thin bar at the top that starts the instant you tap a link or send a
// form, and finishes when the next screen is on. So a tap always shows that
// something is happening, even on a slow connection.
function Bar() {
  const path = usePathname();
  const query = useSearchParams().toString();
  const [on, setOn] = useState(false);

  // The new screen arrived: finish.
  useEffect(() => setOn(false), [path, query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same screen (or #anchor)
      setOn(true);
    };
    const onSubmit = (e: SubmitEvent) => {
      if (!e.defaultPrevented) setOn(true);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
    };
  }, []);

  // Never leave it running (e.g. a form that only shows an error in place).
  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => setOn(false), 12_000);
    return () => window.clearTimeout(t);
  }, [on]);

  if (!on) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px] overflow-hidden" role="progressbar" aria-label="Loading">
      <div className="nav-progress h-full w-1/3 bg-fg" />
    </div>
  );
}

export function NavProgress() {
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}
