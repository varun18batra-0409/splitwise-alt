import { getMyMemberId } from "@/lib/identity";
import { loadGroup } from "@/lib/group-data";
import { formatMoney } from "@/lib/money";
import { nudgeLink } from "@/lib/nudge";
import { db } from "@/lib/db";
import { payLinkFor } from "@/lib/pay-link";

// Remind (Settle up → "Remind"): opens WhatsApp with a friendly message to the
// person who owes you, including your UPI ID and an "I've paid" link they can
// tap without signing in. Only for money owed to you, in a group you're in.
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const fromId = url.searchParams.get("from") ?? "";
  const home = new URL(`/groups/${id}/settle`, url.origin);
  const data = await loadGroup(id);
  const myId = data ? await getMyMemberId(id) : undefined;
  if (!data || !myId || !data.group.members.some((m) => m.id === myId)) return Response.redirect(new URL("/private", url.origin), 303);
  const { group, transfers } = data;
  const t = transfers.find((x) => x.from === fromId && x.to === myId);
  if (!t || group.closed) return Response.redirect(home, 303);

  const who = group.members.find((m) => m.id === fromId);
  const me = group.members.find((m) => m.id === myId);
  const account = me?.accountId ? await db.account.findUnique({ where: { id: me.accountId }, select: { upiId: true, payLink: true } }) : null;
  const token = await payLinkFor(group.id, fromId, myId, myId);
  const link = `${url.origin}/p/${token}`;
  const ways = account && (account.upiId || account.payLink) ? { upiId: account.upiId, payLink: account.payLink } : null;
  const wa = nudgeLink(who?.phone ?? "", who?.name ?? "there", formatMoney(t.amount, group.currency), group.name, { ways, link });
  return new Response(null, { status: 303, headers: { Location: wa, "Cache-Control": "private, no-store", "X-Pay-Link": link } });
}
