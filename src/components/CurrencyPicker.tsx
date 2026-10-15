"use client";

import { useMemo, useState } from "react";
import { POPULAR_CURRENCIES, currencyInfo, searchCurrencies } from "@/lib/money";

// Searchable list of every currency: popular ones first, then A–Z.
// Type "baht", "THB" or "dollar" to narrow it down.
export function CurrencyPicker({
  value,
  recent,
  onPick,
}: {
  value: string;
  recent: string[]; // e.g. the group currency and recently used ones
  onPick: (code: string) => void;
}) {
  const [query, setQuery] = useState("");

  const sections = useMemo(() => {
    if (query.trim()) return [{ title: "Results", items: searchCurrencies(query) }];
    const top = [...new Set([...recent, ...POPULAR_CURRENCIES])];
    return [
      { title: "Popular", items: top.map(currencyInfo) },
      { title: "All currencies", items: searchCurrencies("").filter((c) => !top.includes(c.code)) },
    ];
  }, [query, recent]);

  return (
    <div className="mt-2 rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search currency, e.g. baht or THB"
          autoComplete="off"
          aria-label="Search currencies"
          className="w-full rounded-xl bg-gray-50 px-3 py-2.5 text-base outline-none"
        />
      </div>
      <div className="max-h-72 overflow-y-auto overscroll-contain px-1 pb-2">
        {sections.map((s) => (
          <div key={s.title}>
            <p className="px-3 pb-1 pt-3 text-xs font-medium text-gray-400">{s.title}</p>
            {s.items.length === 0 && <p className="px-3 py-2 text-sm text-gray-500">No currency matches “{query}”.</p>}
            <ul>
              {s.items.map((c) => (
                <li key={c.code}>
                  <button
                    type="button"
                    onClick={() => onPick(c.code)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${
                      c.code === value ? "bg-accent-soft" : "active:bg-gray-50"
                    }`}
                  >
                    <span className="text-lg">{c.flag}</span>
                    <span className="w-11 font-medium">{c.code}</span>
                    <span className="truncate text-gray-500">{c.name}</span>
                    {c.code === value && <span className="ml-auto text-accent">✓</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
