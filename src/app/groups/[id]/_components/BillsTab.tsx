import Link from "@/components/Link";
import type { BillStatus } from "@/lib/home/bills-db";
import { parseSplit } from "@/lib/home/bills-db";
import { ordinalDay } from "@/lib/home/bills";
import { niceDate } from "@/lib/format";
import type { GroupView } from "./view";

const h3 = "mb-1 mt-7 text-sm font-semibold text-gray-500";

// Bills: everything that comes round every month, set up once.
export function BillsTab({ v, bills, saved }: { v: GroupView; bills: BillStatus[]; saved?: boolean }) {
  const { group, myId, money, nameOf } = v;
  const active = group.members.filter((m) => !m.leftAt);

  // My part of one month of a bill (the usual amount for ones that vary).
  const monthly = (b: BillStatus) => {
    const amt = b.bill.nature === "daily" ? b.bill.amount * 30 : b.bill.nature === "varies" ? (b.usual ?? b.bill.amount) : b.bill.amount;
    return Math.round(amt / Math.max(1, b.bill.every));
  };
  const myPart = (b: BillStatus) => {
    const split = parseSplit(b.bill.split);
    const people = split.mode === "some" ? active.filter((m) => split.ids.includes(m.id)) : active;
    if (!people.some((m) => m.id === myId)) return 0;
    const w = (id: string) => (split.mode === "group" ? (people.find((m) => m.id === id)?.splitWeight ?? 100) : 100);
    const total = people.reduce((s, m) => s + w(m.id), 0);
    return total ? Math.round((monthly(b) * w(myId)) / total) : 0;
  };
  const live = bills.filter((b) => b.status !== "paused");
  const total = live.reduce((s, b) => s + monthly(b), 0);
  const mine = live.reduce((s, b) => s + myPart(b), 0);

  const row = (b: BillStatus) => {
    const payer = b.payerId ?? (b.bill.payer || null);
    const who = payer === myId ? "you pay" : payer ? `${nameOf(payer)} pays` : "taking turns";
    const turns = !b.bill.payer && payer ? " (turns)" : "";
    const when =
      b.status === "paused"
        ? "Paused"
        : b.bill.nature === "daily"
          ? `${money(b.bill.amount)} a day`
          : `${ordinalDay(b.bill.day).replace(/^last day$/, "Last day")}${b.bill.every > 1 ? `, every ${b.bill.every} months` : ""}`;
    return (
      <li key={b.bill.id} className="flex items-center gap-3 py-3">
        <Link href={`/groups/${group.id}/bills/${b.bill.id}`} className="min-w-0 flex-1">
          <span className="block font-medium">{b.bill.name}</span>
          <span className="block truncate text-xs text-gray-500">
            {when} · {who}
            {turns}
            {b.bill.nature === "varies" && b.usual ? ` · usually ${money(b.usual)}` : ""}
          </span>
        </Link>
        {b.status === "waiting" ? (
          <Link href={`/groups/${group.id}/add?bill=${b.bill.id}&period=${b.period}`} className="shrink-0 border border-gray-300 px-3 py-2 text-sm font-semibold text-fg active:bg-mist">
            {b.reason === "payer left" ? "Add it" : "Enter amount"}
          </Link>
        ) : (
          <span className="shrink-0 text-right">
            {b.bill.nature !== "varies" && <span className="block font-display tabular-nums">{money(b.bill.amount)}</span>}
            {b.due && <span className="block text-[11px] text-gray-500">{niceDate(b.due)}</span>}
          </span>
        )}
      </li>
    );
  };

  const fixed = bills.filter((b) => b.bill.nature === "fixed");
  const varies = bills.filter((b) => b.bill.nature === "varies");
  const daily = bills.filter((b) => b.bill.nature === "daily");

  return (
    <div>
      {saved && <p className="mb-4 rounded-xl bg-owed/10 px-4 py-3 text-sm text-owed">Bill saved. Everyone in the group has been told.</p>}
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">Regular bills, every month</p>
          <p className="font-display text-[30px] font-semibold tabular-nums">{money(total)}</p>
          {total > 0 && <p className="text-sm text-gray-500">Your share about {money(mine)}</p>}
        </div>
        {!group.closed && (
          <Link href={`/groups/${group.id}/bills/new`} className="pop shrink-0 bg-fg px-4 py-2.5 text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
            Add a bill
          </Link>
        )}
      </div>

      {bills.length === 0 && (
        <div className="mt-8 rounded-2xl bg-mist px-5 py-6 text-sm leading-relaxed text-gray-600">
          <p className="font-semibold text-fg">Rent, Wi-Fi, the cook, milk…</p>
          <p className="mt-1">Set each one up once. Fixed bills add themselves on the day, ones that change ask whoever pays for the amount, and daily ones are added up at month end.</p>
        </div>
      )}

      {fixed.length > 0 && (
        <>
          <h3 className={h3}>Adds itself on the day</h3>
          <ul className="divide-y divide-line border-y border-line">{fixed.map(row)}</ul>
        </>
      )}
      {varies.length > 0 && (
        <>
          <h3 className={h3}>Changes each time · the payer enters it</h3>
          <ul className="divide-y divide-line border-y border-line">{varies.map(row)}</ul>
        </>
      )}
      {daily.length > 0 && (
        <>
          <h3 className={h3}>Daily · added up at month end</h3>
          <ul className="divide-y divide-line border-y border-line">{daily.map(row)}</ul>
        </>
      )}
      {bills.length > 0 && (
        <p className="mt-6 text-xs leading-relaxed text-gray-500">
          Tap a bill to change it, skip a month, or stop it. Everyone is told when a bill is added, and anyone can undo it.
        </p>
      )}
    </div>
  );
}
