import { db } from "@/lib/db";

// Who you can send a postcard to: everyone who has a Loopin account and has been in a group with you
// (open or closed, card nights included; even if one of you left). Never a name that was only typed
// into a group, and never a deleted group. Grouped by group, most recent first; each person once overall.
export type PostcardGroup = { id: string; name: string; type: string; people: { id: string; name: string }[] };

export async function postcardPeople(accountId: string): Promise<PostcardGroup[]> {
  const mine = await db.member.findMany({
    where: { accountId, group: { deletedAt: null } },
    select: { group: { select: { id: true, name: true, type: true, createdAt: true, members: { where: { accountId: { not: null } }, select: { accountId: true, name: true } } } } },
  });
  const groups = mine.map((m) => m.group).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const accountIds = [...new Set(groups.flatMap((g) => g.members.map((m) => m.accountId!)).filter((id) => id !== accountId))];
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
