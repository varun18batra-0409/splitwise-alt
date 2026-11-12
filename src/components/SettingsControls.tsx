"use client";

import { useState } from "react";
import { POPULAR_CURRENCIES, currencyInfo } from "@/lib/money";
import { CurrencyPicker } from "./CurrencyPicker";

// Matching chip controls for Settings (instead of the phone's own dropdowns).
// Each keeps a real form field with the same name, so the one Save sends it.

const chip =
  "flex min-h-11 items-center justify-center rounded-xl border border-line px-3 py-2 text-center text-sm font-medium has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-dark";

export function ChipRadios({
  name,
  options,
  defaultValue,
  label,
  onChange,
  cols = "grid-cols-2",
}: {
  name: string;
  options: { value: string; label: string }[];
  defaultValue: string;
  label: string;
  onChange?: (v: string) => void;
  cols?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`grid gap-2 ${cols}`}>
      {options.map((o) => (
        <label key={o.value} className={chip}>
          <input type="radio" name={name} value={o.value} defaultChecked={o.value === defaultValue} onChange={() => onChange?.(o.value)} className="sr-only" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

// Group type chips, with the chosen type's hint underneath.
export function GroupTypeChips({ types, defaultValue }: { types: { id: string; label: string; hint: string }[]; defaultValue: string }) {
  const [v, setV] = useState(defaultValue);
  return (
    <>
      <ChipRadios name="type" label="Group type" defaultValue={defaultValue} onChange={setV} options={types.map((t) => ({ value: t.id, label: t.label }))} cols="grid-cols-2 min-[400px]:grid-cols-3" />
      <span className="mt-1.5 block text-xs text-gray-500">{types.find((t) => t.id === v)?.hint}</span>
    </>
  );
}

// "Also show amounts in": Automatic / Off / a few popular ones / any other from the search list.
export function SecondCurrencyChips({ groupCurrency, defaultValue }: { groupCurrency: string; defaultValue: string }) {
  const [v, setV] = useState(defaultValue);
  const [more, setMore] = useState(false);
  const popular = POPULAR_CURRENCIES.filter((c) => c !== groupCurrency).slice(0, 4);
  const listed = ["", "none", ...popular];
  const extra = listed.includes(v) ? null : v; // a saved currency not among the chips
  const pick = (code: string) => {
    setV(code);
    setMore(false);
  };
  const options = [
    { value: "", label: "Automatic" },
    { value: "none", label: "Off" },
    ...popular.map((c) => ({ value: c, label: `${currencyInfo(c).flag} ${c}` })),
    ...(extra ? [{ value: extra, label: `${currencyInfo(extra).flag} ${extra}` }] : []),
  ];
  return (
    <div>
      <input type="hidden" name="secondaryCurrency" value={v} />
      <div role="radiogroup" aria-label="Also show amounts in" className="grid grid-cols-3 gap-2">
        {options.map((o) => (
          <button
            key={o.value || "auto"}
            type="button"
            role="radio"
            aria-checked={v === o.value}
            onClick={() => pick(o.value)}
            className={`${chip} ${v === o.value ? "border-accent bg-accent-soft text-accent-dark" : ""}`}
          >
            {o.label}
          </button>
        ))}
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className={chip}>
          Other…
        </button>
      </div>
      {more && <CurrencyPicker value={v} recent={[groupCurrency]} onPick={pick} />}
    </div>
  );
}
