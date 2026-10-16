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
import { newRequestKey } from "@/lib/once";

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
  const leaver = group.members.find((m) => m.id === memberId && !m.leftAt);
  if (!leaver) notFound();

  const tz = await getTimeZone();
  const today = dayKey(new Date(), tz);
  const lastDay = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? sp.day! : today;
  const p = await moveOutPreview(group.id, leaver.id, lastDay);
  const money = (n: number) => formatMoney(n, group.currency);
  const name = (mid: string) => (mid === myId ? "you" : group.members.find((m) => m.id === mid)?.name ?? "someone");
  const Name = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const others = group.members.filter((m) => !m.leftAt && m.id !== leaver.id);
  const title = leaver.id === myId ? "You’re moving out" : `${leaver.name} is moving out`;

  return (
    <>
      <PageHeader title={title} back={`/groups/${group.id}/people`} />
      {sp.error && <ErrorNote>{sp.error.slice(0, 160)}</ErrorNote>}

      {/* Changing the day reloads the numbers below. */}
      <form method="get" className="mb-7 flex items-end gap-2 border-y border-line py-3.5" data-allow-repeat="1">
        <label className="flex-1">
          <span className="block text-sm text-gray-500">Last day in the flat</span>
          <input type="date" name="day" defaultValue={lastDay} className={`${inputClass} mt-1 py-2`} />
        </label>
        <button type="submit" className="border border-line px-4 py-2.5 text-sm font-medium active:bg-mist">
          Update
        </button>
      </form>

      {!p.ok ? (
        <ErrorNote>{p.error}</ErrorNote>
      ) : (
        <form action={moveOutAction} className="space-y-8">
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="leaverId" value={leaver.id} />
          <input type="hidden" name="lastDay" value={lastDay} />
          <input type="hidden" name="rid" value={newRequestKey()} />

          <section>
            <h2 className="mb-3 font-display text-[19px] font-semibold">Squaring up</h2>
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt>Balance today</dt>
                <dd className="font-display tabular-nums">{p.balanceToday > 0 ? `gets ${money(p.balanceToday)}` : p.balanceToday < 0 ? `owes ${money(-p.balanceToday)}` : "square"}</dd>
              </div>
              {p.bills.map((b) => (
                <div key={b.name} className="flex justify-between">
                  <dt>
                    {b.name}{" "}
                    <span className="text-gray-500">
                      · {p.daysStayed} of {p.monthDays} days
                    </span>
                  </dt>
                  <dd className="font-display tabular-nums text-owed">− {money(b.before - b.after)}</dd>
                </div>
              ))}
            </dl>
            {p.bills.length > 0 && (
              <p className="mt-2 text-xs text-gray-500">This month’s bills are re-split: {name(leaver.id)} keep{leaver.id === myId ? "" : "s"} a share only for the days there; the rest goes to the others.</p>
            )}
          </section>

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
            {p.payments.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing to pay: {name(leaver.id)} {leaver.id === myId ? "are" : "is"} square.</p>
            ) : (
              <ul className="space-y-2">
                {p.payments.map((t) => (
                  <li key={`${t.from}-${t.to}`} className="flex items-center justify-between border border-line px-4 py-3 text-sm">
                    <span>
                      <strong className="font-semibold">{Name(t.from)}</strong> <span className="text-gray-500">{t.from === myId ? "pay" : "pays"}</span>{" "}
                      <strong className="font-semibold">{name(t.to)}</strong>
                    </span>
                    <span className={`font-display text-[17px] tabular-nums ${t.to === myId ? "text-owed" : t.from === myId ? "text-owe" : ""}`}>{money(t.amount)}</span>
                  </li>
                ))}
              </ul>
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
