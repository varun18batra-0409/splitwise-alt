import { BASE_CURRENCIES, CURRENCIES, currencyInfo } from "@/lib/money";
import { inputClass } from "./ui";

// Dropdown of every currency, with the common group currencies first.
// Used when creating a group and in group settings.
export function CurrencySelect({ name, defaultValue, disabled }: { name: string; defaultValue: string; disabled?: boolean }) {
  return (
    <select name={name} defaultValue={defaultValue} disabled={disabled} className={`${inputClass} disabled:bg-gray-50 disabled:text-gray-500`}>
      <optgroup label="Common">
        {BASE_CURRENCIES.map((code) => {
          const c = currencyInfo(code);
          return (
            <option key={code} value={code}>
              {c.flag} {code} — {c.name}
            </option>
          );
        })}
      </optgroup>
      <optgroup label="All currencies">
        {CURRENCIES.filter((c) => !BASE_CURRENCIES.includes(c.code)).map((c) => (
          <option key={c.code} value={c.code}>
            {c.flag} {c.code} — {c.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
