import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { saveExpense, setExpenseDeleted, setPaymentDeleted, type SaveExpenseInput } from "@/lib/save-expense";
import { loadGroup } from "@/lib/group-data";
import type { RateAnswer } from "@/lib/rate-cache";

// PDF tests review: the long money test checked only that balances add up to
// zero and match a recount from the same stored rows. This one keeps its own,
// separate record of what every balance should be (worked from the inputs,
// not from Loopin's code), and compares after EVERY step. It uses several
// payers, money back, edits, deletes and restores, payments, and foreign
// expenses whose converted amounts are exact by hand.

const rate = (r: string) => async (): Promise<RateAnswer> => ({ ok: true, rate: r, date: "2026-11-11" });
const made: string[] = [];
afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: made } } });
});

type Line = { payers: Record<string, number>; shares: Record<string, number>; refund: boolean; deleted: boolean };

describe("an independent model agrees with Loopin after every step", () => {
  it("400 steps, several payers, money back, THB at an exact rate", { timeout: 300_000 }, async () => {
    const names = ["A", "B", "C", "D", "E"];
    const g = await db.group.create({
      data: { name: "Model", currency: "INR", inviteCode: `model-${Date.now()}`, cardMarkupBp: 300, members: { create: names.map((name) => ({ name })) } },
      include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    made.push(g.id);
    const ids = g.members.map((m) => m.id);

    let seed = 20261111;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const int = (n: number) => Math.floor(rnd() * n);
    const pick = <T,>(xs: T[]) => xs[int(xs.length)];
    const some = () => {
      const s = ids.filter(() => rnd() < 0.5);
      return s.length ? s : [pick(ids)];
    };
    // Split a whole number of paise into n positive-or-zero parts that add up exactly.
    const cut = (total: number, n: number) => {
      const parts: number[] = [];
      let left = total;
      for (let j = 0; j < n - 1; j++) {
        const v = int(left + 1);
        parts.push(v);
        left -= v;
      }
      parts.push(left);
      return parts;
    };
    const rupees = (p: number) => (p / 100).toFixed(2);

    const expenses = new Map<string, Line>();
    const payments = new Map<string, { from: string; to: string; amount: number; deleted: boolean }>();
    const model = () => {
      const net: Record<string, number> = Object.fromEntries(ids.map((x) => [x, 0]));
      for (const e of expenses.values()) {
        if (e.deleted) continue;
        const sign = e.refund ? -1 : 1;
        for (const [m, a] of Object.entries(e.payers)) net[m] += sign * a;
        for (const [m, a] of Object.entries(e.shares)) net[m] -= sign * a;
      }
      for (const p of payments.values()) {
        if (p.deleted) continue;
        net[p.from] += p.amount;
        net[p.to] -= p.amount;
      }
      return net;
    };

    // A rupee expense, worked out fully here: who paid what, who owes what.
    const inrSpec = (): { input: Partial<SaveExpenseInput>; line: Line } => {
      const total = 1 + int(500000); // ₹0.01 – ₹5,000
      const payerIds = ids.filter(() => rnd() < 0.35);
      const payers = payerIds.length ? payerIds : [pick(ids)];
      const paid = cut(total, payers.length);
      const who = some();
      const owed = cut(total, who.length);
      const refund = rnd() < 0.15;
      const line: Line = {
        payers: Object.fromEntries(payers.map((m, j) => [m, paid[j]]).filter(([, a]) => (a as number) > 0)),
        shares: Object.fromEntries(who.map((m, j) => [m, owed[j]]).filter(([, a]) => (a as number) > 0)),
        refund,
        deleted: false,
      };
      // The form only lists payers with something typed; one payer = no multiPay.
      const typedPayers = Object.keys(line.payers);
      const input: Partial<SaveExpenseInput> = {
        amount: rupees(total),
        currency: "INR",
        paidById: typedPayers[0],
        multiPay: typedPayers.length > 1,
        payers: Object.fromEntries(typedPayers.map((m) => [m, rupees(line.payers[m])])),
        forMode: "selected",
        selected: who,
        splitType: "exact",
        exact: Object.fromEntries(who.map((m, j) => [m, rupees(owed[j])])),
        kind: refund ? "refund" : "expense",
      };
      return { input, line };
    };

    // A baht expense on a card. By hand: THB X at ₹2.50 is ₹2.5X, plus the 3%
    // card fee ₹0.075X, so ₹2.575X in all. X is a multiple of 0.40 baht × the
    // number of people, so every amount is whole paise and splits evenly.
    const thbSpec = (): { input: Partial<SaveExpenseInput>; line: Line } => {
      const who = some();
      const k = (1 + int(200)) * who.length; // in 40-satang steps
      const satang = k * 40;
      const total = k * 103; // 40 satang × 2.575 = 103 paise
      const payer = pick(ids);
      return {
        input: { amount: (satang / 100).toFixed(2), currency: "THB", paidById: payer, forMode: "selected", selected: who, splitType: "equal", paymentMethod: "card", markupChoice: "group", rateMode: "manual", manualRate: "2.5" },
        line: { payers: { [payer]: total }, shares: Object.fromEntries(who.map((m) => [m, total / who.length])), refund: false, deleted: false },
      };
    };

    const base = (over: Partial<SaveExpenseInput>): SaveExpenseInput => ({
      groupId: g.id, name: "Step", category: "other", amount: "1", currency: "INR", paidById: ids[0], forMode: "everyone",
      selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
      markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", allowDuplicate: true, ...over,
    });

    let applied = 0;
    for (let i = 0; i < 400; i++) {
      const me = pick(ids);
      const op = rnd();
      if (op < 0.35) {
        const { input, line } = rnd() < 0.2 ? thbSpec() : inrSpec();
        const r = await saveExpense(base({ ...input, name: `S${i}` }), me, rate("2.5"));
        expect(r.ok, `step ${i} add: ${!r.ok ? r.error : ""}`).toBe(true);
        if (r.ok) {
          expenses.set(r.id, line);
          applied++;
          const e = await db.expense.findUniqueOrThrow({ where: { id: r.id } });
          // Exact converted amount, by hand.
          expect(e.amount, `step ${i} amount`).toBe(Object.values(line.payers).reduce((s, a) => s + a, 0));
        }
      } else if (op < 0.5) {
        const live = [...expenses.entries()].filter(([, e]) => !e.deleted);
        if (live.length) {
          const [id] = pick(live);
          const row = await db.expense.findUniqueOrThrow({ where: { id } });
          const { input, line } = inrSpec();
          const r = await saveExpense(base({ ...input, expenseId: id, name: `E${i}`, baseVersion: (row.editedAt ?? row.createdAt).toISOString() }), me, rate("1"));
          expect(r.ok, `step ${i} edit: ${!r.ok ? r.error : ""}`).toBe(true);
          if (r.ok) {
            expenses.set(id, line);
            applied++;
          }
        }
      } else if (op < 0.65) {
        const all = [...expenses.entries()];
        if (all.length) {
          const [id, e] = pick(all);
          const r = await setExpenseDeleted(id, me, !e.deleted);
          if (r.ok) {
            e.deleted = !e.deleted;
            applied++;
          }
        }
      } else if (op < 0.85) {
        const from = pick(ids);
        const to = pick(ids.filter((x) => x !== from));
        const amount = 1 + int(300000);
        const p = await db.payment.create({ data: { groupId: g.id, fromId: from, toId: to, amount, createdById: me } });
        payments.set(p.id, { from, to, amount, deleted: false });
        applied++;
      } else {
        const all = [...payments.entries()];
        if (all.length) {
          const [id, p] = pick(all);
          const r = await setPaymentDeleted(id, me, !p.deleted);
          if (r.ok) {
            p.deleted = !p.deleted;
            applied++;
          }
        }
      }
      const data = (await loadGroup(g.id))!;
      expect(data.net, `balances after step ${i}`).toEqual(model());
    }
    expect(applied).toBeGreaterThan(300);
  });
});
