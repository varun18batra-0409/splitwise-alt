import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { netBalances } from "@/lib/balances";
import { smartSettle } from "@/lib/settle";
import { addExpenseChecks } from "@/lib/add-expense-checks";
import { cleanOldKeys } from "@/lib/offline/key-cleanup";
import { sendDraft } from "@/lib/offline/send";
import { readDraft } from "@/lib/offline/validate";
import { refusalCodeOf } from "@/lib/offline/refusal";
import { CARD_FEE_CHANGED, CURRENCY_CHANGED, NO_RATE, OTHER_PERSON, PAIR_REFUSED, PEOPLE_JOINED, PEOPLE_LEFT } from "@/lib/offline/words";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import type { DraftInput } from "@/lib/offline/types";
import type { RateAnswer } from "@/lib/rate-cache";
import { checkBooks } from "./helpers/money-invariants";

// Expenses added offline are sent through sendDraft, which calls saveExpense (the same function the Add screen uses).
// Every expected number below is worked out by hand in the comment above it. 1 rupee = 100 paise.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groups: string[] = [];
const keys: string[] = [];
let n = 0;
const newKey = () => {
  const k = `off-${stamp}-${(n++).toString().padStart(3, "0")}`;
  keys.push(k);
  return k;
};
const same: (from: string, to: string, day: string) => Promise<RateAnswer> = async (_f, _t, day) => ({ ok: true, rate: "1", date: day });

// A group with the named people, added one after another so "first listed" is always the same person.
async function mkGroup(names: string[], over: { currency?: string; cardMarkupBp?: number; type?: string } = {}) {
  const g = await db.group.create({ data: { name: "Goa trip", currency: over.currency ?? "INR", cardMarkupBp: over.cardMarkupBp ?? 0, type: over.type ?? "trip", inviteCode: `off-${stamp}-${groups.length}` } });
  groups.push(g.id);
  const ids: string[] = [];
  for (const [i, name] of names.entries()) {
    const m = await db.member.create({ data: { groupId: g.id, name, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) } });
    ids.push(m.id);
  }
  return { id: g.id, ids };
}

// What the phone would have kept: only what was typed, plus what it had seen.
function draftOf(g: { id: string; ids: string[] }, over: Partial<DraftInput> = {}): DraftInput {
  return {
    key: newKey(), groupId: g.id, memberId: g.ids[0], day: new Date().toISOString().slice(0, 10), typedAt: Date.now(),
    name: "Taxi", amount: "1200", currency: "INR", category: "", paidById: g.ids[0], multiPay: false, payers: {},
    forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, shares: {},
    kind: "expense", paymentMethod: "cash", markupChoice: "group", markupCustom: "", notes: "", rateMode: "auto", manualRate: "",
    seen: { baseCurrency: "INR", cardMarkupBp: 0, activeMemberIds: g.ids, snapshotAt: new Date().toISOString() },
    ...over,
  };
}
const send = (d: DraftInput, me: string | undefined, o: { dryRun?: boolean; allowDuplicate?: boolean; rateOn?: typeof same } = {}) => sendDraft(d, me, { rateOn: same, ...o });
const counts = async (groupId: string) => ({
  expenses: await db.expense.count({ where: { groupId } }),
  events: await db.groupEvent.count({ where: { groupId, kind: "expense_added" } }),
});

afterAll(async () => {
  await db.requestKey.deleteMany({ where: { key: { in: keys } } });
  for (const id of groups) await db.group.delete({ where: { id } }).catch(() => {});
});

