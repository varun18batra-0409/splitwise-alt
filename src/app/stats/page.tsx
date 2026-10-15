import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { netBalances } from "@/lib/balances";
import { computeStats } from "@/lib/stats";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Stats · Loopin", robots: { index: false } };
export const dynamic = "force-dynamic";

// Private numbers for the owner. Only works when signed in with an email
// listed in the ADMIN_EMAIL setting (comma-separated for more than one).
export default async function Stats() {
  const account = await getAccount();
  const admins = (process.env.ADMIN_EMAIL ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!account || !admins.includes(account.email)) notFound();

  const [groups, members, expenses, payments, events, accounts, errors] = await Promise.all([
    db.group.findMany({ select: { id: true, createdAt: true, deletedAt: true, closed: true } }),
    db.member.findMany({ select: { id: true, groupId: true, claimedAt: true } }),
    db.expense.findMany({ where: { deletedAt: null }, select: { groupId: true, createdAt: true, paidById: true, amount: true, shares: { select: { memberId: true, amount: true } } } }),
    db.payment.findMany({ where: { deletedAt: null }, select: { groupId: true, fromId: true, toId: true, amount: true } }),
    db.groupEvent.findMany({ where: { createdAt: { gte: new Date(Date.now() - 60 * 86_400_000) } }, select: { groupId: true, createdAt: true, kind: true } }),
    db.account.count(),
    db.errorLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const balancesSettled: Record<string, boolean> = {};
  for (const g of groups) {
    const ids = members.filter((m) => m.groupId === g.id).map((m) => m.id);
    const net = netBalances(ids, expenses.filter((e) => e.groupId === g.id), payments.filter((p) => p.groupId === g.id));
    balancesSettled[g.id] = Object.values(net).every((v) => v === 0);
  }
  const s = computeStats({ groups, members, expenses, events, balancesSettled, accounts });
  const v = (x: number | null, suffix = "") => (x === null ? "—" : `${x}${suffix}`);
  const mins = s.medianMinutesToFirstExpense;
  const wait = mins === null ? "—" : mins < 60 ? `${Math.round(mins)} min` : mins < 2880 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`;

  const tiles: [string, string, string][] = [
    ["Active groups this week", String(s.weeklyActive), "Groups with any change in the last 7 days"],
    ["New groups", `${s.newGroups7} · ${s.newGroups30}`, "Last 7 days · last 30 days"],
    ["Groups with an expense", v(s.withExpensePct, "%"), `of ${s.totalGroups} groups`],
    ["Time to first expense", wait, "Median, from creating the group"],
    ["Invites that worked", v(s.invitePct, "%"), "Groups where 2+ people joined"],
    ["Still used after 4 weeks", v(s.retention4w.pct, "%"), `of ${s.retention4w.of} groups made 4–8 weeks ago`],
    ["Settled up", v(s.settledPct, "%"), "Groups with expenses where everyone is square"],
    ["Signed-in people", String(s.accounts), `${s.deletedGroups} groups waiting in the bin`],
  ];

  return (
    <>
      <PageHeader title="Stats" back="/account" />
      <div className="grid grid-cols-2 gap-2">
        {tiles.map(([label, value, hint]) => (
          <div key={label} className="rounded-2xl border border-line px-4 py-3">
            <p className="text-[11px] text-gray-500">{label}</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</p>
            <p className="mt-0.5 text-xs text-gray-400">{hint}</p>
          </div>
        ))}
      </div>

      <h2 className="mb-2 mt-10 font-display text-lg font-semibold tracking-tight">Recent errors</h2>
      {errors.length === 0 ? (
        <p className="rounded-2xl bg-mist px-4 py-6 text-center text-sm text-gray-500">No errors logged. 🎉</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {errors.map((e) => (
            <li key={e.id} className="py-2.5">
              <p className="text-xs text-gray-400">
                {e.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC · {e.path}
              </p>
              <p className="break-words text-gray-600">{e.message}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
