"use server";

import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { aiAllowed, readLine } from "@/lib/ai";

// "Dinner twenty-four hundred, Ravi paid, everyone except Dev": when the
// phone's own reading of a typed or spoken line misses something, Claude
// reads it. Only the line and the group's first names are sent.
export async function readLineAction(groupId: string, text: string): Promise<{ ok: true; name: string; amount: string; currency: string; paidById: string; forIds: string[] | null } | { ok: false; error: string }> {
  if (typeof groupId !== "string" || typeof text !== "string" || !/^[A-Za-z0-9_-]{6,40}$/.test(groupId) || !text.trim()) return { ok: false, error: "Say or type the expense first." };
  const myId = await getMyMemberId(groupId);
  const me = myId ? await db.member.findFirst({ where: { id: myId, groupId, leftAt: null, group: { deletedAt: null } }, select: { id: true, accountId: true } }) : null;
  if (!me) return { ok: false, error: "Only people in this group can add to it." };
  const blocked = await aiAllowed(me.accountId ?? me.id);
  if (blocked) return { ok: false, error: blocked };
  const people = await db.member.findMany({ where: { groupId, leftAt: null }, select: { id: true, name: true }, take: 60 });
  const r = await readLine(text.slice(0, 300), people.map((p) => ({ id: p.id, name: p.name.split(" ")[0] })), me.id);
  if (!r || (!r.amount && !r.paidBy && !r.forIds)) return { ok: false, error: "Couldn’t pick out an amount or names. Try: “Cab 600, Ravi paid, everyone”." };
  return { ok: true, name: r.name, amount: r.amount ? String(r.amount) : "", currency: r.currency, paidById: r.paidBy, forIds: r.forIds };
}
