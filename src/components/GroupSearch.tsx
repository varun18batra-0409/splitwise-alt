"use client";

import { useState } from "react";
import { SearchIcon } from "@/components/icons";

// "Find a group": shown on Your groups only when the list is long. It hides the rows (each carries its lower-case name in
// data-name) that don't match; nothing is removed or reloaded, and clearing the box brings every row back.
export function GroupSearch() {
  const [q, setQ] = useState("");
  const [none, setNone] = useState(false);

  function filter(value: string) {
    setQ(value);
    const needle = value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll<HTMLElement>("[data-all-groups] > li[data-name]").forEach((li) => {
      const hit = !needle || (li.dataset.name ?? "").includes(needle);
      li.hidden = !hit;
      if (hit) shown++;
    });
    setNone(Boolean(needle) && shown === 0);
  }

  return (
    <div className="mb-4" data-group-search>
      <label className="flex min-h-12 items-center gap-3 rounded-[14px] border border-line bg-white px-4 text-fg/60 focus-within:border-fg/40">
        <SearchIcon size={18} />
        <span className="sr-only">Find a group</span>
        <input
          type="search"
          value={q}
          onChange={(e) => filter(e.target.value)}
          placeholder="Find a group"
          autoComplete="off"
          enterKeyHint="search"
          className="min-w-0 flex-1 bg-transparent py-3 text-base text-fg outline-none placeholder:text-fg/55"
        />
      </label>
      {none && <p className="px-1 pt-3 text-sm text-fg/60">No group with that name.</p>}
    </div>
  );
}
