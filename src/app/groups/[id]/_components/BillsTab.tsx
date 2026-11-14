import { roundToWhole } from "@/lib/round-whole";
import Link from "@/components/Link";
import type { BillStatus } from "@/lib/home/bills-db";
import { Notice } from "@/components/Notice";
import { billBadge, billHold, ordinalDay, type BillBadge } from "@/lib/home/bills";
import { niceDate } from "@/lib/format";
import { ExpenseGlyph } from "@/components/ExpenseGlyph";
import { CalendarIcon, CheckIcon, ChevronRight, PlusIcon } from "@/components/icons";
import { primaryButtonClass } from "@/components/ui";
import type { GroupView } from "./view";

// Bill state chips are plain status words: a hairline outline, never a coloured fill (colour is for amounts only).
// "Done" ones get a small drawn tick; the ones that need someone read at full strength, the rest a little quieter.
const CHIP: Record<BillBadge["tone"], string> = {
  orange: "border-fg/40 text-fg",
  gold: "border-fg/40 text-fg",
  green: "border-fg/25 text-fg/75",
  grey: "border-fg/15 text-fg/55",
};
const chipBase = "inline-flex shrink-0 items-center gap-1 rounded-full border bg-transparent px-2.5 py-0.5 text-[12px] font-medium";

// "21 Nov" (the year only when it isn't this year).
const shortDate = (iso: string) => {
  const t = niceDate(iso);
  return t.endsWith(` ${new Date().getFullYear()}`) ? t.slice(0, -5) : t;
};

