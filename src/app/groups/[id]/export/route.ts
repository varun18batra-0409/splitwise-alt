import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { csvFileName, groupCsv } from "@/lib/csv";
import { getTimeZone } from "@/lib/tz";
import { readableWhere } from "@/lib/left-view-db";
import { hideLaterNotes, leaverCut } from "@/lib/left-view";

// Download the group's expenses and payments as a CSV file (members only).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = await db.group.findUnique({
    where: { id },
    include: {
      members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, leftAt: true, removedAt: true } },
    },
  });
  if (!group || group.deletedAt) return new Response("Not found", { status: 404 });
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) return new Response("Join this group first.", { status: 403 });
  // Someone who left can take a copy for 30 days after leaving; after that it's the group's.
  const left = group.members.find((m) => m.id === myId)?.leftAt;
  if (left && Date.now() - left.getTime() > 30 * 86_400_000) return new Response("You left this group more than 30 days ago.", { status: 403 });

  // Someone who left (or was removed) gets the same view as on screen: up to the day they left, plus later changes to their own share.
  const me = group.members.find((m) => m.id === myId)!;
  const scope = await readableWhere(group.id, me);
  const [allExpenses, payments] = await Promise.all([
    db.expense.findMany({ where: { groupId: group.id, ...(scope ? { AND: [scope.expenses] } : {}) }, include: { shares: true } }),
    db.payment.findMany({ where: { groupId: group.id, ...(scope ? { AND: [scope.payments] } : {}) } }),
  ]);
  // Notes of expenses changed after they left stay blank for them.
  const cut = leaverCut(me);
  const expenses = cut ? hideLaterNotes(allExpenses, cut.leftAt) : allExpenses;
  const body = groupCsv(group, group.members, expenses, payments, await getTimeZone(), { onlyInvolved: Boolean(scope) });
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(group.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
