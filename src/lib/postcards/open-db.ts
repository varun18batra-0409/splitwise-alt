import { db } from "@/lib/db";
import { deliverNotes } from "@/lib/account-notes";

// Sealed postcards whose day has come: tell each person theirs is open (once).
export async function noteOpenedPostcards(now = new Date()): Promise<{ sent: number }> {
  const due = await db.postcard.findMany({ where: { opensAt: { lte: now }, openNoted: false }, select: { id: true, fromId: true, toId: true }, take: 500 });
  if (!due.length) return { sent: 0 };
  const senders = await db.account.findMany({ where: { id: { in: [...new Set(due.map((p) => p.fromId))] } }, select: { id: true, name: true } });
  const first = new Map(senders.map((a) => [a.id, a.name.trim().split(/\s+/)[0] || "A friend"]));
  await db.postcard.updateMany({ where: { id: { in: due.map((p) => p.id) } }, data: { openNoted: true } });
  await deliverNotes(due.map((p) => ({ accountIds: [p.toId], kind: "postcard", title: "Your sealed postcard is open", body: `${first.get(p.fromId) ?? "A friend"} wrote it for today.`, url: `/postcards/${p.id}`, tag: `postcard-open-${p.id}` })));
  return { sent: due.length };
}
