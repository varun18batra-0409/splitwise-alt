import { db } from "./db";
import { netBalances } from "./balances";
import { smartSettle } from "./settle";

// Loads a group with everything needed for balances, Smart Settle and history.
export async function loadGroup(id: string) {
  const group = await db.group.findUnique({
    where: { id },
    include: {
      members: { orderBy: { createdAt: "asc" } },
      expenses: { orderBy: { createdAt: "desc" }, include: { shares: true } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!group) return null;
  const memberIds = group.members.map((m) => m.id);
  const net = netBalances(memberIds, group.expenses, group.payments);
  return { group, net, transfers: smartSettle(net) };
}

// For the home screen: every group this phone belongs to, with my balance in each.
export async function loadMyGroups(memberships: Record<string, string>) {
  const groups = await db.group.findMany({
    where: { id: { in: Object.keys(memberships) } },
    include: {
      members: { select: { id: true, name: true } },
      expenses: { include: { shares: true }, orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return groups
    .filter((g) => g.members.some((m) => m.id === memberships[g.id]))
    .map((g) => {
      const myId = memberships[g.id];
      const net = netBalances(g.members.map((m) => m.id), g.expenses, g.payments);
      const lastActivity = [g.expenses[0]?.createdAt, g.payments[0]?.createdAt, g.createdAt]
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const spent = g.expenses.reduce((s, e) => s + e.amount, 0);
      return { group: g, myId, myBalance: net[myId] ?? 0, lastActivity, spent };
    });
}