describe("an even split sent from the phone", () => {
  it("₹1,200 for 6 people: 120000 paise, 6 shares of 20000, balances A +100000 and B to F -20000, settle-up leaves 0", async () => {
    const g = await mkGroup(["A", "B", "C", "D", "E", "F"]);
    const d = draftOf(g);
    const r = await send(d, g.ids[0]);
    expect(r.status).toBe("added");
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id }, include: { shares: true } });
    expect(e.amount).toBe(120000); // ₹1,200 = 1200 x 100
    expect(e.shares.map((s) => s.amount)).toEqual([20000, 20000, 20000, 20000, 20000, 20000]); // 120000 / 6
    expect(e.shares.reduce((s, x) => s + x.amount, 0)).toBe(e.amount);
    // A paid 120000 and owes 20000: +100000. Each of the other five owes 20000. 100000 - 5 x 20000 = 0.
    const net = await checkBooks(g.id);
    expect(net[g.ids[0]]).toBe(100000);
    for (const id of g.ids.slice(1)) expect(net[id]).toBe(-20000);
    // Settle up: five payments of ₹200 (20000) to A ...
    const transfers = smartSettle(net);
    expect(transfers).toHaveLength(5);
    expect(transfers.every((t) => t.to === g.ids[0] && t.amount === 20000)).toBe(true);
    // ... and once they are paid, everybody is at exactly 0.
    for (const t of transfers) await db.payment.create({ data: { groupId: g.id, fromId: t.from, toId: t.to, amount: t.amount } });
    const all = await db.group.findUniqueOrThrow({ where: { id: g.id }, include: { expenses: { include: { shares: true } }, payments: true } });
    const after = netBalances(g.ids, all.expenses, all.payments);
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
  });
});

describe("the same key twice", () => {
  it("the second send returns the same expense: 1 expense, 1 history line, the same balances", async () => {
    const g = await mkGroup(["A", "B", "C", "D", "E", "F"]);
    const d = draftOf(g);
    const first = await send(d, g.ids[0]);
    const second = await send(d, g.ids[0]);
    expect(first.status).toBe("added");
    expect(second).toEqual(first); // same id
    expect(await counts(g.id)).toEqual({ expenses: 1, events: 1 });
    const net = await checkBooks(g.id);
    expect(net[g.ids[0]]).toBe(100000);
  });
  it("two sends at the same moment with the same key also give one expense", async () => {
    const g = await mkGroup(["A", "B"]);
    const d = draftOf(g, { amount: "500" });
    const [x, y] = await Promise.all([send(d, g.ids[0]), send(d, g.ids[0])]);
    expect(x.status).toBe("added");
    expect(y.status).toBe("added");
    expect(await counts(g.id)).toEqual({ expenses: 1, events: 1 });
    expect(await db.requestKey.count({ where: { key: d.key } })).toBe(1);
  });
});

describe("an uneven split", () => {
  it("₹100 among A, B, C: 3334 + 3333 + 3333 = 10000, the extra paisa to the first listed", async () => {
    const g = await mkGroup(["A", "B", "C", "D"]);
    const [a, b, c, dd] = g.ids;
    // Everyone still in the group is the four people the phone saw; the expense is only for A, B and C.
    const d = draftOf(g, { amount: "100", forMode: "selected", selected: [a, b, c], paidById: dd });
    expect((await send(d, dd)).status).toBe("refused"); // wrong person signed in: nothing saved (see below)
    const ok = await send({ ...d, memberId: dd }, dd);
    expect(ok.status).toBe("added");
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id }, include: { shares: true } });
    const by = Object.fromEntries(e.shares.map((s) => [s.memberId, s.amount]));
    expect(by).toEqual({ [a]: 3334, [b]: 3333, [c]: 3333 });
    expect(e.shares.reduce((s, x) => s + x.amount, 0)).toBe(10000);
    await checkBooks(g.id);
  });
});

