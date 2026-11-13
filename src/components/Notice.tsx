"use client";

import { useEffect, useState } from "react";
import { noticeIdentity } from "@/lib/notice-identity";

// A message at the top of a screen, with a small ✕ to close it.
// - params: the address markers that showed it (e.g. "saved"), removed on
//   close so a refresh doesn't bring it back.
// - remember: closing hides it on this phone until the key changes (used for
//   "Recently deleted", which comes back only when another group is deleted).
const TONES = {
  info: "rounded-[20px] border border-line bg-white px-4 py-3 text-fg",
  success: "rounded-[20px] border border-line bg-white px-4 py-3 text-fg",
  error: "rounded-[20px] border border-line bg-white px-4 py-3 text-owe",
  plain: "",
} as const;

export function Notice({
  tone = "info",
  params = [],
  remember,
  className = "",
  children,
}: {
  tone?: keyof typeof TONES;
  params?: string[];
  remember?: string;
  className?: string;
  children: React.ReactNode;
}) {
  // Closed "for" one identity: a new message (or a different remember key) shows again.
  const id = noticeIdentity(remember, params, children);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!remember) return;
    try {
      if (localStorage.getItem(`hide:${remember}`) === "1") setClosedFor(id);
    } catch {
      // storage unavailable: just show it
    }
  }, [remember, id]);
  if (closedFor === id) return null;

  function close() {
    setClosedFor(id);
    if (remember) {
      try {
        localStorage.setItem(`hide:${remember}`, "1");
      } catch {
        // fine: it's hidden for now anyway
      }
    }
    if (params.length) {
      const u = new URL(window.location.href);
      for (const p of params) u.searchParams.delete(p);
      window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
    }
  }

  return (
    <div role={tone === "error" ? "alert" : "status"} className={`relative pr-10 text-sm ${TONES[tone]} ${className}`}>
      {children}
      <button
        type="button"
        onClick={close}
        aria-label="Close message"
        className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full text-base leading-none opacity-60 active:bg-black/10 active:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}
