import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { saveExpense, setExpenseDeleted, setPaymentDeleted, type SaveExpenseInput } from "@/lib/save-expense";
import { undoEvent } from "@/lib/undo";
import { updateGroupBasics, changeGroupCurrency } from "@/lib/group-changes";
import { renameMember, setMemberLeft } from "@/lib/people";
import { settleAllAndClose, planKey } from "@/lib/settle-all";
import { loadGroup } from "@/lib/group-data";
import type { RateAnswer } from "@/lib/rate-cache";

// Found while exploring beyond the original checklist (pre-launch validation,
// 10 Nov 2026):
// 1. Someone who left a group must not be able to change its money or settings
//    (DEF-039).
// 2. Currencies with 3 decimals (KWD) and none (JPY) keep every share exact.
// 3. A long random mix of adds, edits, deletes, restores, payments and undos
//    keeps balances adding up to zero and equal to a recount from scratch.

const rate = (r = "1") => async (): Promise<RateAnswer> => ({ ok: true, rate: r, date: "2026-11-10" });
const base = (groupId: string, paidById: string, over: Partial<SaveExpenseInput> = {}): SaveExpenseInput => ({
  groupId, name: "Dinner", category: "", amount: "900", currency: "INR", paidById, forMode: "everyone",
  selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
  markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
});
const made: string[] = [];
async function group(name: string, currency: string, people: string[]) {
  const g = await db.group.create({
    data: { name, currency, inviteCode: `exp-${name.replace(/\W/g, "")}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, members: { create: people.map((n) => ({ name: n })) } },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  made.push(g.id);
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  return { id: g.id, m: id };
}
afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: made } } });
});

describe("DEF-039: someone who left can't change the group", () => {
  let G = "", a = "", b = "", c = "", exp = "", pay = "", ev = "";
  beforeAll(async () => {
    const g = await group("Left", "INR", ["A", "B", "C"]);
    G = g.id; a = g.m("A"); b = g.m("B"); c = g.m("C");
    // C settles up first (an expense only between A and B), then leaves.
    const r = await saveExpense(base(G, a, { forMode: "selected", selected: [a, b] }), a, rate());
    if (!r.ok) throw new Error(r.error);
    exp = r.id; ev = r.eventId!;
    pay = (await db.payment.create({ data: { groupId: G, fromId: b, toId: a, amount: 10000, createdById: b } })).id;
    const left = await setMemberLeft(G, c, c, true);
    expect(left.ok).toBe(true);
  });
  it("can't delete or restore an expense", async () => {
    expect((await setExpenseDeleted(exp, c, true)).ok).toBe(false);
  });
  it("can't delete a payment", async () => {
    expect((await setPaymentDeleted(pay, c, true)).ok).toBe(false);
  });
  it("can't undo the group's changes", async () => {
    expect((await undoEvent(ev, c)).ok).toBe(false);
  });
  it("can't rename people or change the group's name", async () => {
    expect((await renameMember(G, c, a, "Hacked")).ok).toBe(false);
    expect((await updateGroupBasics(G, c, { name: "Renamed by someone who left", markupBp: 0, secondaryCurrency: "" })).ok).toBe(false);
  });
  it("can't settle everything and close", async () => {
    const data = (await loadGroup(G))!;
    expect((await settleAllAndClose(G, c, planKey(data.transfers))).ok).toBe(false);
  });
  it("can't mark someone else as left", async () => {
    expect((await setMemberLeft(G, c, b, true)).ok).toBe(false);
  });
  it("the group is unchanged, and they can still rejoin themselves", async () => {
    const e = await db.expense.findUniqueOrThrow({ where: { id: exp } });
    expect(e.deletedAt).toBeNull();
    expect((await db.payment.findUniqueOrThrow({ where: { id: pay } })).deletedAt).toBeNull();
    expect((await db.group.findUniqueOrThrow({ where: { id: G } })).name).toBe("Left");
    expect((await setMemberLeft(G, c, c, false)).ok).toBe(true);
  });
});

describe("currencies with 3 decimals and with none", () => {
  it("KWD: 10.125 between 3 is exactly 3.375 each; a 4th decimal is refused", async () => {
    const g = await group("Kuwait", "KWD", ["A", "B", "C"]);
    const r = await saveExpense(base(g.id, g.m("A"), { amount: "10.125", currency: "KWD" }), g.m("A"), rate());
    expect(r.ok).toBe(true);
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id }, include: { shares: true } });
    expect(e.amount).toBe(10125);
    expect(e.shares.map((s) => s.amount).sort()).toEqual([3375, 3375, 3375]);
    expect((await saveExpense(base(g.id, g.m("A"), { amount: "1.0001", currency: "KWD", name: "Too fine" }), g.m("A"), rate())).ok).toBe(false);
  });
  it("KWD: 10 between 3 leaves no fils behind", async () => {
    const g = await group("Kuwait2", "KWD", ["A", "B", "C"]);
    expect((await saveExpense(base(g.id, g.m("A"), { amount: "10", currency: "KWD" }), g.m("A"), rate())).ok).toBe(true);
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id }, include: { shares: true } });
    expect(e.shares.reduce((s, x) => s + x.amount, 0)).toBe(10000);
    expect(Math.max(...e.shares.map((s) => s.amount)) - Math.min(...e.shares.map((s) => s.amount))).toBeLessThanOrEqual(1);
  });
  it("JPY group, ₹1,000 at 1.8 = ¥1,800; ¥1,800 between 7 adds up exactly", async () => {
    const g = await group("Tokyo", "JPY", ["A", "B", "C", "D", "E", "F", "G"]);
    const r = await saveExpense(base(g.id, g.m("A"), { amount: "1000", currency: "INR", rateMode: "manual", manualRate: "1.8" }), g.m("A"), rate("1.8"));
    expect(r.ok).toBe(true);
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id }, include: { shares: true } });
    expect(e.amount).toBe(1800);
    expect(e.shares.reduce((s, x) => s + x.amount, 0)).toBe(1800);
    const data = (await loadGroup(g.id))!;
    expect(Object.values(data.net).reduce((s, x) => s + x, 0)).toBe(0);
  });
  it("changing a group from INR to KWD keeps balances adding up to zero", async () => {
    const g = await group("Switch", "INR", ["A", "B", "C"]);
    for (const amt of ["1000", "333.33", "50.01"]) expect((await saveExpense(base(g.id, g.m("A"), { amount: amt, name: `x${amt}` }), g.m("A"), rate())).ok).toBe(true);
    const r = await changeGroupCurrency(g.id, g.m("A"), "KWD", "0.0037");
    expect(r.ok).toBe(true);
    const data = (await loadGroup(g.id))!;
    expect(data.group.currency).toBe("KWD");
    expect(Object.values(data.net).reduce((s, x) => s + x, 0)).toBe(0);
  });
});

describe("a long random mix keeps the books straight", () => {
  it("400 random changes: balances always add up to zero and match a recount", { timeout: 240_000 }, async () => {
    const people = ["A", "B", "C", "D", "E"];
    const g = await group("Fuzz", "INR", people);
    const ids = people.map(g.m);
    let seed = 20261110;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    const events: string[] = [];
    let applied = 0;
    for (let i = 0; i < 400; i++) {
      const me = pick(ids);
      const op = rnd();
      const amount = (Math.floor(rnd() * 500000) / 100 + 0.01).toFixed(2);
      let r: { ok: boolean; eventId?: string } = { ok: false };
      if (op < 0.4) {
        const kind = pick(["equal", "selected", "one", "exact", "percent", "shares", "refund", "thb"]);
        const sel = ids.filter(() => rnd() < 0.6);
        const who = sel.length >= 1 ? sel : [me];
        const over: Partial<SaveExpenseInput> =
          kind === "selected" ? { forMode: "selected", selected: who }
          : kind === "one" ? { forMode: "one", onePersonId: pick(ids) }
          : kind === "exact" ? (() => { const total = Math.round(Number(amount) * 100); const parts = who.map(() => 0); let left = total; who.forEach((_, j) => { const v = j === who.length - 1 ? left : Math.floor(rnd() * left); parts[j] = v; left -= v; }); return { forMode: "selected" as const, selected: who, splitType: "exact" as const, exact: Object.fromEntries(who.map((w, j) => [w, (parts[j] / 100).toFixed(2)])) }; })()
          : kind === "percent" ? (() => { let left = 100; const p: Record<string, string> = {}; who.forEach((w, j) => { const v = j === who.length - 1 ? left : Math.floor(rnd() * left); p[w] = String(v); left -= v; }); return { forMode: "selected" as const, selected: who, splitType: "percent" as const, percent: p }; })()
          : kind === "shares" ? { forMode: "selected" as const, selected: who, splitType: "shares" as const, shares: Object.fromEntries(who.map((w) => [w, String(1 + Math.floor(rnd() * 3))])) }
          : kind === "refund" ? { kind: "refund" as const }
          : kind === "thb" ? { currency: "THB", rateMode: "manual" as const, manualRate: "2.5734", paymentMethod: "card" as const }
          : {};
        r = await saveExpense(base(g.id, pick(ids), { amount, name: `F${i}`, allowDuplicate: true, ...over }), me, rate("2.5734"));
      } else if (op < 0.55) {
        const list = await db.expense.findMany({ where: { groupId: g.id, deletedAt: null }, select: { id: true, editedAt: true, createdAt: true } });
        if (list.length) {
          const e = pick(list);
          r = await saveExpense(base(g.id, pick(ids), { expenseId: e.id, amount, name: `E${i}`, rateMode: "keep", baseVersion: (e.editedAt ?? e.createdAt).toISOString(), allowDuplicate: true }), me, rate());
        }
      } else if (op < 0.68) {
        const list = await db.expense.findMany({ where: { groupId: g.id }, select: { id: true, deletedAt: true } });
        if (list.length) { const e = pick(list); r = await setExpenseDeleted(e.id, me, !e.deletedAt); }
      } else if (op < 0.85) {
        const from = pick(ids), to = pick(ids.filter((x) => x !== from));
        const p = await db.payment.create({ data: { groupId: g.id, fromId: from, toId: to, amount: Math.floor(rnd() * 200000) + 1, createdById: me } });
        r = { ok: Boolean(p) };
      } else if (op < 0.92) {
        const list = await db.payment.findMany({ where: { groupId: g.id }, select: { id: true, deletedAt: true } });
        if (list.length) { const p = pick(list); r = await setPaymentDeleted(p.id, me, !p.deletedAt); }
      } else if (events.length) {
        r = await undoEvent(events.pop()!, me);
      }
      if (r.ok) applied++;
      if (r.eventId) events.push(r.eventId);
      if (i % 20 === 19) {
        const data = (await loadGroup(g.id))!;
        expect(Object.values(data.net).reduce((s, x) => s + x, 0)).toBe(0);
        // Recount from the stored shares and payments only.
        const ex = await db.expense.findMany({ where: { groupId: g.id, deletedAt: null }, include: { shares: true } });
        const pays = await db.payment.findMany({ where: { groupId: g.id, deletedAt: null } });
        const recount: Record<string, number> = Object.fromEntries(ids.map((x) => [x, 0]));
        for (const e of ex) {
          // Money back runs the other way: whoever got it owes the people it's shared with.
          const sign = e.kind === "refund" ? -1 : 1;
          expect(e.payers).toBe(""); // this mix uses one payer
          for (const s of e.shares) recount[s.memberId] -= sign * s.amount;
          recount[e.paidById] += sign * e.amount;
        }
        for (const p of pays) { recount[p.fromId] += p.amount; recount[p.toId] -= p.amount; }
        expect(data.net).toEqual(recount);
        for (const e of ex) expect(e.shares.reduce((s, x) => s + x.amount, 0)).toBe(e.amount);
      }
    }
    expect(applied).toBeGreaterThan(250);
  });
});

describe("DEF-040: one person can't use up the day's emails", () => {
  it("after 20 invite emails in a day, more are refused with a clear note", async () => {
    const { inviteByEmail, INVITE_EMAILS_PER_DAY } = await import("@/lib/invites");
    const g = await group("Spam", "INR", ["A"]);
    const s = Date.now();
    const emails = Array.from({ length: INVITE_EMAILS_PER_DAY + 5 }, (_, i) => `cap${i}-${s}@x.loopin.test`);
    const first = await inviteByEmail(g.id, g.m("A"), emails.slice(0, 20).join(","), "http://localhost:3000");
    const second = await inviteByEmail(g.id, g.m("A"), emails.slice(20).join(","), "http://localhost:3000");
    const capped = [...first.bad, ...second.bad].filter((b) => /invite emails today/.test(b));
    expect(capped.length).toBe(5);
    expect(capped.every((b) => emails.slice(INVITE_EMAILS_PER_DAY).some((e) => b.startsWith(e)))).toBe(true);
  });
});

describe("DEF-041: being added by someone doesn't open your passport to them", () => {
  it("their passport stays hidden until they open the group", async () => {
    const { addRegistered } = await import("@/lib/invites");
    const { canSeePassport, passportFriends } = await import("@/lib/passport-db");
    const s = Date.now();
    const victim = await db.account.create({ data: { email: `victim-${s}@x.loopin.test`, name: "Vic", places: JSON.stringify([{ c: "TH", city: "Phuket" }]) } });
    const stranger = await db.account.create({ data: { email: `stranger-${s}@x.loopin.test`, name: "Stan" } });
    try {
      const g = await group("Forced", "INR", ["Stan"]);
      await db.member.update({ where: { id: g.m("Stan") }, data: { accountId: stranger.id, claimedAt: new Date() } });
      const r = await addRegistered(g.id, g.m("Stan"), victim.id, "http://localhost:3000");
      expect(r.ok).toBe(true);
      expect((await canSeePassport(stranger.id, victim.id)).ok).toBe(false);
      expect((await passportFriends(stranger.id)).some((f) => f.accountId === victim.id)).toBe(false);
      // Victim opens the group once: from then on it's a shared group like any other.
      await db.member.updateMany({ where: { groupId: g.id, accountId: victim.id }, data: { seenAt: new Date() } });
      expect((await canSeePassport(stranger.id, victim.id)).ok).toBe(true);
    } finally {
      await db.account.deleteMany({ where: { id: { in: [victim.id, stranger.id] } } });
    }
  });
});

// NEG-07 (outside review): a 300-letter name must save, shortened to 80.
describe("a very long expense name", () => {
  it("saves, cut to 80 characters", async () => {
    const g = await group("Long", "INR", ["A", "B"]);
    const name = `Audit long ${"x".repeat(290)}`;
    const r = await saveExpense(base(g.id, g.m("A"), { name, amount: "50" }), g.m("A"), rate());
    expect(r.ok).toBe(true);
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id } });
    expect(e.description).toBe(name.slice(0, 80));
    expect(e.amount).toBe(5000);
  });
});
