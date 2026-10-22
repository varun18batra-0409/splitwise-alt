import { getCategory } from "@/lib/categories";
import { ExpenseGlyph } from "./ExpenseGlyph";
import { formatMoney } from "@/lib/money";
import type { ActivityItem } from "@/lib/activity";
import { GearIcon, SettleIcon } from "./icons";

// Right-hand side: what it meant for you. The amount first (bold), what it is
// underneath; rows that weren't yours stay quiet.
function Effect({ label, amount, sub, cls }: { label: string; amount?: string; sub?: string; cls: string }) {
  if (!amount) return <span className="shrink-0 text-right text-[12px] leading-tight text-fg/35">{label}</span>;
  return (
    <span className="shrink-0 text-right leading-tight">
      <span className={`block text-[15px] font-semibold tabular-nums tracking-tight ${cls}`}>{amount}</span>
      <span className="mt-0.5 block text-[11px] text-fg/40">
        {label}
        {sub && <span className="tabular-nums"> · {sub}</span>}
      </span>
    </span>
  );
}

const meta = "mt-0.5 truncate text-[13px] text-fg/45";

// One line of history: an expense, a settle-up payment or a group change,
// and what it meant for you. Deleted items stay visible, crossed out.
export function ActivityRow({
  item,
  currency,
  nameOf,
  groupName,
  alive = false,
}: {
  item: ActivityItem;
  currency: string;
  nameOf: (id: string) => string; // returns "You" for me
  groupName?: string; // shown on the home screen, where groups are mixed
  alive?: boolean; // Home: the icon moves a little (a flight flies)
}) {
  const money = (m: number) => formatMoney(m, currency);

  if (item.kind === "event") {
    return (
      <div className="flex items-center gap-3 py-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center text-gray-400">
          <GearIcon size={18} />
        </span>
        <p className="min-w-0 flex-1 text-sm text-gray-500">
          <span className="font-medium text-ink">{nameOf(item.actorId)}</span> {item.text}
          {groupName && <span className="text-gray-400"> · {groupName}</span>}
        </p>
      </div>
    );
  }

  const deleted = item.deletedById !== null;
  const deletedNote = deleted ? `Deleted by ${item.deletedById ? nameOf(item.deletedById) : "someone"}` : "";

  if (item.kind === "payment") {
    const to = nameOf(item.toId);
    return (
      <div className={`flex items-center gap-3.5 py-3.5 ${deleted ? "opacity-60" : ""}`}>
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-owed/[0.12] text-owed ring-1 ring-inset ring-owed/15">
          <SettleIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-[15px] font-semibold tracking-tight ${deleted ? "line-through decoration-gray-400" : ""}`}>
            {nameOf(item.fromId)} paid {to === "You" ? "you" : to}
          </p>
          <p className={meta}>
            {deleted ? deletedNote : "Settle-up"} · {money(item.amount)}
            {groupName && ` · ${groupName}`}
          </p>
        </div>
        {deleted ? (
          <Effect label="deleted" cls="" />
        ) : item.effect > 0 ? (
          <Effect label="you paid" amount={money(item.effect)} cls="text-fg" />
        ) : item.effect < 0 ? (
          <Effect label="you received" amount={money(-item.effect)} cls="text-fg" />
        ) : (
          <Effect label="not involved" cls="" />
        )}
      </div>
    );
  }

  const cat = getCategory(item.category);
  // Foreign-currency expense: show the amount in its own currency first, then the group currency.
  const o = item.original;
  const shown = (orig: number, base: number) => (o ? formatMoney(orig, o.currency) : money(base));
  return (
    <div className={`flex items-center gap-3.5 py-3.5 ${deleted ? "opacity-60" : ""}`}>
      <ExpenseGlyph title={item.title} category={item.category} alive={alive && !deleted} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5" title={cat.label}>
          <span className={`truncate text-[15px] font-semibold tracking-tight ${deleted ? "line-through decoration-gray-400" : ""}`}>{item.title}</span>
          {item.refund && <span className="shrink-0 rounded-md bg-owed/[0.14] px-1.5 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-wide text-owed">Back</span>}
          {item.notes && (
            <svg aria-label="Has notes" role="img" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg/35">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8" />
            </svg>
          )}
        </p>
        <p className={meta}>
          {deleted
            ? `${deletedNote} · ${shown(o?.amount ?? 0, item.amount)}`
            : `${(item.payerIds ?? [item.paidById]).map(nameOf).join(" + ")} ${item.refund ? "got back" : "paid"} ${shown(o?.amount ?? 0, item.amount)}`}
          {item.edited && !deleted && " · edited"}
          {groupName && ` · ${groupName}`}
        </p>
      </div>
      {deleted ? (
        <Effect label="deleted" cls="" />
      ) : item.effect > 0 ? (
        <Effect label="you lent" amount={money(item.effect)} sub={o ? formatMoney(o.effect, o.currency) : undefined} cls="text-owed" />
      ) : item.effect < 0 ? (
        <Effect label="you owe" amount={money(-item.effect)} sub={o ? formatMoney(-o.effect, o.currency) : undefined} cls="text-owe" />
      ) : (
        // Zero for you: either it wasn't yours at all, or you paid exactly your own part.
        <Effect
          label={[...(item.payerIds ?? [item.paidById]), ...item.people].some((id) => nameOf(id) === "You") ? "your own" : "not involved"}
          cls=""
        />
      )}
    </div>
  );
}
