import { db } from "./db";
import { isMemberUsed, setMemberLeft } from "./people";
import { removeMembers } from "./undo";

// "Remove person" on People. Someone with an account, or anyone named anywhere (expenses, payments, moments, the deposit,
// goals, games, bills, the list), is removed but kept in the history (they can't rejoin on their own). A name that was
// never used is deleted completely. The "named anywhere" test is the one removeMembers refuses on, so the two can't disagree.
export async function removeOrKeepPerson(groupId: string, actorId: string, memberId: string) {
  const row = await db.member.findFirst({ where: { id: memberId, groupId }, select: { accountId: true } });
  if (row?.accountId || (await isMemberUsed(memberId))) return setMemberLeft(groupId, actorId, memberId, true);
  return removeMembers(groupId, actorId, [memberId], false);
}
