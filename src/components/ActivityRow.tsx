import { getCategory } from "@/lib/categories";
import { formatMoney } from "@/lib/money";
import type { ActivityItem } from "@/lib/activity";
import { GearIcon, SettleIcon } from "./icons";

// Right-hand side: a small label over the amount, so names get the room.
function Effect({ label, amount, sub, cls }: { label: string; amount?: string; sub?: string; cls: string }) {
  return (
    <span className="shrink-0 text-right leading-tight">
      <span className="block text-[11px] text-gray-400">{label}</span>
      {amount && <span className={`block text-sm font-medium tabular-nums ${cls}`}>{amount}</span>}
      {sub && <span className="block text-[11px] tabular-nums text-gray-400">{sub}</span>}
    </span>
  );
}

// One line of history: an expense, a settle-up payment or a group change,
// and what it meant for you. Deleted items stay visible, crossed out.
export function ActivityRow({
  item,
  currency,
  nameOf,
  groupName,
}: {
  item: ActivityItem;
  currency: string;
  nameOf: (id: string) => string; // returns "You" for me
  groupName?: string; // shown on the home screen, where groups are mixed
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
      <div className={`flex items-center gap-3 py-3 ${deleted ? "opacity-60" : ""}`}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mist text-gray-700">
          <SettleIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`truncate font-medium ${deleted ? "line-through decoration-gray-400" : ""}`}>
            {nameOf(item.fromId)} paid {to === "You" ? "you" : to}
          </p>
          <p className="truncate text-sm text-gray-400">
            {deleted ? deletedNote : "Settle-up"} · {money(item.amount)}
            {groupName && ` · ${groupName}`}
          </p>
        </div>
        {deleted ? (
          <Effect label="deleted" cls="" />
        ) : item.effect > 0 ? (
          <Effect label="you paid" amount={money(item.effect)} cls="text-ink" />
        ) : item.effect < 0 ? (
          <Effect label="you received" amount={money(-item.effect)} cls="text-ink" />
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
    <div className={`flex items-center gap-3 py-3 ${deleted ? "opacity-60" : ""}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mist text-xl" title={cat.label}>
        {cat.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5">
          <span className={`truncate font-medium ${deleted ? "line-through decoration-gray-400" : ""}`}>{item.title}</span>
          <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] leading-none text-gray-500">{cat.short}</span>
          {item.edited && !deleted && <span className="shrink-0 rounded-full bg-mist px-1.5 py-0.5 text-[10px] text-gray-500">edited</span>}
          {item.notes && <span className="shrink-0 text-[11px] leading-none" title="Has notes" aria-label="Has notes">📝</span>}
        </p>
        <p className="truncate text-sm text-gray-400">
          {deleted
            ? `${deletedNote} · ${shown(o?.amount ?? 0, item.amount)}`
            : `${nameOf(item.paidById)} paid ${shown(o?.amount ?? 0, item.amount)}`}
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
        <Effect label="not involved" cls="" />
      )}
    </div>
  );
}
