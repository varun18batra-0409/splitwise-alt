import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { csvFileName, groupCsv } from "@/lib/csv";
import { getTimeZone } from "@/lib/tz";

// Download the group's expenses and payments as a CSV file (members only).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = await db.group.findUnique({
    where: { id },
    include: {
      members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, leftAt: true } },
      expenses: { include: { shares: true } },
      payments: true,
    },
  });
  if (!group || group.deletedAt) return new Response("Not found", { status: 404 });
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) return new Response("Join this group first.", { status: 403 });
  // Someone who left can take a copy for 30 days after leaving; after that it's the group's.
  const left = group.members.find((m) => m.id === myId)?.leftAt;
  if (left && Date.now() - left.getTime() > 30 * 86_400_000) return new Response("You left this group more than 30 days ago.", { status: 403 });

  const body = groupCsv(group, group.members, group.expenses, group.payments, await getTimeZone());
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(group.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
