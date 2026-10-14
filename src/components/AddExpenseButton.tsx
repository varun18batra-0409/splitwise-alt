"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PlusIcon } from "./icons";

// "Add expense", floating at the bottom of the screens where it makes sense.
// (Home lives at the top of every screen.)
export function AddExpenseButton() {
  const path = usePathname();
  const hidden =
    path.startsWith("/join") ||
    path === "/groups/new" ||
    path === "/add" ||
    path.endsWith("/add") ||
    path.endsWith("/edit") ||
    path.endsWith("/settings") ||
    path.endsWith("/pay") ||
    path.endsWith("/people") ||
    path === "/notifications";
  if (hidden) return null;

  const inGroup = /^\/groups\/([^/]+)/.exec(path);
  const href = inGroup ? `/groups/${inGroup[1]}/add` : "/add";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center bg-gradient-to-t from-canvas via-canvas/80 to-transparent px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10">
      <Link
        href={href}
        className="pop pointer-events-auto flex w-full max-w-[22rem] items-center justify-center gap-2 bg-fg py-3.5 text-[15px] font-semibold tracking-wide text-canvas"
      >
        <PlusIcon size={18} />
        Add expense
      </Link>
    </div>
  );
}
