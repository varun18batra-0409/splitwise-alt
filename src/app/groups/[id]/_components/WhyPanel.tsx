import { explainBalance } from "@/lib/explain";
import { getCategory } from "@/lib/categories";
import { dayLabel } from "@/lib/activity";
import type { GroupView } from "./view";

// "Why?" under a person's balance: the totals that make it up, then every
// expense and payment behind it. Always adds up to the balance shown.
export function WhyPanel({ v, memberId, open }: { v: GroupView; memberId: string; open?: boolean }) {
  const { expenses, payments, money, myId, tz } = v;
  const isMe = memberId === myId;
  const name = (id: string) => (id === memberId ? (isMe ? "you" : "them") : id === myId ? "you" : v.nameOf(id));
  const w = explainBalance(memberId, expenses, payments, name);
  if (w.lines.length === 0) return null;
  const sign = (n: number) => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : money(0));
  const who = isMe ? "You" : v.nameOf(memberId);
  const now = new Date();

  const rows: [string, number, string?][] = [
    [`${who} paid for the group`, w.paidTotal],
    [`${isMe ? "Your" : "Their"} share of expenses`, -w.shareTotal, w.feeTotal > 0 ? `incl. ${money(w.feeTotal)} card fees` : undefined],
    ...(w.sent ? ([[`Payments ${isMe ? "you" : "they"} made`, w.sent]] as [string, number][]) : []),
    ...(w.received ? ([[`Payments ${isMe ? "you" : "they"} got`, -w.received]] as [string, number][]) : []),
  ];

  return (
    <details className="group/why border border-line bg-white" open={open} id={`why-${memberId}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        Why?
        <span className="text-gray-400 group-open/why:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-line px-3 pb-3 pt-2 text-sm">
        <ul className="space-y-1">
          {rows.map(([label, n, note]) => (
            <li key={label} className="flex justify-between gap-3">
              <span className="text-gray-600">
                {label}
                {note && <span className="block text-xs text-gray-400">{note}</span>}
              </span>
              <span className="shrink-0 tabular-nums">{sign(n)}</span>
            </li>
          ))}
          <li className="flex justify-between gap-3 border-t border-line pt-1 font-medium">
            <span>{w.balance > 0 ? `${who} ${isMe ? "get" : "gets"} back` : w.balance < 0 ? `${who} ${isMe ? "owe" : "owes"}` : "Settled"}</span>
            <span className={`shrink-0 tabular-nums ${w.balance > 0 ? "text-owed" : w.balance < 0 ? "text-owe" : ""}`}>{money(Math.abs(w.balance))}</span>
          </li>
        </ul>

        <p className="mb-1 mt-4 text-xs text-gray-400">Item by item</p>
        <ul className="divide-y divide-line">
          {w.lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="block truncate">
                  {l.kind === "expense" ? `${getCategory(l.category ?? "").emoji} ${l.label}` : `↔ ${l.label.replace(/ them$/, isMe ? " you" : ` ${v.nameOf(memberId)}`)}`}
                </span>
                <span className="block truncate text-xs text-gray-400">
                  {dayLabel(l.date, now, tz)}
                  {l.kind === "expense" && (l.paid ? ` · paid ${money(l.paid)}` : "")}
                  {l.kind === "expense" && l.share ? ` · share ${money(l.share)}` : ""}
                  {l.fee ? ` (fee ${money(l.fee)})` : ""}
                </span>
              </span>
              <span className={`shrink-0 tabular-nums ${l.effect > 0 ? "text-owed" : l.effect < 0 ? "text-owe" : "text-gray-400"}`}>{sign(l.effect)}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