describe("another currency with a card fee", () => {
  it("THB 1,000 by card at 3%, 2 people, rate 2.5 for 17 Nov: 250000 + 7500 = 257500, 128750 each, rate asked for 17 Nov", async () => {
    const g = await mkGroup(["A", "B"], { cardMarkupBp: 300 });
    const asked: string[] = [];
    const rateOn = async (_f: string, _t: string, day: string): Promise<RateAnswer> => {
      asked.push(day);
      return { ok: true, rate: "2.5", date: day };
    };
    const d = draftOf(g, { amount: "1000", currency: "THB", paymentMethod: "card", day: "2026-11-17", seen: { baseCurrency: "INR", cardMarkupBp: 300, activeMemberIds: g.ids, snapshotAt: "2026-11-17T08:00:00.000Z" } });
    const r = await send(d, g.ids[0], { rateOn });
    expect(r.status).toBe("added");
    expect(asked).toEqual(["2026-11-17"]); // the day it was spent, not the day it was sent
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id }, include: { shares: true } });
    expect(e.originalAmount).toBe(100000); // THB 1,000.00
    expect(e.convertedAmount).toBe(250000); // 100000 x 2.5
    expect(e.markupAmount).toBe(7500); // 3% of 250000
    expect(e.amount).toBe(257500); // 250000 + 7500
    expect(e.shares.map((s) => s.amount)).toEqual([128750, 128750]); // 257500 / 2
    expect(e.rateDate).toBe("2026-11-17");
    await checkBooks(g.id);
  });
  it("no rate for that day: refused, asks for a rate, nothing saved, no key used; a rate typed by hand is then added with the same key", async () => {
    const g = await mkGroup(["A", "B"]);
    const d = draftOf(g, { amount: "1000", currency: "THB", day: "2026-11-17" });
    const none = async (): Promise<RateAnswer> => ({ ok: false, reason: "unavailable", message: "x" });
    const r = await send(d, g.ids[0], { rateOn: none });
    expect(r).toEqual({ status: "refused", code: "no-rate", reason: NO_RATE("17 Nov 2026") });
    expect(await counts(g.id)).toEqual({ expenses: 0, events: 0 });
    expect(await db.requestKey.count({ where: { key: d.key } })).toBe(0);
    // Open and fix: enter the rate (2.5): THB 1,000 = 100000 x 2.5 = 250000, no fee (cash, 0%): 125000 each.
    const fixed = await send({ ...d, rateMode: "manual", manualRate: "2.5" }, g.ids[0], { rateOn: none });
    expect(fixed.status).toBe("added");
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id } });
    expect(e.amount).toBe(250000);
    expect(e.rateSource).toBe("manual");
  });
});

describe("people who changed while it was on the phone", () => {
  it("F left: the ₹1,200 'everyone' draft is refused, nothing changes, the key is not used, and works after Open and fix", async () => {
    const g = await mkGroup(["A", "B", "C", "D", "E", "F"]);
    // Before: ₹600 paid by A, split 6 ways: A +50000, B to F -10000 each.
    const base: SaveExpenseInput = { groupId: g.id, name: "Lunch", category: "", amount: "600", currency: "INR", paidById: g.ids[0], forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "" };
    expect((await saveExpense(base, g.ids[0], same)).ok).toBe(true);
    const before = await checkBooks(g.id);
    expect(before[g.ids[0]]).toBe(50000);
    expect(g.ids.slice(1).every((id) => before[id] === -10000)).toBe(true);
    // F leaves (square, so allowed to leave) ... she owes 10000, so settle her first.
    await db.payment.create({ data: { groupId: g.id, fromId: g.ids[5], toId: g.ids[0], amount: 10000 } });
    await db.member.update({ where: { id: g.ids[5] }, data: { leftAt: new Date() } });
    const c0 = await counts(g.id);
    const d = draftOf(g);
    const r = await send(d, g.ids[0]);
    expect(r).toEqual({ status: "refused", code: "people-left", reason: PEOPLE_LEFT });
    expect(await counts(g.id)).toEqual(c0);
    expect(await db.requestKey.count({ where: { key: d.key } })).toBe(0);
    const net = await checkBooks(g.id);
    expect(net[g.ids[0]]).toBe(40000); // 50000 - F's 10000 payment
    // Open and fix: five people now. 120000 / 5 = 24000 each. Same key.
    const fixed = { ...d, seen: { ...d.seen, activeMemberIds: g.ids.slice(0, 5) } };
    expect((await send(fixed, g.ids[0])).status).toBe("added");
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id, description: "Taxi" }, include: { shares: true } });
    expect(e.shares.map((s) => s.amount)).toEqual([24000, 24000, 24000, 24000, 24000]);
    await checkBooks(g.id);
  });
  it("G joined: refused, not saved as 120000 / 7 (six people 17143 and one 17142)", async () => {
    // For the record, what a quiet 7-way split would have been: 120000 = 7 x 17142 + 6, so six people 17143 and one 17142: 6 x 17143 + 17142 = 120000.
    expect(6 * 17143 + 17142).toBe(120000);
    const g = await mkGroup(["A", "B", "C", "D", "E", "F"]);
    const d = draftOf(g);
    await db.member.create({ data: { groupId: g.id, name: "G", createdAt: new Date(Date.UTC(2026, 0, 2)) } });
    const r = await send(d, g.ids[0]);
    expect(r).toEqual({ status: "refused", code: "people-joined", reason: PEOPLE_JOINED });
    expect(await counts(g.id)).toEqual({ expenses: 0, events: 0 });
    expect(await db.requestKey.count({ where: { key: d.key } })).toBe(0);
  });
});

