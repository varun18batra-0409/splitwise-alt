import Link from "next/link";
import { formatMoney } from "@/lib/money";

// A balance meter: one track per row with zero in the middle.
// Bars grow right (owed to you, green) or left (you owe, amber), scaled against
// the largest balance in the same currency. The amount and words are always
// printed too, so colour is never the only cue.

export type MeterRow = { key: string; label: string; sublabel?: string; value: number; currency: string; href?: string };

export function BalanceMeter({ rows, tone = "light" }: { rows: MeterRow[]; tone?: "light" | "dark" }) {
  const maxByCurrency = new Map<string, number>();
  for (const r of rows) maxByCurrency.set(r.currency, Math.max(maxByCurrency.get(r.currency) ?? 0, Math.abs(r.value)));

  const dark = tone === "dark";
  const up = "bg-meter-up";
  const down = "bg-meter-down";
  const track = dark ? "bg-fg/[0.06]" : "bg-mist";
  const zero = dark ? "bg-fg/30" : "bg-gray-300";
  const labelInk = "text-fg";
  const subInk = dark ? "text-fg/50" : "text-gray-400";

  return (
    <ul className="space-y-4">
      {rows.map((r, i) => {
        const max = maxByCurrency.get(r.currency) || 1;
        const pct = r.value === 0 ? 0 : Math.max(4, Math.round((Math.abs(r.value) / max) * 50)); // half-track = 50%
        const valueText =
          r.value > 0 ? `+${formatMoney(r.value, r.currency)}` : r.value < 0 ? `−${formatMoney(-r.value, r.currency)}` : "Settled";
        const words = r.value > 0 ? "owed to you" : r.value < 0 ? "you owe" : "";
        const valueInk =
          r.value > 0 ? "text-accent-dark" : r.value < 0 ? "text-owe" : subInk;

        const body = (
          <>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className={`min-w-0 truncate text-sm font-medium ${labelInk}`}>
                {r.label}
                {r.sublabel && <span className={`ml-1.5 font-normal ${subInk}`}>{r.sublabel}</span>}
              </span>
              <span className={`shrink-0 font-display text-sm tabular-nums ${valueInk}`}>
                {valueText}
                {words && <span className={`ml-1 font-sans text-xs ${subInk}`}>{words}</span>}
              </span>
            </div>
            <div className={`relative h-2 rounded-full ${track}`} role="img" aria-label={`${r.label}: ${valueText} ${words}`}>
              <span className={`absolute left-1/2 top-[-3px] h-[14px] w-px ${zero}`} />
              {r.value > 0 && (
                <span
                  className={`meter-bar absolute left-1/2 top-0 h-2 origin-left rounded-r-full ${up}`}
                  style={{ width: `${pct}%`, animationDelay: `${i * 70}ms` }}
                />
              )}
              {r.value < 0 && (
                <span
                  className={`meter-bar absolute right-1/2 top-0 h-2 origin-right rounded-l-full ${down}`}
                  style={{ width: `${pct}%`, animationDelay: `${i * 70}ms` }}
                />
              )}
            </div>
          </>
        );

        return (
          <li key={r.key}>
            {r.href ? (
              <Link href={r.href} className="-mx-2 block rounded-xl px-2 py-1 active:bg-fg/5">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
