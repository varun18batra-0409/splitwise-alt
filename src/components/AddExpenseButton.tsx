"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The big "+ Add expense" button that floats at the bottom of every screen.
export function AddExpenseButton() {
  const path = usePathname();

  // Hide it where it would get in the way (forms and invite pages).
  if (path.startsWith("/join") || path === "/groups/new" || path === "/add" || path.endsWith("/add")) {
    return null;
  }

  const inGroup = /^\/groups\/([^/]+)/.exec(path);
  const href = inGroup ? `/groups/${inGroup[1]}/add` : "/add";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <Link
        href={href}
        className="pointer-events-auto rounded-full bg-accent px-7 py-4 text-base font-semibold text-white shadow-lg shadow-accent/30 active:bg-accent-dark"
      >
        + Add expense
      </Link>
    </div>
  );
}
