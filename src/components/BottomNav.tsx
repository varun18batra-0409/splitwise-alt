"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BellIcon, HomeIcon, PlusIcon, SearchIcon, SettleIcon } from "./icons";

// The bar at the bottom of every main screen: Home · Search · ＋ · Settle · Alerts.
// Inside a group, Search / ＋ / Settle work on that group.
// Hidden on forms (adding, editing, paying, joining) so it never gets in the way.
const HIDE = [/^\/join/, /^\/groups\/new$/, /\/add$/, /^\/add$/, /\/edit$/, /\/pay$/, /^\/signin/, /^\/welcome$/];

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
    { href: g ? `/search?g=${g}` : "/search", label: "Search", icon: <SearchIcon size={22} />, on: path === "/search" },
    { href: g ? `/groups/${g}/settle` : "/settle", label: "Settle", icon: <SettleIcon size={22} />, on: path === "/settle" || path.endsWith("/settle") },
    { href: "/notifications", label: "Alerts", icon: <BellIcon size={22} />, on: path === "/notifications", badge: unread },
  ];
  const cell = (it: (typeof items)[number]) => (
    <Link
      key={it.label}
      href={it.href}
      aria-current={it.on ? "page" : undefined}
      aria-label={it.badge ? `${it.label}, ${it.badge} new` : it.label}
      className={`relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] ${it.on ? "text-fg" : "text-gray-500"}`}
    >
      {it.icon}
      <span className={it.on ? "font-semibold" : ""}>{it.label}</span>
      {it.badge ? (
        <span className="absolute left-1/2 top-0 ml-1.5 min-w-[17px] rounded-full bg-fg px-1 text-center text-[10px] font-semibold leading-[17px] text-canvas tabular-nums">
          {it.badge > 9 ? "9+" : it.badge}
        </span>
      ) : null}
    </Link>
  );

  return (
    <nav
      aria-label="Main"
      className="bottom-nav fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur"
    >
      <div className="mx-auto flex max-w-md items-end px-2">
        {cell(items[0])}
        {cell(items[1])}
        <Link
          href={g ? `/groups/${g}/add` : "/add"}
          aria-label="Add expense"
          className="pop mx-2 -mt-5 flex h-14 w-14 shrink-0 items-center justify-center bg-fg text-canvas [--pop-edge:#6e6b63]"
        >
          <PlusIcon size={26} />
        </Link>
        {cell(items[2])}
        {cell(items[3])}
      </div>
    </nav>
  );
}
