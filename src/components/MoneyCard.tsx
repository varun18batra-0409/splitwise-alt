import type { ReactNode } from "react";

// The group's money box, drawn from plain values (no data loading, no links of its own). The online MoneyTicket and the offline group
// screen both draw it with this, so the two look the same. Nothing is worked out here.
export function MoneyCard({
  label,
  text,
  tone,
  eq,
  title,
  action,
  line,
  note,
  square,
}: {
  label: string;
  text: string; // the exact amount, paise included ("All square" when there is nothing)
  tone: "owed" | "owe" | "square";
  eq?: string | null; // "≈ $2.40" in the group's second currency
  title?: string; // the amount again, for a tooltip
  action?: ReactNode; // Settle up (online) or its disabled version (offline)
  line?: ReactNode; // the plain line under the amount
  note?: ReactNode; // anything small under it (offline: "As of 2:15 pm, when you were last online")
  square?: boolean;
}) {
  return (
    <section className="mb-5">
      <div className="glass rounded-[26px] px-[18px] py-4" data-group-balance data-ticket={square ? "square" : "one"} data-tone={tone}>
        {/* Wraps: on a narrow phone Settle up drops under the amount instead of touching it. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 max-w-full">
            <p className="text-sm text-fg/65">{label}</p>
            <p className={`money whitespace-nowrap leading-[1.1] ${amountSize(text)} ${tone === "owed" ? "text-owed" : tone === "owe" ? "text-owe" : ""}`} data-net-balance title={title}>
              {text}
            </p>
          </div>
          {action}
        </div>
        {eq && <p className="money text-[15px] text-fg/50">{eq}</p>}
        {line}
        {note}
      </div>
    </section>
  );
}

// The big number shrinks as it gets longer, so it always fits beside Settle up (₹17,618.19 on a small phone).
function amountSize(text: string): string {
  return text.length <= 7 ? "text-[38px]" : text.length <= 9 ? "text-[32px]" : text.length <= 11 ? "text-[27px]" : "text-[23px]";
}
