// Fills the database with realistic demo groups (used for automatic screenshots).
// Run: npx tsx scripts/seed-demo.ts  — writes .demo.json with the ids it created.
import { writeFileSync } from "node:fs";
import { db } from "@/lib/db";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import { logEvent } from "@/lib/events";
import type { RateAnswer } from "@/lib/rate-cache";

const rate = async (from: string): Promise<RateAnswer> =>
  from === "THB" ? { ok: true, rate: "2.5734", date: "2026-10-14" } : { ok: true, rate: "1", date: "2026-10-14" };

async function group(name: string, people: { name: string; phone?: string }[], extra: { currency?: string; cardMarkupBp?: number; closed?: boolean } = {}) {
  const g = await db.group.create({
    data: {
      name,
      currency: extra.currency ?? "INR",
      cardMarkupBp: extra.cardMarkupBp ?? 0,
      closed: extra.closed ?? false,
      closedAt: extra.closed ? new Date() : null,
      inviteCode: `demo${Math.random().toString(36).slice(2, 8)}`,
      members: { create: people.map((p) => ({ name: p.name, phone: p.phone ?? "" })) },
    },
    include: { members: true },
  });
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  return { g, id };
}

function input(groupId: string, over: Partial<SaveExpenseInput>): SaveExpenseInput {
  return {
    groupId, name: "Expense", category: "", amount: "100", currency: "INR", paidById: "", forMode: "everyone",
    selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
    markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
  };
}

async function add(groupId: string, actor: string, over: Partial<SaveExpenseInput>) {
  const r = await saveExpense(input(groupId, { paidById: actor, ...over }), actor, rate);
  if (!r.ok) throw new Error(`${over.name}: ${r.error}`);
  return r;
}

async function main() {
const trip = await group(
  "Thailand trip",
  [{ name: "Varun" }, { name: "Asha", phone: "+91 98765 43210" }, { name: "Ravi" }, { name: "Meera" }, { name: "Dev" }],
  { cardMarkupBp: 300 },
);
const V = trip.id("Varun"), A = trip.id("Asha"), R = trip.id("Ravi"), M = trip.id("Meera");
// Dev couldn't come: left before any expense, so he's in the "Left the group" list.
await db.member.update({ where: { id: trip.id("Dev") }, data: { leftAt: new Date("2026-10-07T10:00:00Z") } });
await add(trip.g.id, V, { name: "Flights to Bangkok", amount: "48000", date: "2026-10-08" });
await add(trip.g.id, A, { name: "Hotel in Sukhumvit", amount: "12000", currency: "THB", paymentMethod: "card", date: "2026-10-09" });
await add(trip.g.id, R, { name: "Dinner at Jay Fai", amount: "3000", currency: "THB", paymentMethod: "cash", date: "2026-10-10", notes: "Crab omelette for everyone. Ravi paid the tip separately." });
await add(trip.g.id, V, { name: "Grab to the airport", amount: "450", currency: "THB", paymentMethod: "card", date: "2026-10-11" });
await add(trip.g.id, M, { name: "Grand Palace tickets", amount: "2000", currency: "THB", paymentMethod: "cash", forMode: "selected", selected: [V, A, M], date: "2026-10-11" });
await add(trip.g.id, V, { name: "Beers at Khao San", amount: "1200", currency: "THB", paymentMethod: "card", splitType: "exact", exact: { [V]: "300", [A]: "300", [R]: "600", [M]: "" }, forMode: "everyone", date: "2026-10-12" });
await add(trip.g.id, A, { name: "SIM cards", amount: "900", currency: "THB", paymentMethod: "cash", date: "2026-10-12" });
const snacks = await add(trip.g.id, R, { name: "7-Eleven snacks", amount: "320", currency: "THB", paymentMethod: "cash", date: "2026-10-13" });
await add(trip.g.id, A, { name: "Thai massage", amount: "1600", currency: "THB", paymentMethod: "card", forMode: "one", onePersonId: V, date: "2026-10-13" });
// An edit, a deletion and a payment, so history and notifications have something to show.
await saveExpense(input(trip.g.id, { expenseId: snacks.id, name: "7-Eleven snacks", amount: "380", currency: "THB", paidById: R, paymentMethod: "cash", date: "2026-10-13" }), A, rate);
const extra = await add(trip.g.id, M, { name: "Souvenirs", amount: "500", currency: "THB", paymentMethod: "cash", date: "2026-10-14" });
const { setExpenseDeleted } = await import("@/lib/save-expense");
await setExpenseDeleted(extra.id, M, true);
const pay = await db.payment.create({ data: { groupId: trip.g.id, fromId: R, toId: V, amount: 500000, createdById: R } });
await logEvent(db, { groupId: trip.g.id, actorId: R, kind: "payment_recorded", text: "recorded Ravi paid Varun ₹5,000", paymentId: pay.id, undo: { type: "payment_delete", paymentId: pay.id } });
await db.member.update({ where: { id: V }, data: { seenEventsAt: new Date("2026-10-11T00:00:00Z") } });

const flat = await group("Flat 4B", [{ name: "Varun" }, { name: "Asha", phone: "9876543210" }, { name: "Kabir" }]);
const FV = flat.id("Varun"), FA = flat.id("Asha");
await add(flat.g.id, FV, { name: "Electricity bill", amount: "3600", date: "2026-10-05" });
await add(flat.g.id, FA, { name: "Groceries from DMart", amount: "2400", date: "2026-10-12" });
await add(flat.g.id, FV, { name: "Wifi", amount: "1200", date: "2026-10-13" });

const goa = await group("Goa 2025", [{ name: "Varun" }, { name: "Meera" }], { closed: true });
await add(goa.g.id, goa.id("Varun"), { name: "Beach shack lunch", amount: "1800", date: "2026-10-01" }).catch(() => undefined);

writeFileSync(
  ".demo.json",
  JSON.stringify(
    {
      memberships: { [trip.g.id]: V, [flat.g.id]: FV, [goa.g.id]: goa.id("Varun") },
      trip: { id: trip.g.id, invite: trip.g.inviteCode, expenseId: snacks.id, ravi: R },
      flat: { id: flat.g.id },
    },
    null,
    2,
  ),
);
console.log("Demo data ready.");
await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
