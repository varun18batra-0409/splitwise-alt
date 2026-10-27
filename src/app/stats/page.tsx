import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { netBalances } from "@/lib/balances";
import { computeStats } from "@/lib/stats";
import { LIMITS, appUsage, pct, tursoUsage } from "@/lib/usage";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Stats", robots: { index: false } };
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
    db.expense.findMany({ where: { deletedAt: null }, select: { groupId: true, createdAt: true, paidById: true, payers: true, kind: true, amount: true, shares: { select: { memberId: true, amount: true } } } }),
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
  const [usage, turso] = await Promise.all([appUsage(), tursoUsage()]);
  const gb = (b: number) => `${(b / 1024 ** 3).toFixed(2)} GB`;
  const m = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n.toLocaleString("en-IN"));
  const storage = turso?.storage ?? usage.bytes;
  const usageRows = [
    { label: "Database size (Turso, 5 GB)", value: storage === null ? "—" : `${gb(storage)} · ${pct(storage, LIMITS.tursoStorageBytes)}%`, p: pct(storage, LIMITS.tursoStorageBytes) },
    turso?.rowsRead != null
      ? { label: "Rows read this month (500 M)", value: `${m(turso.rowsRead)} · ${pct(turso.rowsRead, LIMITS.tursoRowsRead)}%`, p: pct(turso.rowsRead, LIMITS.tursoRowsRead) }
      : { label: "Rows read this month (500 M)", value: "needs Turso token", p: null },
    turso?.rowsWritten != null
      ? { label: "Rows written this month (10 M)", value: `${m(turso.rowsWritten)} · ${pct(turso.rowsWritten, LIMITS.tursoRowsWritten)}%`, p: pct(turso.rowsWritten, LIMITS.tursoRowsWritten) }
      : { label: "Rows written, last 30 days (est., 10 M)", value: `~${m(usage.writes30)} · ${pct(usage.writes30, LIMITS.tursoRowsWritten)}%`, p: pct(usage.writes30, LIMITS.tursoRowsWritten) },
    { label: "Changes in the last 30 days", value: m(usage.events30), p: null },
    { label: "Stored rows", value: `${m(usage.rows.expenses)} expenses · ${m(usage.rows.payments)} payments · ${m(usage.rows.groups)} groups`, p: null },
    { label: "Server errors, last 30 days", value: String(usage.errors30), p: null },
  ];
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
            <p className="mt-1 money text-2xl font-semibold tabular-nums">{value}</p>
            <p className="mt-0.5 text-xs text-gray-400">{hint}</p>
          </div>
        ))}
      </div>

      <h2 className="mb-1 mt-10 font-display text-lg font-semibold tracking-tight">Usage and free limits</h2>
      <p className="mb-3 text-sm text-gray-500">Both free plans pause the app if a limit is reached (no surprise bill). Act at 70%.</p>
      <ul className="divide-y divide-line rounded-2xl border border-line text-sm">
        {usageRows.map((u) => (
          <li key={u.label} className="px-4 py-3">
            <div className="flex justify-between gap-3">
              <span>{u.label}</span>
              <span className={`tabular-nums ${u.p !== null && u.p >= 70 ? "text-owe" : "text-gray-500"}`}>{u.value}</span>
            </div>
            {u.p !== null && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-mist">
                <div className={`h-full rounded-full ${u.p >= 70 ? "bg-owe" : "bg-owed"}`} style={{ width: `${Math.min(100, Math.max(1, u.p))}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-gray-400">
        {turso ? "Turso figures are live from Turso." : "Add TURSO_PLATFORM_TOKEN and TURSO_ORG in Vercel for live Turso figures; until then reads/writes are estimates."}{" "}
        Vercel data transfer and function calls: Vercel dashboard → Usage.
      </p>

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
