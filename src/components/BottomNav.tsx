"use client";

import Link from "@/components/Link";
import { usePathname } from "next/navigation";
import { GroupIcon, HomeIcon, PersonIcon, PlusIcon, SettleIcon } from "./icons";

// The bar at the bottom of every main screen, floating as a frosted pill: Home, Groups, ＋, Settle, You.
// Inside a group, ＋ and Settle work on that group.
// Recap lives on Home's month card, on each group, and on the You page; the unread count lives on the bell (BellButton).
// Hidden on forms (adding, editing, paying, joining, group settings, a new bill, moving out), where a Save bar sits at the bottom instead, so it never gets in the way.
const HIDE = [/^\/join/, /^\/groups\/new$/, /\/add$/, /^\/add$/, /\/edit$/, /\/pay$/, /^\/groups\/[^/]+\/settings$/, /^\/groups\/[^/]+\/bills\/new$/, /^\/groups\/[^/]+\/people\/[^/]+\/move$/, /^\/groups\/[^/]+\/pot\/new$/, /^\/groups\/[^/]+\/budgets$/, /^\/groups\/[^/]+\/goals\/new$/, /^\/signin/, /^\/welcome$/, /^\/collect\//, /^\/c\//, /^\/p\//, /^\/postcards\/new/, /^\/groups\/[^/]+\/wrapped$/];

export function BottomNav() {
  const path = usePathname();

  if (HIDE.some((re) => re.test(path))) return null;

  const g = /^\/groups\/([^/]+)/.exec(path)?.[1];
  const onSettle = path === "/settle" || path.endsWith("/settle");
  const items = [
    { href: "/", label: "Home", icon: <HomeIcon size={22} />, on: path === "/" },
    { href: "/groups", label: "Groups", icon: <GroupIcon size={22} />, on: (path === "/groups" || path.startsWith("/groups/")) && !onSettle },
    { href: g ? `/groups/${g}/settle` : "/settle", label: "Settle", icon: <SettleIcon size={22} />, on: onSettle },
    { href: "/account", label: "You", icon: <PersonIcon size={22} />, on: path === "/account" || path.startsWith("/account/") || path.startsWith("/passport") || path.startsWith("/postcards") },
  ];
  // aria-current: "page" only on the link to this exact page; a section that is merely lit (Groups on a group page) says "true", so the page's own tabs stay the one current page.
  const cell = (it: (typeof items)[number]) => (
    <Link
      key={it.label}
      href={it.href}
      aria-current={it.on ? (it.href === path ? "page" : "true") : undefined}
      aria-label={it.label}
      className={`relative flex min-h-11 min-w-0 flex-1 flex-col items-center gap-[3px] py-1 text-[11px] font-semibold transition-colors ${it.on ? "text-fg" : "text-fg/75"}`}
    >
      {it.icon}
      <span>{it.label}</span>
    </Link>
  );

  return (
    <nav aria-label="Main" data-bottom-nav className="bottom-nav pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="glass-bar pointer-events-auto mx-auto flex h-[66px] max-w-[416px] items-center rounded-full px-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]">
        {cell(items[0])}
        {cell(items[1])}
        <Link
          href={g ? `/groups/${g}/add` : "/add"}
          aria-label="Add expense"
          data-haptic="tap"
          className="pop mx-1 flex h-[52px] w-[52px] shrink-0 items-center justify-center bg-fg text-canvas"
        >
          <PlusIcon size={26} />
        </Link>
        {cell(items[2])}
        {cell(items[3])}
      </div>
    </nav>
  );
}
