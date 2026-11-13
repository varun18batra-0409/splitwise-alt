"use client";

import Link from "@/components/Link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BellIcon } from "./icons";

// The bell at the top right of Home, Your groups and You. Opens Your updates; a small off-white dot shows when something is new.
// The number comes from the same plain fetch the bottom bar used to make, so it never delays the next tap.
export function BellButton({ className = "" }: { className?: string }) {
  const path = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/unread", { signal: ctl.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((d: { n?: number }) => setUnread(Number(d.n) || 0))
      .catch(() => {});
    return () => ctl.abort();
  }, [path]);

  return (
    <Link
      href="/notifications"
      aria-label={unread ? `Updates (${unread} new)` : "Updates"}
      data-bell
      data-unread={unread || undefined}
      className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg/85 transition-transform active:scale-95 active:bg-fg/10 ${className}`}
    >
      <BellIcon size={22} />
      {unread ? <span aria-hidden className="absolute right-[11px] top-[10px] h-2 w-2 rounded-full bg-fg ring-2 ring-canvas" /> : null}
    </Link>
  );
}
