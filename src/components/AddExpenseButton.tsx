"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The floating bar at the bottom of every screen:
// a Home button (everywhere except home) and the big "+ Add expense" button.
export function AddExpenseButton() {
  const path = usePathname();

  // Where the add button would get in the way (forms, invite pages).
  const hideAdd =
    path.startsWith("/join") ||
    path === "/groups/new" ||
    path === "/add" ||
    path.endsWith("/add") ||
    path.endsWith("/edit") ||
    path === "/notifications";
  const showHome = path !== "/";
  if (hideAdd && !showHome) return null;

  const inGroup = /^\/groups\/([^/]+)/.exec(path);
  const href = inGroup ? `/groups/${inGroup[1]}/add` : "/add";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="relative mx-auto flex max-w-md items-center justify-center px-5">
        {showHome && (
          <Link
            href="/"
            aria-label="Home"
            className="pointer-events-auto absolute left-5 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-white/90 text-fg shadow-lg shadow-black/50 backdrop-blur active:bg-mist"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 10.5 12 3l9 7.5" />
              <path d="M5.5 9v11h13V9" />
              <path d="M10 20v-5.5h4V20" />
            </svg>
          </Link>
        )}
        {!hideAdd && (
          <Link
            href={href}
            className="pop pointer-events-auto bg-accent px-7 py-4 text-base font-semibold text-canvas [--pop-edge:#1d7a4c]"
          >
            + Add expense
          </Link>
        )}
      </div>
    </div>
  );
}
