import { db } from "@/lib/db";
import { NOT_DIRECT } from "@/lib/direct"; // a pair of two people is not "sharing a group"
import { JOINED } from "@/lib/membership";
import { blockedEitherWay } from "@/lib/blocks";
import { membershipSpan, overlapped } from "@/lib/left-view";
import { memberHistory } from "@/lib/left-view-db";

// The same rule as passports: someone the admin removed stops counting (both ways); someone who left on their own still counts.
const COUNTS = { ...JOINED, removedAt: null };

// Who you can send a postcard to: everyone who has a Loopin account and has been in a group with you
// (open or closed, card nights included; even if one of you left on your own, but not if the admin removed either of you; and only
// if you were in the group at the same time: someone who joined after you left, or left before you joined, never shared it with you). Never a name that was only typed
// into a group, and never a deleted group. Both of you must have really joined: someone added
// straight in who hasn't opened the group yet isn't offered (and can't be sent to) until they do. Grouped by group, most recent first; each person once overall.
export type PostcardGroup = { id: string; name: string; type: string; people: { id: string; name: string }[] };

export async function postcardPeople(accountId: string): Promise<PostcardGroup[]> {
  const SPAN = { createdAt: true, claimedAt: true, seenAt: true, seenEventsAt: true, leftAt: true, removedAt: true } as const;
  const mineRows = await db.member.findMany({
    where: { accountId, ...COUNTS, group: { ...NOT_DIRECT, deletedAt: null } },
    select: { id: true, ...SPAN, group: { select: { id: true, name: true, type: true, createdAt: true, members: { where: { accountId: { not: null }, ...COUNTS }, select: { id: true, accountId: true, name: true, ...SPAN } } } } },
  });
  // Only people who were in the group at the same time as you (someone who left before you joined, or joined after you left, isn't offered).
  const history = await memberHistory(mineRows.map((m) => m.group.id)); // a gap between leaving and coming back is not time together
  const mine = mineRows.map((m) => {
    const span = membershipSpan(m, history.get(m.id));
    return { group: { ...m.group, members: m.group.members.filter((o) => overlapped(span, membershipSpan(o, history.get(o.id)))) } };
  });
  const groups = mine.map((m) => m.group).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  // Someone blocked (either way round) is never offered, and can't be sent to.
  const blocked = await blockedEitherWay(accountId);
  const accountIds = [...new Set(groups.flatMap((g) => g.members.map((m) => m.accountId!)).filter((id) => id !== accountId && !blocked.has(id)))];
  const accounts = accountIds.length ? await db.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
  const seen = new Set<string>();
  const out: PostcardGroup[] = [];
  for (const g of groups) {
    const people: { id: string; name: string }[] = [];
    for (const m of g.members) {
      const id = m.accountId!;
      if (id === accountId || !nameOf.has(id) || people.some((p) => p.id === id)) continue;
      people.push({ id, name: (nameOf.get(id) || m.name).trim() || m.name });
    }
    if (people.length) out.push({ id: g.id, name: g.name, type: g.type, people });
    for (const p of people) seen.add(p.id);
  }
  return out;
}

export async function canSendTo(accountId: string, toIds: string[]): Promise<Set<string>> {
  const groups = await postcardPeople(accountId);
  const ok = new Set(groups.flatMap((g) => g.people.map((p) => p.id)));
  return new Set(toIds.filter((id) => ok.has(id)));
}

// The group a postcard may be tagged to, one answer per person it goes to. A card carries its group only when BOTH people are in it
// right now (really joined, not left, not removed, group not deleted, not a pair); otherwise that card carries none. So a card can
// never name a group the other person isn't in, or one the sender has left.
export async function postcardGroupTags(senderId: string, rawGroupId: string, toIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>(toIds.map((id) => [id, ""]));
  if (!rawGroupId || !toIds.length) return out;
  const rows = await db.member.findMany({
    where: { groupId: rawGroupId, accountId: { in: [senderId, ...toIds] }, leftAt: null, removedAt: null, ...JOINED, group: { ...NOT_DIRECT, deletedAt: null } },
    select: { accountId: true },
  });
  const inGroup = new Set(rows.map((r) => r.accountId));
  if (!inGroup.has(senderId)) return out;
  for (const id of toIds) if (inGroup.has(id)) out.set(id, rawGroupId);
  return out;
}