describe("other refusals change nothing", () => {
  const nothing = async (g: { id: string }, d: DraftInput) => {
    expect(await counts(g.id)).toEqual({ expenses: 0, events: 0 });
    expect(await db.requestKey.count({ where: { key: d.key } })).toBe(0);
  };
  it("the currency changed (INR to USD)", async () => {
    const g = await mkGroup(["A", "B"]);
    const d = draftOf(g);
    await db.group.update({ where: { id: g.id }, data: { currency: "USD" } });
    expect(await send(d, g.ids[0])).toEqual({ status: "refused", code: "currency", reason: CURRENCY_CHANGED });
    await nothing(g, d);
  });
  it("the card fee changed (0% to 3%)", async () => {
    const g = await mkGroup(["A", "B"]);
    const d = draftOf(g);
    await db.group.update({ where: { id: g.id }, data: { cardMarkupBp: 300 } });
    expect(await send(d, g.ids[0])).toEqual({ status: "refused", code: "card-fee", reason: CARD_FEE_CHANGED });
    await nothing(g, d);
  });
  it("the group was closed", async () => {
    const g = await mkGroup(["A", "B"]);
    const d = draftOf(g);
    await db.group.update({ where: { id: g.id }, data: { closed: true } });
    const r = await send(d, g.ids[0]);
    expect(r.status === "refused" && r.code).toBe("closed");
    await nothing(g, d);
  });
  it("the group was deleted", async () => {
    const g = await mkGroup(["A", "B"]);
    const d = draftOf(g);
    await db.group.update({ where: { id: g.id }, data: { deletedAt: new Date() } });
    const r = await send(d, g.ids[0]);
    expect(r.status === "refused" && r.code).toBe("deleted");
    await nothing(g, d);
  });
  it("the person left the group", async () => {
    const g = await mkGroup(["A", "B"]);
    const d = draftOf(g);
    await db.member.update({ where: { id: g.ids[0] }, data: { leftAt: new Date() } });
    const r = await send(d, g.ids[0]);
    expect(r.status === "refused" && r.code).toBe("left");
    await nothing(g, d);
  });
  it("a different member is signed in: never saved as them; nobody signed in: it keeps waiting", async () => {
    const g = await mkGroup(["A", "B"]);
    const d = draftOf(g);
    expect(await send(d, g.ids[1])).toEqual({ status: "refused", code: "other-person", reason: OTHER_PERSON });
    expect((await send(d, undefined)).status).toBe("later");
    await nothing(g, d);
  });
  it("a pair (two-person group) is refused by the shared checks", async () => {
    const g = await mkGroup(["A", "B"], { type: "direct" });
    const r = await addExpenseChecks({ ip: `offline-test-${stamp}`, groupId: g.id, currency: "INR", editing: false, offline: true });
    expect(r).toEqual({ ok: false, error: PAIR_REFUSED, pair: true });
  });
  it("a day more than a day and a half ahead", async () => {
    const g = await mkGroup(["A", "B"]);
    const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const d = draftOf(g, { day });
    const r = await send(d, g.ids[0]);
    expect(r.status === "refused" && r.code).toBe("date");
    await nothing(g, d);
  });
});

