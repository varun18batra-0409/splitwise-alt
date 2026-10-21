// Fills the database with realistic demo groups (used for automatic screenshots).
// Run: npx tsx scripts/seed-demo.ts  — writes .demo.json with the ids it created.
import { writeFileSync } from "node:fs";
import { db } from "@/lib/db";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import { logEvent } from "@/lib/events";
import type { RateAnswer } from "@/lib/rate-cache";
import { addMonths, monthKey } from "@/lib/home/month";
import { dayKey } from "@/lib/dates";
import { runBillsForGroup } from "@/lib/home/bills-db";
import { addListItem } from "@/lib/home/list-db";
import { saveBudgetsFor } from "@/lib/home/budgets-db";
import { saveDepositFor } from "@/lib/home/moving-db";
import { addGoalEntryFor, saveGoalFor } from "@/lib/home/goals-db";

const rate = async (from: string): Promise<RateAnswer> =>
  from === "THB" ? { ok: true, rate: "2.5734", date: "2026-10-14" } : { ok: true, rate: "1", date: "2026-10-14" };

async function group(name: string, people: { name: string; phone?: string }[], extra: { currency?: string; cardMarkupBp?: number; closed?: boolean; type?: string } = {}) {
  const g = await db.group.create({
    data: {
      name,
      currency: extra.currency ?? "INR",
      cardMarkupBp: extra.cardMarkupBp ?? 0,
      closed: extra.closed ?? false,
      type: extra.type ?? "other",
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
  { cardMarkupBp: 300, type: "trip" },
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
await logEvent(db, { groupId: trip.g.id, actorId: R, kind: "payment_recorded", text: "paid Varun ₹5,000", paymentId: pay.id, undo: { type: "payment_delete", paymentId: pay.id } });
await db.member.update({ where: { id: V }, data: { seenEventsAt: new Date("2026-10-11T00:00:00Z") } });

// A flat (Home group): bigger room pays 1.2×, regular bills that add
// themselves, a shopping list, budgets and the deposit.
const flat = await group("Flat 402", [{ name: "Varun" }, { name: "Asha", phone: "9876543210" }, { name: "Kabir" }], { type: "home" });
const FV = flat.id("Varun"), FA = flat.id("Asha"), FK = flat.id("Kabir");
await db.member.update({ where: { id: FV }, data: { splitWeight: 120 } });
await db.group.update({ where: { id: flat.g.id }, data: { reminders: true, settleDay: 31 } });
const now = new Date();
const thisMonth = monthKey(now);
const lastMonth = addMonths(thisMonth, -1);
const before = addMonths(thisMonth, -2);
// A day this month that isn't in the future (the demo may run early in a month).
const day = (n: number) => `${thisMonth}-${String(Math.min(n, Number(dayKey(now).slice(8, 10)))).padStart(2, "0")}`;
// Electricity history, so "usually" and the heads-up have something to compare.
await add(flat.g.id, FA, { name: "Electricity", category: "bills", amount: "2600", date: `${addMonths(thisMonth, -3)}-10` });
await add(flat.g.id, FA, { name: "Electricity", category: "bills", amount: "2750", date: `${before}-10` });
await add(flat.g.id, FA, { name: "Electricity", category: "bills", amount: "2900", date: `${lastMonth}-10` });
const bill = (data: { name: string; icon: string; nature: string; amount: number; day: number; payer: string; rotation?: string[]; startMonth?: string }) =>
  db.bill.create({ data: { groupId: flat.g.id, category: "bills", createdById: FV, ...data, startMonth: data.startMonth ?? lastMonth, rotation: JSON.stringify(data.rotation ?? []) } });
await bill({ name: "Rent", icon: "rent", nature: "fixed", amount: 4200000, day: 1, payer: FV });
await bill({ name: "Wi-Fi", icon: "wifi", nature: "fixed", amount: 99900, day: 5, payer: FK });
await bill({ name: "Electricity", icon: "electricity", nature: "varies", amount: 290000, day: 10, payer: FA, startMonth: thisMonth });
await bill({ name: "Milk", icon: "milk", nature: "daily", amount: 6800, day: 31, payer: "", rotation: [FV, FA, FK] });
await bill({ name: "Cook", icon: "cook", nature: "fixed", amount: 600000, day: 31, payer: FA });
await runBillsForGroup(flat.g.id, now);
await add(flat.g.id, FA, { name: "Groceries from DMart", category: "groceries", amount: "2400", date: day(3) });
await add(flat.g.id, FK, { name: "Blinkit order", category: "groceries", amount: "1180", date: day(8) });
await add(flat.g.id, FV, { name: "Pizza night", category: "food", amount: "1650", date: day(11) });
for (const [who, text] of [[FA, "Bread"], [FK, "Eggs"], [FV, "Dish soap"], [FA, "Coffee"]] as const) await addListItem(flat.g.id, who, text);
await saveBudgetsFor(flat.g.id, FV, { groceries: "6000", food: "4000" });
await saveDepositFor(flat.g.id, FV, { heldBy: "Mr. Iyer (landlord)", amounts: { [FV]: "50000", [FA]: "42000", [FK]: "42000" } });

// A couple: 55 / 45 by income, and a savings goal.
const us = await group("Us", [{ name: "Varun" }, { name: "Riya" }], { type: "couple" });
const UV = us.id("Varun"), UR = us.id("Riya");
await db.member.update({ where: { id: UV }, data: { splitWeight: 55 } });
await db.member.update({ where: { id: UR }, data: { splitWeight: 45 } });
await add(us.g.id, UV, { name: "Groceries", category: "groceries", amount: "3200", splitType: "shares", shares: { [UV]: "0.55", [UR]: "0.45" }, date: `${lastMonth}-20` });
await add(us.g.id, UV, { name: "Dinner at Bastian", category: "food", amount: "6400", splitType: "shares", shares: { [UV]: "0.55", [UR]: "0.45" }, date: day(4) });
await add(us.g.id, UR, { name: "Electricity", category: "bills", amount: "1900", splitType: "shares", shares: { [UV]: "0.55", [UR]: "0.45" }, date: day(9) });
await add(us.g.id, UR, { name: "Movie & popcorn", category: "activities", amount: "1100", splitType: "shares", shares: { [UV]: "0.55", [UR]: "0.45" }, date: day(12) });
const goal = await saveGoalFor(us.g.id, UV, { name: "Bali in March", target: "200000", byDate: "2027-03-15" });
if (goal.ok) {
  await addGoalEntryFor(us.g.id, UV, goal.id, "40000", `seed-goal-v-${Date.now()}`);
  await addGoalEntryFor(us.g.id, UR, goal.id, "32000", `seed-goal-r-${Date.now()}`);
}

const goa = await group("Goa 2025", [{ name: "Varun" }, { name: "Meera" }], { closed: true });
await add(goa.g.id, goa.id("Varun"), { name: "Beach shack lunch", amount: "1800", date: "2026-10-01" }).catch(() => undefined);

writeFileSync(
  ".demo.json",
  JSON.stringify(
    {
      memberships: { [trip.g.id]: V, [flat.g.id]: FV, [us.g.id]: UV, [goa.g.id]: goa.id("Varun") },
      trip: { id: trip.g.id, invite: trip.g.inviteCode, expenseId: snacks.id, ravi: R, me: V },
      flat: { id: flat.g.id, kabir: FK },
      couple: { id: us.g.id, goal: goal.ok ? goal.id : "" },
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
