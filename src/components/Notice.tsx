"use client";

import { useEffect, useState } from "react";

// A message at the top of a screen, with a small ✕ to close it.
// - params: the address markers that showed it (e.g. "saved"), removed on
//   close so a refresh doesn't bring it back.
// - remember: closing hides it on this phone until the key changes (used for
//   "Recently deleted", which comes back only when another group is deleted).
const TONES = {
  info: "rounded-xl bg-mist px-4 py-3 text-fg",
  success: "rounded-xl bg-owed/10 px-4 py-3 text-owed",
  error: "rounded-xl bg-red-50 px-4 py-3 text-red-700",
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
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!remember) return;
    try {
      if (localStorage.getItem(`hide:${remember}`) === "1") setOpen(false);
    } catch {
      // storage unavailable: just show it
    }
  }, [remember]);
  if (!open) return null;

  function close() {
    setOpen(false);
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