describe("a dry run", () => {
  it("writes nothing (no expense, no history line, no key) and answers ok; after a real send it says already added", async () => {
    const g = await mkGroup(["A", "B"]);
    const d = draftOf(g);
    expect(await send(d, g.ids[0], { dryRun: true })).toEqual({ status: "ok" });
    expect(await counts(g.id)).toEqual({ expenses: 0, events: 0 });
    expect(await db.requestKey.count({ where: { key: d.key } })).toBe(0);
    const real = await send(d, g.ids[0]);
    expect(real.status).toBe("added");
    expect(await send(d, g.ids[0], { dryRun: true })).toEqual(real); // already added, with its id
    expect(await counts(g.id)).toEqual({ expenses: 1, events: 1 });
  });
  it("asks the duplicate question without saving; 'Different, keep both' then saves a second one", async () => {
    const g = await mkGroup(["A", "B"]);
    const first = draftOf(g, { name: "Breakfast", amount: "900" });
    expect((await send(first, g.ids[1])).status).toBe("refused"); // B is not A: a different person, nothing saved
    expect((await send({ ...first, memberId: g.ids[1] }, g.ids[1])).status).toBe("added");
    const second = draftOf(g, { name: "breakfast", amount: "900" });
    const dry = await send(second, g.ids[0], { dryRun: true });
    expect(dry.status).toBe("duplicate");
    if (dry.status === "duplicate") {
      expect(dry.dup.description).toBe("Breakfast");
      expect(dry.dup.by).toBe("B");
      expect(dry.dup.byId).toBe(g.ids[1]);
      expect(typeof dry.dup.addedAt).toBe("string");
    }
    expect((await counts(g.id)).expenses).toBe(1);
    expect((await send(second, g.ids[0], { allowDuplicate: true })).status).toBe("added");
    expect((await counts(g.id)).expenses).toBe(2);
  });
});

describe("one-time key clean-up", () => {
  it("an off- key older than 30 days survives; an ordinary key that old does not; an off- key older than 400 days goes", async () => {
    const now = new Date("2026-12-01T00:00:00Z");
    const old = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const rows = [
      { key: `off-${stamp}-clean-old`, createdAt: old(45) },
      { key: `plain-${stamp}-clean-old-key`, createdAt: old(45) },
      { key: `off-${stamp}-clean-ancient`, createdAt: old(401) },
    ];
    for (const r of rows) await db.requestKey.create({ data: r });
    keys.push(...rows.map((r) => r.key));
    await cleanOldKeys(now);
    const left = (await db.requestKey.findMany({ where: { key: { in: rows.map((r) => r.key) } } })).map((r) => r.key);
    expect(left).toEqual([`off-${stamp}-clean-old`]);
  });
});

describe("what the server will read from the phone", () => {
  it("a good draft is read; a damaged one, or one without an off- key, is not", () => {
    const g = { id: "g1", ids: ["m1", "m2"] };
    const good = draftOf(g);
    expect(readDraft(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(readDraft({ ...good, key: "plain-key-0123456789" })).toBeNull();
    expect(readDraft({ ...good, amount: 12 })).toBeNull();
    expect(readDraft({ ...good, forMode: "nobody" })).toBeNull();
    expect(readDraft(null)).toBeNull();
  });
  it("refusal sentences map to their codes", () => {
    expect(refusalCodeOf(PEOPLE_JOINED)).toBe("people-joined");
    expect(refusalCodeOf("This group is closed. Reopen it to add or change expenses.")).toBe("closed");
    expect(refusalCodeOf("Pick who paid.")).toBe("invalid");
  });
});
