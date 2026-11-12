import { db } from "@/lib/db";
import { getAccount, getMemberships } from "@/lib/identity";
import { myDataCsv } from "@/lib/csv";
import { getTimeZone } from "@/lib/tz";
import { dayKey } from "@/lib/dates";
import { readableWhere } from "@/lib/left-view-db";
import { hideLaterNotes, leaverCut } from "@/lib/left-view";

// "Download all my data" (Account): one CSV with every group I'm in on this
// phone or account. Only ever my own groups; nothing for a stranger.
export async function GET() {
  const memberships = await getMemberships();
  const ids = Object.keys(memberships);
  const account = await getAccount();
  if (!account && !ids.length) return new Response("Sign in first.", { status: 401 });
  const groups = await db.group.findMany({
    where: { id: { in: ids }, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, leftAt: true, removedAt: true } },
    },
  });
  const tz = await getTimeZone();
  const now = new Date();
  const body = myDataCsv(
    account ? { email: account.email, name: account.name ?? "", createdAt: account.createdAt } : null,
    await Promise.all(
      groups
        .filter((g) => g.members.some((m) => m.id === memberships[g.id]))
        .map(async (g) => {
          // Groups I left (or was removed from): only what I'm allowed to see there, like on screen.
          const me = g.members.find((m) => m.id === memberships[g.id])!;
          const scope = await readableWhere(g.id, me);
          const [allExpenses, payments, claims] = await Promise.all([
            db.expense.findMany({ where: { groupId: g.id, ...(scope ? { AND: [scope.expenses] } : {}) }, include: { shares: true } }),
            db.payment.findMany({ where: { groupId: g.id, ...(scope ? { AND: [scope.payments] } : {}) } }),
            // Only my own "I've paid" claims (said by me, or said to me).
            db.paymentClaim.findMany({ where: { groupId: g.id, OR: [{ fromId: memberships[g.id] }, { toId: memberships[g.id] }] } }),
          ]);
          // Notes of expenses changed after I left stay blank.
          const cut = leaverCut(me);
          const expenses = cut ? hideLaterNotes(allExpenses, cut.leftAt) : allExpenses;
          return { ...g, expenses, payments, claims, myId: memberships[g.id] };
        }),
    ),
    now,
    tz,
    account ? await db.report.findMany({ where: { kind: "support", reporterId: account.id }, orderBy: { createdAt: "asc" }, select: { createdAt: true, note: true, contact: true, status: true }, take: 500 }) : [],
  );
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="loopin-my-data-${dayKey(now, tz)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
