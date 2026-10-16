import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { addGoalEntry, deleteGoal, saveGoal, tripFromGoal } from "@/app/bill-actions";
import { goalPlan } from "@/lib/home/goals";
import { formatMoney, toInputAmount } from "@/lib/money";
import { niceDate } from "@/lib/format";
import { dayKey } from "@/lib/dates";
import { getTimeZone } from "@/lib/tz";
import { newRequestKey } from "@/lib/once";

// A savings goal ("new" to start one): the ring, what a month gets you there,
// and "I set money aside". The money stays in people's own accounts.
export default async function GoalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; goalId: string }>;
  searchParams: Promise<{ error?: string; added?: string }>;
}) {
  const { id, goalId } = await params;
  const sp = await searchParams;
  const group = await db.group.findUnique({ where: { id }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  const money = (n: number) => formatMoney(n, group.currency);
  const tz = await getTimeZone();

  if (goalId === "new") {
    return (
      <>
        <PageHeader title="New savings goal" back={`/groups/${group.id}`} />
        {sp.error && <ErrorNote>{sp.error.slice(0, 160)}</ErrorNote>}
        <p className="-mt-3 mb-6 text-sm text-gray-500">A holiday, a sofa, a rainy-day fund. Loopin keeps count; the money stays in your own accounts.</p>
        <form action={saveGoal} className="space-y-6">
          <input type="hidden" name="groupId" value={group.id} />
          <label className="block">
            <span className="mb-2 block text-sm text-gray-500">What for?</span>
            <input name="name" required maxLength={40} placeholder="Bali in March" className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm text-gray-500">How much?</span>
            <span className="flex items-center gap-2 rounded-xl border border-line bg-mist px-4 focus-within:border-accent">
              <span className="text-sm text-gray-400">{group.currency}</span>
              <input name="target" required inputMode="decimal" placeholder="2,00,000" className="w-full bg-transparent py-3.5 font-display text-xl outline-none" />
            </span>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm text-gray-500">By when? (optional)</span>
            <input name="byDate" type="date" className={inputClass} />
          </label>
          <button type="submit" className={primaryButtonClass}>
            Start goal
          </button>
        </form>
      </>
    );
  }

  const goal = await db.goal.findFirst({ where: { id: goalId, groupId: group.id, deletedAt: null }, include: { entries: { orderBy: { createdAt: "desc" } } } });
  if (!goal) notFound();
  const saved = goal.entries.reduce((s, e) => s + e.amount, 0);
  const active = group.members.filter((m) => !m.leftAt);
  const plan = goalPlan({
    target: goal.target,
    saved,
    today: dayKey(new Date(), tz),
    byDate: goal.byDate,
    createdAt: dayKey(goal.createdAt, tz),
    weights: Object.fromEntries(active.map((m) => [m.id, m.splitWeight])),
  });
  const pct = Math.min(100, Math.round((saved * 100) / goal.target));
  const name = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const r = 84;
  const circ = 2 * Math.PI * r;

  return (
    <>
      <PageHeader title={goal.name} back={`/groups/${group.id}`} />
      {sp.error && <ErrorNote>{sp.error.slice(0, 160)}</ErrorNote>}
      {goal.byDate && <p className="-mt-4 mb-4 text-sm text-gray-500">Goal · by {niceDate(goal.byDate)}</p>}

      <section className="flex flex-col items-center">
        <div className="relative h-[200px] w-[200px]">
          <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90" role="img" aria-label={`${pct}% saved`}>
            <circle cx="100" cy="100" r={r} fill="none" strokeWidth="14" className="stroke-mist" />
            <circle cx="100" cy="100" r={r} fill="none" strokeWidth="14" strokeLinecap="round" className="stroke-fg" strokeDasharray={`${(circ * pct) / 100} ${circ}`} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="font-display text-[28px] font-semibold tabular-nums">{money(saved)}</p>
            <p className="text-sm text-gray-500">of {money(goal.target)}</p>
          </div>
        </div>
        <p className="mt-3 text-center text-sm leading-relaxed">
          {goal.reachedAt ? (
            <>Reached 🎉 Well done, both of you.</>
          ) : plan.months ? (
            <>
              {plan.onTrack ? "On track." : "A bit behind."} {money(plan.perMonth)} a month gets you there.
              {plan.perPerson.length > 1 && (
                <span className="block text-gray-500">{plan.perPerson.map((p) => `${name(p.memberId)} ${money(p.amount)}`).join(" · ")}</span>
              )}
            </>
          ) : (
            <>{money(plan.left)} to go.</>
          )}
        </p>
      </section>

      <div className="mt-6 grid grid-cols-2 gap-2.5">
        {active.map((m) => (
          <div key={m.id} className="rounded-2xl border border-line bg-white p-3.5">
            <p className="text-xs text-gray-500">{m.id === myId ? "You’ve set aside" : `${m.name} has set aside`}</p>
            <p className="mt-1 font-display text-[22px] font-semibold tabular-nums">{money(goal.entries.filter((e) => e.memberId === m.id).reduce((s, e) => s + e.amount, 0))}</p>
          </div>
        ))}
      </div>

      {goal.reachedAt ? (
        <form action={tripFromGoal} className="mt-6">
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="goalId" value={goal.id} />
          <button type="submit" className={primaryButtonClass}>
            Start a “{goal.name}” trip group
          </button>
        </form>
      ) : (
        <form action={addGoalEntry} className="mt-6 space-y-2">
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="goalId" value={goal.id} />
          <input type="hidden" name="rid" value={newRequestKey()} />
          <span className="flex items-center gap-2 rounded-xl border border-line bg-mist px-4 focus-within:border-accent">
            <span className="text-sm text-gray-400">{group.currency}</span>
            <input name="amount" required inputMode="decimal" aria-label="Amount set aside" defaultValue={plan.perPerson.find((p) => p.memberId === myId) ? toInputAmount(plan.perPerson.find((p) => p.memberId === myId)!.amount, group.currency) : ""} className="w-full bg-transparent py-3 font-display text-xl outline-none" />
          </span>
          <button type="submit" className={primaryButtonClass}>
            I set money aside
          </button>
          <p className="text-center text-xs text-gray-500">The money stays in your own accounts. Loopin just keeps count.</p>
        </form>
      )}

      {goal.entries.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-1 text-sm font-semibold text-gray-500">Recent</h2>
          <ul className="divide-y divide-line border-y border-line text-sm">
            {goal.entries.slice(0, 10).map((e) => (
              <li key={e.id} className="flex justify-between py-2.5">
                <span>
                  {name(e.memberId)} set aside <span className="block text-xs text-gray-500">{niceDate(dayKey(e.createdAt, tz))}</span>
                </span>
                <span className="font-display tabular-nums">{money(e.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="mt-8">
        <summary className="cursor-pointer text-sm text-gray-500">Change or remove this goal</summary>
        <form action={saveGoal} className="mt-4 space-y-4">
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="goalId" value={goal.id} />
          <input name="name" defaultValue={goal.name} maxLength={40} aria-label="Goal name" className={inputClass} />
          <input name="target" defaultValue={toInputAmount(goal.target, group.currency)} inputMode="decimal" aria-label="Target" className={inputClass} />
          <input name="byDate" type="date" defaultValue={goal.byDate} aria-label="By when" className={inputClass} />
          <button type="submit" className={secondaryButtonClass}>
            Save changes
          </button>
        </form>
        <form action={deleteGoal} className="mt-4">
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="goalId" value={goal.id} />
          <ConfirmButton message={`Remove the goal ${goal.name}?`} className="w-full py-3 text-sm font-medium text-red-600">
            Remove goal
          </ConfirmButton>
        </form>
      </details>
    </>
  );
}
