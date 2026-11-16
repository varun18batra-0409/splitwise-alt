import { db } from "@/lib/db";

// Test helper: mark payments as a flat move-out's final payments, the way a real move-out does (a "member_left" history line whose undo
// payload lists them). Only those payments still ask the person paid ("Got it" / "Not received"); every other payment simply counts.
export async function markAsMoveOut(groupId: string, actorId: string, paymentIds: string[]) {
  const undo = { type: "member_set", moveOut: { money: { payments: paymentIds.map((id) => ({ id })) } } };
  return db.groupEvent.create({ data: { groupId, actorId, kind: "member_left", text: "moved out", undo: JSON.stringify(undo) } });
}
