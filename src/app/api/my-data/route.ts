import { db } from "@/lib/db";
import { getAccount, getMemberships } from "@/lib/identity";
import { myDataCsv } from "@/lib/csv";
import { getTimeZone } from "@/lib/tz";
import { dayKey } from "@/lib/dates";

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
      members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true } },
      expenses: { include: { shares: true } },
      payments: true,
    },
  });
  const tz = await getTimeZone();
  const now = new Date();
  const body = myDataCsv(
    account ? { email: account.email, name: account.name ?? "", createdAt: account.createdAt } : null,
    groups.filter((g) => g.members.some((m) => m.id === memberships[g.id])).map((g) => ({ ...g, myId: memberships[g.id] })),
    now,
    tz,
  );
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="loopin-my-data-${dayKey(now, tz)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
