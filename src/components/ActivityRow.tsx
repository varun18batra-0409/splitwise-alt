import { getCategory } from "@/lib/categories";
import { formatMoney } from "@/lib/money";
import type { ActivityItem } from "@/lib/activity";
import { GearIcon, SettleIcon } from "./icons";

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
  const effect = deleted
    ? { text: "deleted", cls: "text-gray-400" }
    : item.effect > 0
      ? { text: item.kind === "payment" ? `you paid ${money(item.effect)}` : `you lent ${money(item.effect)}`, cls: "text-owed" }
      : item.effect < 0
        ? { text: item.kind === "payment" ? `you got ${money(-item.effect)}` : `you owe ${money(-item.effect)}`, cls: "text-owe" }
        : { text: "not involved", cls: "text-gray-400" };
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
        <span className={`shrink-0 text-right text-sm ${effect.cls}`}>{effect.text}</span>
      </div>
    );
  }

  const cat = getCategory(item.category);
  return (
    <div className={`flex items-center gap-3 py-3 ${deleted ? "opacity-60" : ""}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mist text-xl" title={cat.label}>
        {cat.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5">
          <span className={`truncate font-medium ${deleted ? "line-through decoration-gray-400" : ""}`}>{item.title}</span>
          {item.edited && !deleted && <span className="shrink-0 rounded-full bg-mist px-1.5 py-0.5 text-[10px] text-gray-500">edited</span>}
        </p>
        <p className="truncate text-sm text-gray-400">
          {deleted ? `${deletedNote} · ${money(item.amount)}` : `${nameOf(item.paidById)} paid ${money(item.amount)}`}
          {groupName && ` · ${groupName}`}
        </p>
      </div>
      <span className={`shrink-0 text-right text-sm ${effect.cls}`}>{effect.text}</span>
    </div>
  );
}
