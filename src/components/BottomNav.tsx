"use client";

import Link from "@/components/Link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BellIcon, ChartIcon, HomeIcon, PlusIcon, SettleIcon } from "./icons";

// The bar at the bottom of every main screen, floating as a frosted pill: Home, Recap, ＋, Settle, Alerts.
// Inside a group, Search / ＋ / Settle work on that group.
// Hidden on forms (adding, editing, paying, joining) so it never gets in the way.
const HIDE = [/^\/join/, /^\/groups\/new$/, /\/add$/, /^\/add$/, /\/edit$/, /\/pay$/, /^\/signin/, /^\/welcome$/, /^\/collect\//, /^\/c\//];

export function BottomNav() {
  const path = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    // A plain fetch, not a server action, so it never delays the next tap.
    const ctl = new AbortController();
    fetch("/api/unread", { signal: ctl.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((d: { n?: number }) => setUnread(Number(d.n) || 0))
      .catch(() => {});
    return () => ctl.abort();
  }, [path]);

  if (HIDE.some((re) => re.test(path))) return null;

  const g = /^\/groups\/([^/]+)/.exec(path)?.[1];
  const items = [
    { href: "/", label: "Home", icon: <HomeIcon size={22} />, on: path === "/" },
    { href: g ? `/search?g=${g}` : "/search", label: "Recap", icon: <ChartIcon size={22} />, on: path === "/search" },
    { href: g ? `/groups/${g}/settle` : "/settle", label: "Settle", icon: <SettleIcon size={22} />, on: path === "/settle" || path.endsWith("/settle") },
    { href: "/notifications", label: "Alerts", icon: <BellIcon size={22} />, on: path === "/notifications", badge: unread },
  ];
  const cell = (it: (typeof items)[number]) => (
    <Link
      key={it.label}
      href={it.href}
      aria-current={it.on ? "page" : undefined}
      aria-label={it.badge ? `${it.label}, ${it.badge} new` : it.label}
      className={`relative flex flex-1 flex-col items-center gap-[3px] py-1 text-[11px] font-semibold transition-colors ${it.on ? "text-fg" : "text-fg/45"}`}
    >
      {it.icon}
      <span>{it.label}</span>
      {it.badge ? (
        <span className="absolute left-1/2 top-0 ml-1.5 min-w-[17px] rounded-full bg-fg px-1 text-center text-[10px] font-semibold leading-[17px] text-canvas tabular-nums">
          {it.badge > 9 ? "9+" : it.badge}
        </span>
      ) : null}
    </Link>
  );

  return (
    <nav aria-label="Main" className="bottom-nav pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="glass-strong pointer-events-auto mx-auto flex h-[66px] max-w-[416px] items-center rounded-full px-2 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]">
        {cell(items[0])}
        {cell(items[1])}
        <Link
          href={g ? `/groups/${g}/add` : "/add"}
          aria-label="Add expense"
          data-haptic="tap"
          className="pop mx-1.5 flex h-[52px] w-[52px] shrink-0 items-center justify-center bg-fg text-canvas"
        >
          <PlusIcon size={26} />
        </Link>
        {cell(items[2])}
        {cell(items[3])}
      </div>
    </nav>
  );
}
