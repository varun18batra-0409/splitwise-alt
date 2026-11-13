"use client";

import { BASE_CURRENCIES, CURRENCIES, currencyInfo } from "@/lib/money";
import { inputClass } from "./ui";

// Dropdown of every currency, with the common group currencies first.
// Used when creating a group and in group settings.
export function CurrencySelect({ name, defaultValue, disabled, label = "Currency", onChange }: { name: string; defaultValue: string; disabled?: boolean; label?: string; onChange?: (code: string) => void }) {
  return (
    <select name={name} defaultValue={defaultValue} disabled={disabled} onChange={onChange ? (e) => onChange(e.target.value) : undefined} aria-label={label} className={`${inputClass} disabled:bg-gray-50 disabled:text-gray-500`}>
      <optgroup label="Common">
        {BASE_CURRENCIES.map((code) => {
          const c = currencyInfo(code);
          return (
            <option key={code} value={code}>
              {code} — {c.name}
            </option>
          );
        })}
      </optgroup>
      <optgroup label="All currencies">
        {CURRENCIES.filter((c) => !BASE_CURRENCIES.includes(c.code)).map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} — {c.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