// Bills: everything that comes round every month, set up once.
// `forecast`: next month's estimate from monthInsights, the one function This month uses too (so both screens show the same number).
export function BillsTab({ v, bills, saved, forecast }: { v: GroupView; bills: BillStatus[]; saved?: boolean; forecast: { total: number; mine: number } | null }) {
  const { group, myId, money, nameOf } = v;

  const row = (b: BillStatus) => {
    const payer = b.payerId ?? (b.bill.payer || null);
    const who = payer === myId ? "you pay" : payer ? `${nameOf(payer)} pays` : "taking turns";
    const turns = !b.bill.payer && payer ? " (turns)" : "";
    const hold = billHold({ nature: b.bill.nature, reason: b.reason, payerId: b.payerId });
    const badge = billBadge({ nature: b.bill.nature, status: b.status, due: b.due, payerId: b.payerId, reason: b.reason, recordedThisMonth: b.recordedThisMonth, tz: b.bill.tz, now: new Date() });
    const cadence = b.bill.nature === "daily" ? "Daily" : b.bill.every > 1 ? `Every ${b.bill.every} months` : "Monthly";
    // The status line: the bill's own state if it has one, else "Review days" (daily) or when it is next due.
    const status = badge ? badge.label : b.bill.nature === "daily" ? "Review days" : b.due ? `Due ${shortDate(b.due)}` : "";
    const tone = badge ? CHIP[badge.tone] : "border-fg/15 text-fg/55";
    return (
      <li key={b.bill.id} className="flex items-center gap-3 rounded-[20px] border border-line bg-white p-3.5">
        <Link href={`/groups/${group.id}/bills/${b.bill.id}`} className="flex min-w-0 flex-1 items-center gap-3">
          <ExpenseGlyph title={b.bill.name} category="bills" size={44} />
          <span className="min-w-0 flex-1">
            <span className="block break-words font-display text-[17px] font-semibold leading-tight tracking-tight">{b.bill.name}</span>
            <span className="block text-[13px] text-fg/60">
              {cadence}{b.bill.nature === "daily" ? "" : ` · ${ordinalDay(b.bill.day).replace(/^last day$/, "Last day")}`} · {who}
              {turns}
              {b.bill.nature === "varies" && b.usual ? ` · usually ${money(b.usual)}` : ""}
            </span>
            {b.status === "waiting" && hold === "fix" && b.reason && <span className="block text-xs text-fg/75">On hold: {b.reason}</span>}
          </span>
        </Link>
        <span className="flex shrink-0 flex-col items-end gap-1.5 text-right">
          {b.status === "waiting" ? (
            <Link
              href={hold === "fix" ? `/groups/${group.id}/bills/${b.bill.id}` : `/groups/${group.id}/add?bill=${b.bill.id}&period=${b.period}`}
              className="inline-flex min-h-9 items-center rounded-full border border-fg/25 px-3.5 text-sm font-semibold text-fg active:bg-fg/10"
            >
              {hold === "payer" || hold === "add" ? "Add it" : hold === "fix" ? "Fix it" : "Enter amount"}
            </Link>
          ) : (
            b.bill.nature !== "varies" && <span className="money tabular-nums">{b.bill.nature === "daily" ? `${money(b.bill.amount)} a day` : money(b.bill.amount)}</span>
          )}
          {status && (
            <span className={`${chipBase} ${tone}`} data-bill-state={badge?.id}>
              {badge?.id === "recorded" && <CheckIcon size={12} />}
              {status}
            </span>
          )}
        </span>
        <ChevronRight size={16} className="shrink-0 text-fg/55" />
      </li>
    );
  };

  const fixed = bills.filter((b) => b.bill.nature === "fixed");
  const varies = bills.filter((b) => b.bill.nature === "varies");
  const daily = bills.filter((b) => b.bill.nature === "daily");

  const sections = [...fixed, ...varies, ...daily];
  const firstDaily = daily[0];

  return (
    <div>
      {saved && <Notice tone="success" params={["saved"]} className="mb-4">Bill saved. Everyone in the group has been told.</Notice>}
      <div>
        <p className="text-sm text-fg/60">Next month, about</p>
        <p className="money text-[28px] font-semibold tabular-nums" data-bills-estimate={forecast ? forecast.total : 0}>{money(forecast ? roundToWhole(forecast.total, group.currency) : 0)}</p>
        {forecast && <p className="text-sm text-fg/60">Your share {money(roundToWhole(forecast.mine, group.currency))}</p>}
      </div>

      {bills.length === 0 && (
        <div className="mt-8 rounded-2xl border border-line bg-white px-5 py-6 text-sm leading-relaxed text-gray-600">
          <p className="font-semibold text-fg">Rent, Wi-Fi, the cook, milk…</p>
          <p className="mt-1">Set each one to repeat once. Loopin adds fixed bills on the day, asks whoever pays for ones that change, and adds up daily ones at month end.</p>
        </div>
      )}

      {sections.length > 0 && <ul className="mt-5 flex flex-col gap-2.5">{sections.map(row)}</ul>}

      {firstDaily && (
        <div className="mt-5 flex items-start gap-3.5 rounded-[20px] border border-line bg-white p-4">
          <span className="mt-0.5 text-fg/75">
            <CalendarIcon size={24} />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-fg">Daily bills follow the days you include.</p>
            <p className="mt-1 leading-relaxed text-fg/60">Milk, tiffin or groceries: tick the days they came, and Loopin adds them up at month end.</p>
            <Link href={`/groups/${group.id}/bills/${firstDaily.bill.id}#calendar`} className="mt-2 inline-flex min-h-11 items-center font-medium text-fg">
              View daily calendar<span aria-hidden> ›</span>
            </Link>
          </div>
        </div>
      )}

      {bills.length > 0 && (
        <p className="mt-6 text-xs leading-relaxed text-gray-500">
          Same each time ones repeat on the day; ones that change are entered by whoever pays. Tap a bill to change it, skip a month, or stop it. Everyone is told when a bill is added, and anyone can undo it.
        </p>
      )}

      {!group.closed && (
        <Link href={`/groups/${group.id}/bills/new`} className={`${primaryButtonClass} mt-6`}>
          <PlusIcon size={18} className="mr-2 inline-block align-[-3px]" />
          Add a bill
        </Link>
      )}
    </div>
  );
}
