import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass } from "@/components/ui";
import { moveOutAction } from "@/app/bill-actions";
import { moveOutPreview } from "@/lib/home/moving-db";
import { formatMoney } from "@/lib/money";
import { niceDate } from "@/lib/format";
import { dayKey } from "@/lib/dates";
import { getTimeZone } from "@/lib/tz";
import { FreshKey } from "@/components/FreshKey";
import { addMonths } from "@/lib/home/month";
import { leaverOf } from "@/lib/left-view-db";

const monthLabel = (period: string) => new Date(`${period}-15T12:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });

// Someone moving out of the flat: their share for the days they stayed, their
// deposit, and the exact final payments — then they're marked as moved out.
export default async function MoveOutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; memberId: string }>;
  searchParams: Promise<{ day?: string; error?: string }>;
}) {
  const { id, memberId } = await params;
  const sp = await searchParams;
  const group = await db.group.findUnique({ where: { id }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  // Someone who left (or was removed) reads the group only on its main screen, up to the day they left.
  if (await leaverOf(myId)) redirect(`/groups/${group.id}`);
  const leaver = group.members.find((m) => m.id === memberId && !m.leftAt);
  if (!leaver) notFound();

  const tz = await getTimeZone();
  const today = dayKey(new Date(), tz);
  const lastDay = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? sp.day! : today;
  const p = await moveOutPreview(group.id, leaver.id, lastDay, new Date(), myId);
  const money = (n: number) => formatMoney(n, group.currency);
  const name = (mid: string) => (mid === myId ? "you" : group.members.find((m) => m.id === mid)?.name ?? "someone");
  const Name = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const others = group.members.filter((m) => !m.leftAt && m.id !== leaver.id);
  const payList = (list: { from: string; to: string; amount: number }[]) =>
    list.length === 0 ? (
      <p className="text-sm text-gray-500">
        Nothing to pay: {name(leaver.id)} {leaver.id === myId ? "are" : "is"} square.
      </p>
    ) : (
      <ul className="space-y-2">
        {list.map((t) => (
          <li key={`${t.from}-${t.to}`} className="flex items-center justify-between border border-line px-4 py-3 text-sm rounded-2xl">
            <span>
              <strong className="font-semibold">{Name(t.from)}</strong> <span className="text-gray-500">{t.from === myId ? "pay" : "pays"}</span>{" "}
              <strong className="font-semibold">{name(t.to)}</strong>
            </span>
            <span className={`money text-[17px] tabular-nums ${t.to === myId ? "text-owed" : t.from === myId ? "text-owe" : ""}`}>{money(t.amount)}</span>
          </li>
        ))}
      </ul>
    );
  const title = leaver.id === myId ? "You’re moving out" : `${leaver.name} is moving out`;

  return (
    <>
      <PageHeader title={title} back={`/groups/${group.id}/people`} />
      {sp.error && <ErrorNote>{sp.error.slice(0, 160)}</ErrorNote>}

      {/* Changing the day reloads the numbers below. */}
      <form method="get" className="mb-7 flex items-end gap-2 border-y border-line py-3.5" data-allow-repeat="1">
        <label className="flex-1">
          <span className="block text-sm text-gray-500">Last day in the flat</span>
          <input type="date" name="day" defaultValue={lastDay} max={today} min={`${addMonths(today.slice(0, 7), -1)}-01`} className={`${inputClass} mt-1 py-2`} />
        </label>
        <button type="submit" className="border border-line px-4 py-2.5 text-sm font-medium active:bg-mist rounded-full">
          Update
        </button>
      </form>

      {!p.ok ? (
        <ErrorNote>{p.error}</ErrorNote>
      ) : (
        <form action={moveOutAction} className="group/mv space-y-8">
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="leaverId" value={leaver.id} />
          <input type="hidden" name="lastDay" value={lastDay} />
          <FreshKey name="rid" />

          <section>
            <h2 className="mb-3 font-display text-[19px] font-semibold">Squaring up</h2>
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt>Balance today</dt>
                <dd className="money tabular-nums">{p.balanceToday > 0 ? `gets ${money(p.balanceToday)}` : p.balanceToday < 0 ? `owes ${money(-p.balanceToday)}` : "square"}</dd>
              </div>
              {p.bills.map((b) => (
                <div key={`${b.name}-${b.period}`} className="flex justify-between">
                  <dt>
                    {b.name}{" "}
                    <span className="text-gray-500">
                      · {monthLabel(b.period)}, {b.days} of {b.monthDays} days
                    </span>
                  </dt>
                  <dd className="money tabular-nums text-owed">− {money(b.before - b.after)}</dd>
                </div>
              ))}
            </dl>
            {p.bills.length > 0 && (
              <p className="mt-2 text-xs text-gray-500">Bills are re-split: {name(leaver.id)} keep{leaver.id === myId ? "" : "s"} a share only for the days there; the rest goes to the others.</p>
            )}
          </section>

          {p.daily.length > 0 && (
            <section data-daily-bills>
              <h2 className="mb-1 font-display text-[19px] font-semibold">Daily bills this month</h2>
              <p className="mb-3 text-sm text-gray-500">
                These are added once the month is over, and then only for the people still here. {leaver.id === myId ? "Your" : `${leaver.name}’s`} share for the days there:
              </p>
              <ul className="space-y-2">
                {p.daily.map((d) => (
                  <li key={d.billId} className="rounded-2xl border border-line px-4 py-3 text-sm">
                    <span className="flex items-baseline justify-between gap-3">
                      <span>
                        {d.name}
                        <span className="text-gray-500">
                          {" "}
                          · {d.days} {d.days === 1 ? "day" : "days"}
                          {d.missed.length > 0 && ` (didn’t come ${d.missed.map((x) => `${x} ${monthLabel(lastDay.slice(0, 7))}`).join(", ")})`}
                        </span>
                      </span>
                      {!d.unsupported && <span className="money tabular-nums">{money(d.amount)}</span>}
                    </span>
                    {d.unsupported && <span className="mt-1 block text-xs text-gray-500">This one is shared by fixed amounts: work this one out by hand.</span>}
                  </li>
                ))}
              </ul>
              {p.daily.some((d) => !d.unsupported && d.amount > 0) && (
                <label className="mt-3 flex items-start gap-3 rounded-2xl border border-line px-4 py-3 has-[:checked]:border-fg has-[:checked]:bg-accent-soft">
                  <input type="checkbox" name="addDaily" value="1" defaultChecked className="mt-1 h-4 w-4 accent-[var(--color-accent)]" />
                  <span>
                    <span className="block font-medium">Add it now</span>
                    <span className="block text-xs text-gray-500">
                      Adds {leaver.id === myId ? "your" : "their"} share as an expense, and the month-end bill takes it off. Leave it off and nothing is charged after {leaver.id === myId ? "you leave" : "they leave"}.
                    </span>
                  </span>
                </label>
              )}
            </section>
          )}

          {p.deposit && (
            <section>
              <h2 className="mb-1 font-display text-[19px] font-semibold">Their deposit · {money(p.deposit.amount)}</h2>
              <p className="mb-3 text-sm text-gray-500">Held by {p.deposit.heldBy}. Who gives it back?</p>
              <div className="space-y-2">
                {others.map((m) => (
                  <label key={m.id} className="flex items-start gap-3 rounded-2xl border border-line px-4 py-3 has-[:checked]:border-fg has-[:checked]:bg-accent-soft">
                    <input type="radio" name="depositTo" value={m.id} className="mt-1 h-4 w-4 accent-[var(--color-accent)]" />
                    <span>
                      <span className="block font-medium">{Name(m.id)}, taking over the room</span>
                      <span className="block text-xs text-gray-500">
                        Pays {name(leaver.id)} {money(p.deposit!.amount)} directly; the deposit is then theirs
                      </span>
                    </span>
                  </label>
                ))}
                <label className="flex items-start gap-3 rounded-2xl border border-line px-4 py-3 has-[:checked]:border-fg has-[:checked]:bg-accent-soft">
                  <input type="radio" name="depositTo" value="" defaultChecked className="mt-1 h-4 w-4 accent-[var(--color-accent)]" />
                  <span>
                    <span className="block font-medium">{p.deposit.heldBy}, when the lease ends</span>
                    <span className="block text-xs text-gray-500">Kept on record until then, with any deductions</span>
                  </span>
                </label>
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 font-display text-[19px] font-semibold">Final payments</h2>
            {p.daily.length > 0 && p.paymentsWithDaily !== p.payments ? (
              <>
                {/* Follows the "Add it now" tick, without any script. */}
                <div className="hidden group-has-[input[name=addDaily]:checked]/mv:block">{payList(p.paymentsWithDaily)}</div>
                <div className="group-has-[input[name=addDaily]:checked]/mv:hidden">{payList(p.payments)}</div>
              </>
            ) : (
              payList(p.payments)
            )}
          </section>

          <div>
            <button type="submit" className={primaryButtonClass}>
              Settle {leaver.id === myId ? "up" : leaver.name} &amp; mark as moved out
            </button>
            <p className="mt-3 text-center text-xs leading-relaxed text-gray-500">
              {Name(leaver.id)} stay{leaver.id === myId ? "" : "s"} in the history and leave{leaver.id === myId ? "" : "s"} the bills after {niceDate(lastDay)}.
              <br />
              The payments above are recorded as paid. Everyone is told.
            </p>
          </div>
        </form>
      )}
    </>
  );
}
