"use client";

import { useState } from "react";
import { amountEcho } from "@/lib/money";

// A small line under an amount box showing how the typed amount was read
// ("12,50" → "₹12.50"). Nothing is shown for plain digits.
export function AmountEchoLine({ value, currency, className = "" }: { value: string; currency: string; className?: string }) {
  const echo = amountEcho(value, currency);
  return (
    <span className={`block min-h-[1.25rem] text-xs text-fg/60 ${className}`} role="status" aria-live="polite" data-amount-echo={echo ?? ""}>
      {echo ? `Read as ${echo}` : ""}
    </span>
  );
}

// The amount box on Record a payment: the same box as before, with the echo under it.
export function PayAmountField({ currency, defaultValue }: { currency: string; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <>
      <input
        name="amount"
        required
        inputMode="decimal"
        placeholder="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        className="w-full rounded-2xl border border-line bg-mist px-4 py-3.5 text-2xl font-semibold text-fg outline-none placeholder:text-gray-400 focus:border-fg/40 focus:ring-2 focus:ring-fg/10"
      />
      <AmountEchoLine value={value} currency={currency} className="mt-2" />
    </>
  );
}
