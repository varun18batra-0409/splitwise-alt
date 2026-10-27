"use server";

import { redirect } from "@/lib/fresh-redirect";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { isReaction } from "@/lib/reactions";
import { sendPushTo } from "@/lib/push";

// React to an expense (or change / take back your reaction). The person who
// added it gets a little buzz, unless they reacted to their own.
export async function reactAction(f: FormData) {
  const expenseId = String(f.get("expenseId") ?? "");
  const emoji = String(f.get("emoji") ?? "");
  const e = /^[A-Za-z0-9_-]{6,40}$/.test(expenseId) ? await db.expense.findUnique({ where: { id: expenseId }, select: { id: true, groupId: true, description: true, createdById: true, deletedAt: true, group: { select: { name: true } } } }) : null;
  if (!e) redirect("/");
  const myId = await getMyMemberId(e.groupId);
  if (!myId) redirect("/private");
  const back = `/groups/${e.groupId}?tab=activity&open=${e.id}#item-${e.id}`;
  if (!isReaction(emoji) || e.deletedAt) redirect(back);
  const had = await db.reaction.findUnique({ where: { expenseId_memberId: { expenseId: e.id, memberId: myId } } });
  if (had?.emoji === emoji) await db.reaction.delete({ where: { id: had.id } });
  else {
    await db.reaction.upsert({ where: { expenseId_memberId: { expenseId: e.id, memberId: myId } }, create: { expenseId: e.id, memberId: myId, emoji }, update: { emoji } });
    if (e.createdById && e.createdById !== myId) {
      const me = await db.member.findUnique({ where: { id: myId }, select: { name: true } });
      await sendPushTo([e.createdById], { title: `${emoji} ${e.group.name}`, body: `${me?.name ?? "Someone"} reacted ${emoji} to ${e.description}`, url: back, tag: `react-${e.id}` });
    }
  }
  redirect(back);
}
