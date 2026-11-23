import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { loadGroup } from "@/lib/group-data";
import { amountError, badCommasText, MAX_MINOR, overCap, parseAmount } from "@/lib/money";
import { detectFormat, guessMe, LOOPIN_LABEL } from "@/lib/import-formats";
import { importSplitwise } from "@/lib/splitwise-import";
import { createPayment, PaymentTooBig, paymentTooBigText } from "@/lib/payments";
import { recordPaymentCore } from "@/lib/pay-record";
import { markAllPaid } from "@/lib/settle-all";
import { settleAcrossCore, isClearing } from "@/lib/cross-settle-db";
import { withClearing } from "@/lib/clearing-db";
import { CLEARING_TYPE, groupCsv } from "@/lib/csv";
import { STALE_KEY_ERROR } from "@/lib/once";
import { editAmountInput, groupingFor, regroupAmount } from "@/lib/amount-input";

// Batch 7: imports. Money is whole paise/cents; every expected number is worked out by hand in the test.
// Database tests use the throwaway test database only (pattern: outside-audit-k.test.ts).

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;
afterAll(async () => {
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});
async function account(name: string) {
  const a = await db.account.create({ data: { email: `b7-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}

describe("G30: commas in amounts", () => {
  const cases: [string, string, number | null][] = [
    ["1,2,3", "INR", null], // not a grouping
    ["1,23,456", "INR", 12_345_600], // Indian grouping: 123456 rupees = 12,345,600 paise
    ["123,456", "INR", 12_345_600], // Western grouping, same number
    ["12,50", "INR", 1250], // decimal comma stays: 12.50
    ["1,000.50", "INR", 100_050],
    ["12,345", "KWD", 12_345_000], // a comma then 3 digits is thousands in every currency: 12,345.000 dinar
    ["12.345", "KWD", 12_345], // 12.345 dinar = 12,345 fils
    ["12,5", "KWD", 12_500], // decimal comma: 12.5 dinar
    ["1,234,567", "JPY", 1_234_567],
  ];
  for (const [text, cur, want] of cases) {
    it(`"${text}" in ${cur} is ${want === null ? "refused" : want}`, () => {
      expect(parseAmount(text, cur)).toBe(want);
    });
  }
  it("more bad groupings are refused, and the message says what to write", () => {
    for (const t of ["12,3456", "1,2345", "12,34,5", "1,,000", ",500", "1,000,00", "1,000.5,0"]) expect(parseAmount(t, "INR"), t).toBeNull();
    expect(amountError("1,2,3", "INR")).toBe("Check the commas: write 1,23,456 or 123456.");
    expect(badCommasText("INR")).toBe("Check the commas: write 1,23,456 or 123456.");
    expect(amountError("1,2,3", "USD")).toBe("Check the commas: write 123,456 or 123456.");
    expect(amountError("1,2,3", "KWD")).toBe("Check the commas: write 123,456 or 123456.");
    // overCap: a well-formed amount above the cap (not a typo)
    expect(overCap("2,000,000,001", "VND")).toBe(true);
    expect(overCap("2,000,000,000", "VND")).toBe(false);
    expect(overCap("2400000000", "VND")).toBe(true);
    expect(overCap("1,2,3", "VND")).toBe(false);
    expect(overCap("abc", "VND")).toBe(false);
    expect(overCap("20000000.01", "INR")).toBe(true);
    // A decimal comma in yen is still the old message (no decimals), and a good amount in a 3-decimal currency is read normally.
    expect(amountError("100,5", "JPY")).toBe("JPY amounts are whole numbers: no decimals.");
    expect(parseAmount("1,234.5", "KWD")).toBe(1_234_500);
    expect(parseAmount("1,234,567", "KWD")).toBe(1_234_567_000); // two commas: not ambiguous
  });
  it("whatever the amount box writes parses back to the digits typed (live comma formatting)", () => {
    const typed = ["1", "12", "123", "1234", "12345", "123456", "1234567", "12345678", "123456789"];
    for (const cur of ["INR", "USD", "EUR", "THB", "JPY", "VND", "KWD", "BHD", "OMR", "JOD", "TND"]) {
      for (const digits of typed) {
        const shown = regroupAmount(digits, cur);
        expect(parseAmount(shown, cur), `${shown} in ${cur}`).toBe(parseAmount(digits, cur));
        // Typed one key at a time, as the box does.
        let box = "";
        for (const ch of digits) box = editAmountInput(box + ch, (box + ch).length, cur, { prev: box }).value;
        expect(box, `${digits} in ${cur}`).toBe(shown);
        expect(parseAmount(box, cur)).toBe(parseAmount(digits, cur));
      }
    }
    expect(regroupAmount("1234567", "INR")).toBe("12,34,567");
    expect(regroupAmount("123456", "INR")).toBe("1,23,456");
    expect(regroupAmount("1234567", "USD")).toBe("1,234,567");
    // 3-decimal currencies group with commas like any other: the box writes "12,345" and that reads as 12,345.000.
    expect(groupingFor("KWD")).toBe("thousands");
    expect(regroupAmount("12345", "KWD")).toBe("12,345");
    expect(parseAmount("12,345", "KWD")).toBe(12_345_000);
    expect(regroupAmount("12345.678", "KWD")).toBe("12,345.678");
    // With decimals too.
    expect(parseAmount(regroupAmount("1234567.5", "INR"), "INR")).toBe(123_456_750);
    expect(parseAmount(regroupAmount("1234567.5", "USD"), "USD")).toBe(123_456_750);
  });
});

describe("G28: the Loopin download label", () => {
  it("says what comes over and what does not", () => {
    const csv = "Date,Type,Description,Notes,Category,Paid by,Amount (INR),Original amount,Original currency,Exchange rate,Card markup (INR),Paid with,Status,Ann's share (INR),Ben's share (INR)\r\n2026-10-18,Expense,Flight,,Transport,Ann,1000.00,,,,,,,500.00,500.00\r\n";
    const d = detectFormat(csv);
    expect(d).toMatchObject({ ok: true, format: "loopin" });
    if (d.ok) expect(d.label).toBe("Loopin download (balances only: solo expenses, notes and card fees don’t come over)");
    expect(LOOPIN_LABEL).toBe("Loopin download (balances only: solo expenses, notes and card fees don’t come over)");
  });
});

describe("G33: your name is pre-picked only on an exact, unique match", () => {
  it("Ravi Kumar is not guessed from Ravi Sharma or Ravi Rao", () => {
    expect(guessMe(["Asha", "Ravi Sharma", "Ravi Rao"], "Ravi Kumar")).toBe(-1);
  });
  it("Ravi Kumar in the file is picked, ignoring capitals and extra spaces", () => {
    expect(guessMe(["Asha", "Ravi Sharma", "Ravi Kumar"], "Ravi Kumar")).toBe(2);
    expect(guessMe(["Asha", "  ravi   KUMAR "], "Ravi Kumar")).toBe(1);
  });
  it("two exact Ravi Kumar picks nobody; no name picks nobody; a first name alone is not enough", () => {
    expect(guessMe(["Ravi Kumar", "Asha", "ravi kumar"], "Ravi Kumar")).toBe(-1);
    expect(guessMe(["Ravi Kumar"], "")).toBe(-1);
    expect(guessMe(["Ravi"], "Ravi Kumar")).toBe(-1);
  });
  it("the form keeps Bring it over off until someone is picked, and carries the retry key", () => {
    const form = readFileSync("src/components/SplitwiseImport.tsx", "utf8");
    expect(form).toContain("disabled={meNow < 0 || !name.trim()}");
    expect(form).toContain('<FreshKeyInput name="rid" />');
    expect(form).toContain("guessMe(ok.people, yourName)");
  });
});

describe("L23/G34: a retried import returns the same group", () => {
  const FILE = [
    "Date,Description,Category,Cost,Currency,Asha,Ravi,Meera",
    "2026-09-01,Dinner,Dining out,900.00,INR,600.00,-300.00,-300.00", // 90,000 paise: Asha paid, 30,000 each
    "2026-09-02,Ravi paid Asha,Payment,300.00,INR,-300.00,300.00,0.00", // Ravi pays Asha 30,000
    "",
  ].join("\r\n");
  const balancesOfGroup = async (groupId: string) => {
    const g = await loadGroup(groupId);
    const members = await db.member.findMany({ where: { groupId } });
    return { net: Object.fromEntries(members.map((m) => [m.name, g!.net[m.id]])), sum: Object.values(g!.net).reduce((t, x) => t + x, 0) };
  };

  it("the same key twice: one group, one expense, one payment; Asha +30,000, Ravi 0, Meera -30,000, sum 0", async () => {
    const acc = await account("Asha");
    const key = `imp-same-${stamp}-aaaa`;
    const input = { text: FILE, groupName: "Retry trip", type: "trip", me: 0, key };
    const first = await importSplitwise(acc, input);
    const second = await importSplitwise(acc, input);
    if (!first.ok || !second.ok) throw new Error("the import was refused");
    groupIds.push(first.groupId);
    expect(second).toEqual(first);
    expect(await db.group.count({ where: { members: { some: { accountId: acc.id } } } })).toBe(1);
    expect(await db.expense.count({ where: { groupId: first.groupId } })).toBe(1);
    expect(await db.payment.count({ where: { groupId: first.groupId } })).toBe(1);
    // Asha: +90,000 paid -30,000 own share -30,000 received as a payment = +30,000. Ravi: -30,000 +30,000 = 0. Meera: -30,000.
    expect(await balancesOfGroup(first.groupId)).toEqual({ net: { Asha: 30_000, Ravi: 0, Meera: -30_000 }, sum: 0 });
  });

  it("the same key with different content is a stale screen: nothing new is made", async () => {
    const acc = await account("Asha");
    const key = `imp-diff-${stamp}-bbbb`;
    const first = await importSplitwise(acc, { text: FILE, groupName: "One", type: "trip", me: 0, key });
    if (!first.ok) throw new Error(first.error);
    groupIds.push(first.groupId);
    const other = await importSplitwise(acc, { text: FILE, groupName: "Two", type: "trip", me: 0, key });
    expect(other).toEqual({ ok: false, error: STALE_KEY_ERROR });
    const otherFile = FILE.replace("Dinner", "Lunch");
    expect(await importSplitwise(acc, { text: otherFile, groupName: "One", type: "trip", me: 0, key })).toEqual({ ok: false, error: STALE_KEY_ERROR });
    expect(await db.group.count({ where: { members: { some: { accountId: acc.id } } } })).toBe(1);
  });

  it("the same key more than 2 minutes later is stale too, and a new key makes a second group on purpose", async () => {
    const acc = await account("Asha");
    const key = `imp-late-${stamp}-cccc`;
    const input = { text: FILE, groupName: "Later", type: "trip", me: 0 };
    const first = await importSplitwise(acc, { ...input, key });
    if (!first.ok) throw new Error(first.error);
    groupIds.push(first.groupId);
    await db.requestKey.update({ where: { key }, data: { createdAt: new Date(Date.now() - 3 * 60_000) } });
    expect(await importSplitwise(acc, { ...input, key })).toEqual({ ok: false, error: STALE_KEY_ERROR });
    expect(await db.group.count({ where: { members: { some: { accountId: acc.id } } } })).toBe(1);
    const copy = await importSplitwise(acc, { ...input, key: `imp-new-${stamp}-dddd` });
    if (!copy.ok) throw new Error(copy.error);
    groupIds.push(copy.groupId);
    expect(copy.groupId).not.toBe(first.groupId);
    expect(await db.group.count({ where: { members: { some: { accountId: acc.id } } } })).toBe(2);
  });

  it("a refused file does not use up the key", async () => {
    const acc = await account("Asha");
    const key = `imp-refused-${stamp}-eeee`;
    expect((await importSplitwise(acc, { text: FILE, groupName: " ", type: "trip", me: 0, key })).ok).toBe(false);
    expect(await db.requestKey.count({ where: { key } })).toBe(0);
  });

  it("the action refuses a form with no key (an old page)", () => {
    const src = readFileSync("src/app/actions.ts", "utf8");
    expect(src).toMatch(/const key = cleanKey\(formData\.get\("rid"\)\);\s+if \(!key\) redirect\(await flashTo\("\/import", \{ error: FORM_OUT_OF_DATE \}\)\);/);
  });
});

describe("G31: one cap for every payment", () => {
  // VND has no decimals, so 2,000,000,000 is 2 billion dong. MAX_MINOR is 2,000,000,000 (the database's Int limit is 2,147,483,647).
  async function vndGroup() {
    const g = await db.group.create({
      data: { name: `B7 VND ${++n} ${stamp}`, currency: "VND", inviteCode: `b7-${n}-${stamp}`, members: { create: [{ name: "Asha", createdAt: new Date(2026, 0, 1) }, { name: "Ravi", createdAt: new Date(2026, 0, 2) }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    return { id: g.id, asha: g.members.find((m) => m.name === "Asha")!.id, ravi: g.members.find((m) => m.name === "Ravi")!.id };
  }
  const counts = async (id: string) => [await db.payment.count({ where: { groupId: id } }), await db.groupEvent.count({ where: { groupId: id } })];

  it("the cap is 2,000,000,000", () => {
    expect(MAX_MINOR).toBe(2_000_000_000);
  });

  it("2,000,000,000 is accepted; 2,000,000,001 (and 0, and a fraction) is refused with nothing saved", async () => {
    const g = await vndGroup();
    const ok = await db.$transaction((tx) => createPayment(tx, { groupId: g.id, fromId: g.ravi, toId: g.asha, amount: 2_000_000_000, createdById: g.ravi }));
    expect(ok.amount).toBe(2_000_000_000);
    expect(await counts(g.id)).toEqual([1, 0]);
    for (const amount of [2_000_000_001, 0, -5, 10.5, Number.NaN]) {
      await expect(db.$transaction((tx) => createPayment(tx, { groupId: g.id, fromId: g.ravi, toId: g.asha, amount, createdById: g.ravi }))).rejects.toBeInstanceOf(PaymentTooBig);
    }
    expect(await counts(g.id)).toEqual([1, 0]);
    expect(paymentTooBigText("VND")).toBe("That’s more than one payment can record (VND 2,000,000,000). Record it as two payments.");
  });

  it("Record a payment of 2,000,000,001 is refused with the sentence, and the payment and event counts do not change", async () => {
    const g = await vndGroup();
    const r = await recordPaymentCore({ groupId: g.id, fromId: g.ravi, toId: g.asha, amount: 2_000_000_001, currency: "VND", myId: g.ravi, fp: "x", warnOver: false });
    expect(r).toEqual({ kind: "refused", error: "That’s more than one payment can record (VND 2,000,000,000). Record it as two payments." });
    expect(await counts(g.id)).toEqual([0, 0]);
  });

  it("a suggested transfer of 2,400,000,000 is refused; two payments of 1,200,000,000 clear it to 0", async () => {
    const g = await vndGroup();
    // Asha paid two bills for Ravi alone: 1,500,000,000 + 900,000,000 (each fits the database's Int); Ravi owes 2,400,000,000.
    for (const [description, amount] of [["Villa", 1_500_000_000], ["Boat", 900_000_000]] as const) {
      await db.expense.create({
        data: { groupId: g.id, description, amount, splitType: "exact", forMode: "selected", paidById: g.asha, createdById: g.asha, originalAmount: amount, convertedAmount: amount, originalCurrency: "VND", baseCurrency: "VND", shares: { create: [{ memberId: g.ravi, amount }] } },
      });
    }
    const before = await loadGroup(g.id);
    expect(before!.transfers).toEqual([{ from: g.ravi, to: g.asha, amount: 2_400_000_000 }]);
    const refused = await markAllPaid(g.id, g.ravi, [{ from: g.ravi, to: g.asha, amount: 2_400_000_000 }], "", true);
    expect(refused).toEqual({ ok: false, error: "That’s more than one payment can record (VND 2,000,000,000). Record it as two payments." });
    expect(await counts(g.id)).toEqual([0, 0]);
    for (const k of ["one", "two"]) {
      const r = await recordPaymentCore({ groupId: g.id, fromId: g.ravi, toId: g.asha, amount: 1_200_000_000, currency: "VND", myId: g.ravi, key: `b7-big-${k}-${stamp}-abcd`, fp: `fp-${k}`, warnOver: true });
      expect(r.kind).toBe("done");
    }
    const after = await loadGroup(g.id);
    expect(after!.transfers).toEqual([]);
    expect(Object.values(after!.net).every((v) => v === 0)).toBe(true);
    expect(await db.payment.count({ where: { groupId: g.id } })).toBe(2);
  });

  it("the import refuses a payment above the cap, as the payment writer does", () => {
    expect(readFileSync("src/lib/splitwise-import.ts", "utf8")).toContain("p.amount > MAX_MINOR");
  });
});

describe("G32: Clear both is labelled as a clearing", () => {
  it("5,000 and 5,000 cents in two USD groups end at 0, the lines say no money moved, and the CSV says Cleared across groups", async () => {
    const asha = await account("Asha");
    const ravi = await account("Ravi");
    const make = async (name: string) => {
      const g = await db.group.create({
        data: {
          name: `${name} ${stamp}`, currency: "USD", inviteCode: `b7c-${++n}-${stamp}`,
          members: { create: [{ name: "Asha", accountId: asha.id, claimedAt: new Date(), createdAt: new Date(2026, 0, 1) }, { name: "Ravi", accountId: ravi.id, claimedAt: new Date(), createdAt: new Date(2026, 0, 2) }] },
        },
        include: { members: true },
      });
      groupIds.push(g.id);
      return { id: g.id, name: g.name, asha: g.members.find((m) => m.name === "Asha")!.id, ravi: g.members.find((m) => m.name === "Ravi")!.id };
    };
    const a = await make("Clear A");
    const b = await make("Clear B");
    const spend = (g: { id: string }, payer: string, other: string, amount: number) =>
      db.expense.create({ data: { groupId: g.id, description: "Dinner", amount: amount * 2, splitType: "equal", paidById: payer, createdById: payer, originalAmount: amount * 2, convertedAmount: amount * 2, shares: { create: [{ memberId: payer, amount }, { memberId: other, amount }] } } });
    await spend(a, a.asha, a.ravi, 5000); // A: Asha paid 10,000, shares 5,000 each: Ravi owes Asha 5,000
    await spend(b, b.ravi, b.asha, 5000); // B: Ravi paid 10,000, shares 5,000 each: Asha owes Ravi 5,000
    const parts = [
      { groupId: a.id, fromId: a.ravi, toId: a.asha, amount: 5000 },
      { groupId: b.id, fromId: b.asha, toId: b.ravi, amount: 5000 },
    ];
    const memberships = { [a.id]: a.asha, [b.id]: b.asha };
    expect(isClearing(parts, memberships)).toBe(true); // +5,000 and -5,000 add to 0
    expect(isClearing([parts[0]], memberships)).toBe(false);
    expect(isClearing([parts[0], { ...parts[1], amount: 4000 }], memberships)).toBe(false);

    expect(await settleAcrossCore(parts, memberships, `b7-clear-${stamp}-abcdef`)).toBe("done");
    for (const g of [a, b]) {
      const loaded = await loadGroup(g.id);
      expect(Object.values(loaded!.net).every((v) => v === 0)).toBe(true);
      expect(loaded!.transfers).toEqual([]);
    }
    const lineA = await db.groupEvent.findFirstOrThrow({ where: { groupId: a.id, kind: "payment_recorded" } });
    const lineB = await db.groupEvent.findFirstOrThrow({ where: { groupId: b.id, kind: "payment_recorded" } });
    expect(lineA.text).toBe("cleared $50 with Ravi across groups (no money moved)");
    expect(lineB.text).toBe("cleared $50 with Ravi across groups (no money moved)");
    expect(lineA.text).not.toContain(b.name);
    expect(lineB.text).not.toContain(a.name);

    const members = [{ id: a.asha, name: "Asha" }, { id: a.ravi, name: "Ravi" }];
    const payments = await withClearing(await db.payment.findMany({ where: { groupId: a.id } }));
    expect(payments.map((p) => p.clearing)).toEqual([true]);
    const csv = groupCsv({ name: a.name, currency: "USD" }, members, [], payments);
    expect(csv).toContain(`,${CLEARING_TYPE},Ravi paid Asha,`);
    expect(csv).not.toMatch(/,Payment,/);
    // An ordinary payment is still "Payment".
    expect(groupCsv({ name: "x", currency: "USD" }, members, [], [{ ...payments[0], clearing: false }])).toMatch(/,Payment,Ravi paid Asha,/);
    // A spreadsheet with that type comes back in as a payment.
    expect(readFileSync("src/lib/import-formats.ts", "utf8")).toContain('type === "cleared across groups"');
  });

  it("a payment across groups that does not net to 0 keeps the ordinary wording", () => {
    const src = readFileSync("src/lib/cross-settle-db.ts", "utf8");
    expect(src).toContain("(Smart Settle across groups)");
  });
});
