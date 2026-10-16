import { notFound, redirect } from "next/navigation";
import Link from "@/components/Link";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { PageHeader, ErrorNote, secondaryButtonClass } from "@/components/ui";
import { BillForm } from "@/components/BillForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { changeBill, toggleMissedDay } from "@/app/bill-actions";
import { splitNameFor, weightsLabel } from "@/lib/group-types";
import { dailyTotal, missedDays } from "@/lib/home/bills";
import { parseSplit } from "@/lib/home/bills-db";
import { daysInMonth } from "@/lib/home/month";
import { dayKey } from "@/lib/dates";
import { getTimeZone } from "@/lib/tz";
import { formatMoney, toInputAmount } from "@/lib/money";
import { niceDate } from "@/lib/format";

// One bill: its daily calendar (milk), what happened each month, and changes.
export default async function BillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; billId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id, billId } = await params;
  const sp = await searchParams;
  const group = await db.group.findUnique({
    where: { id },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, splitWeight: true, leftAt: true } } },
  });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  const bill = await db.bill.findFirst({ where: { id: billId, groupId: group.id, deletedAt: null }, include: { runs: { orderBy: { period: "desc" }, take: 6 } } });
  if (!bill) notFound();

  const tz = await getTimeZone();
  const today = dayKey(new Date(), tz);
  const month = today.slice(0, 7);
  const money = (n: number) => formatMoney(n, group.currency);
  const active = group.members.filter((m) => !m.leftAt);
  const name = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const missed = missedDays(bill.missed, month);
  const monthAdded = bill.runs.some((r) => r.period === month);
  const split = parseSplit(bill.split);
  const runLabel: Record<string, string> = { added: "Added", waiting: "Waiting for the amount", skipped: "Skipped", adding: "Adding…" };

  return (
    <>
      <PageHeader title={bill.name} back={`/groups/${group.id}?tab=bills`} />
      {sp.error && <ErrorNote>{sp.error.slice(0, 160)}</ErrorNote>}
      {sp.saved && <p className="mb-4 text-sm text-owed">Saved.</p>}
      {bill.paused && <p className="mb-5 rounded-xl bg-mist px-4 py-3 text-sm">Paused. It won’t be added until you start it again.</p>}

      {bill.nature === "daily" && (
        <section id="calendar" className="mb-8 scroll-mt-4 rounded-2xl border border-line bg-white px-4 py-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">{new Date(`${month}-15T12:00:00Z`).toLocaleString("en-IN", { month: "long", timeZone: "UTC" })}</h2>
            <span className="font-display tabular-nums">{money(dailyTotal(bill, month).amount)}</span>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {money(bill.amount)} a day · {daysInMonth(month) - missed.length} of {daysInMonth(month)} days
          </p>
          <div className="mt-3 grid grid-cols-7 gap-1.5">
            {Array.from({ length: daysInMonth(month) }, (_, i) => i + 1).map((d) => {
              const off = missed.includes(d);
              return (
                <form key={d} action={toggleMissedDay}>
                  <input type="hidden" name="groupId" value={group.id} />
                  <input type="hidden" name="billId" value={bill.id} />
                  <input type="hidden" name="period" value={month} />
                  <input type="hidden" name="day" value={d} />
                  <button
                    type="submit"
                    disabled={monthAdded}
                    aria-label={`${d}: ${off ? "didn’t come" : "came"}`}
                    aria-pressed={off}
                    className={`h-9 w-full rounded-lg text-xs tabular-nums ${off ? "border border-dashed border-gray-400 text-gray-500 line-through" : "bg-mist text-fg"}`}
                  >
                    {d}
                  </button>
                </form>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-gray-500">Tap a day it didn’t come. Added as one expense on the last day of the month.</p>
        </section>
      )}

      {bill.runs.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold text-gray-500">So far</h2>
          <ul className="divide-y divide-line border-y border-line text-sm">
            {bill.runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <span>{new Date(`${r.period}-15T12:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
                {r.status === "waiting" ? (
                  <Link href={`/groups/${group.id}/add?bill=${bill.id}&period=${r.period}`} className="font-semibold text-fg underline underline-offset-4">
                    {r.reason === "payer left" ? "Payer left · add it" : "Enter amount"}
                  </Link>
                ) : (
                  <span className="text-gray-500">{runLabel[r.status] ?? r.status}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-8 grid grid-cols-2 gap-2">
        {!bill.paused && (
          <form action={changeBill}>
            <input type="hidden" name="groupId" value={group.id} />
            <input type="hidden" name="billId" value={bill.id} />
            <input type="hidden" name="command" value="skip" />
            <button type="submit" className={secondaryButtonClass}>
              Skip this time
            </button>
          </form>
        )}
        <form action={changeBill}>
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="billId" value={bill.id} />
          <input type="hidden" name="command" value={bill.paused ? "resume" : "pause"} />
          <button type="submit" className={secondaryButtonClass}>
            {bill.paused ? "Start again" : "Pause"}
          </button>
        </form>
      </section>

      <h2 className="mb-4 font-display text-xl font-semibold">Change it</h2>
      <BillForm
        groupId={group.id}
        members={active.map(({ id: mid, name: n }) => ({ id: mid, name: n }))}
        myId={myId}
        splitName={splitNameFor(group.type)}
        splitLabel={weightsLabel(active.map((m) => m.splitWeight))}
        currency={group.currency}
        initial={{
          billId: bill.id,
          template: bill.icon,
          name: bill.name,
          nature: (["fixed", "varies", "daily"] as const).find((n) => n === bill.nature) ?? "fixed",
          amount: bill.amount ? toInputAmount(bill.amount, group.currency) : "",
          day: bill.day,
          payer: bill.payer || "turns",
          split: split.mode,
          ids: split.ids,
        }}
      />

      <form action={changeBill} className="mt-10">
        <input type="hidden" name="groupId" value={group.id} />
        <input type="hidden" name="billId" value={bill.id} />
        <input type="hidden" name="command" value="stop" />
        <ConfirmButton message={`Stop ${bill.name}? Expenses already added stay.`} className="w-full py-3 text-sm font-medium text-red-600">
          Stop this bill
        </ConfirmButton>
      </form>
      <p className="mt-2 text-center text-xs text-gray-400">
        Set up {niceDate(dayKey(bill.createdAt, tz))} by {name(bill.createdById)}.
      </p>
    </>
  );
}
