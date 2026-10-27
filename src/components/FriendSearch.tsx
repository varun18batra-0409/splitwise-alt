"use client";

import { useEffect, useRef, useState } from "react";

// A search box over the friends list (by name or a country they've been to).
// Filters what's already on the page; nothing is sent anywhere.
export function FriendSearch({ count, children }: { count: number; children: React.ReactNode }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(count);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    let n = 0;
    box.current?.querySelectorAll<HTMLElement>("[data-search]").forEach((li) => {
      const hit = words.every((w) => (li.dataset.search ?? "").includes(w));
      li.hidden = !hit;
      if (hit) n++;
    });
    setShown(n);
  }, [q]);
  return (
    <div ref={box}>
      {count > 6 && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or country" aria-label="Search friends" autoComplete="off" className="mb-3 w-full rounded-xl border border-line bg-transparent px-4 py-3 text-base outline-none focus:border-fg/50" />
      )}
      {children}
      {shown === 0 && <p className="py-6 text-center text-sm text-gray-500">Nobody matches “{q}”.</p>}
    </div>
  );
}
