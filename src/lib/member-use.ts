import { db } from "./db";

export type UseClient = Pick<typeof db, "expenseShare" | "expense" | "payment" | "paymentClaim" | "moment" | "momentReaction" | "depositShare" | "goalEntry" | "potMove" | "potGame" | "bill" | "listItem">;

// Is this person named anywhere that taking them out would leave behind? These columns hold the id as plain text
// (no foreign key), so a delete would not complain: the money would just point at nobody.
// One list for both "can this name be deleted?" (People, Undo of "added") so they can never disagree.
export async function memberInUse(client: UseClient, groupId: string, id: string): Promise<boolean> {
  // One after another (this also runs inside a transaction).
  for (const q of [
    () => client.expenseShare.count({ where: { memberId: id } }),
    () => client.expense.count({ where: { groupId, OR: [{ paidById: id }, { createdById: id }, { payers: { contains: id } }] } }),
    () => client.payment.count({ where: { OR: [{ fromId: id }, { toId: id }] } }),
    // An "I've paid" claim (waiting or answered) counts as being part of a payment too.
    () => client.paymentClaim.count({ where: { OR: [{ fromId: id }, { toId: id }] } }),
    // A moment they added, or a reaction they left: taking the person out would leave photos with no author (and their files behind).
    () => client.moment.count({ where: { groupId, authorId: id } }),
    () => client.momentReaction.count({ where: { memberId: id } }),
    // The deposit (either side of a hand-over), goal money, card-game money and games, bills they pay or take turns on.
    () => client.depositShare.count({ where: { deposit: { groupId }, OR: [{ memberId: id }, { toMemberId: id }] } }),
    () => client.goalEntry.count({ where: { goal: { groupId }, memberId: id } }),
    () => client.potMove.count({ where: { game: { groupId }, memberId: id } }),
    () => client.potGame.count({ where: { groupId, OR: [{ hostId: id }, { players: { contains: id } }] } }),
    // A bill they pay, take turns on, or are named in the split (some / percent / amounts). Member ids are cuids, so a match on the text is exact.
    () => client.bill.count({ where: { groupId, OR: [{ payer: id }, { rotation: { contains: id } }, { split: { contains: id } }] } }),
    // The shopping list: who added or ticked an item.
    () => client.listItem.count({ where: { groupId, OR: [{ addedById: id }, { boughtById: id }] } }),
  ]) if ((await q()) > 0) return true;
  return false;
}
