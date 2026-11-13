import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/money";
import { maskPayWay, progressSegments, recordButtonLabel, recordedWords } from "@/lib/pay-words";

// The payment screens (Settle up, Pay, Waiting, Did you get this, Record a payment, Payment recorded) were only restyled:
// the words and counts they show are checked with hand-worked numbers, and the pages are read as text to prove every
// action, form field and test hook is still there. (The screens need a browser; the e2e and UAT suites click through them.)

const src = (p: string) => readFileSync(`${__dirname}/../${p}`, "utf8");
const inr = (n: number) => formatMoney(n, "INR");

describe("Record a payment: the button follows the amount and who paid", () => {
  it("₹17,618.19 from Meera (1761819 paise)", () => {
    expect(recordButtonLabel("17618.19", "INR", { name: "Meera", me: false })).toBe("Record ₹17,618.19 from Meera");
  });
  it("a comma typed as the decimal point is read as parseAmount reads it: 12,50 is ₹12.50", () => {
    expect(recordButtonLabel("12,50", "INR", { name: "Ravi", me: true })).toBe("Record ₹12.50 from you");
  });
  it("lakh commas typed or not: 1,23,456 is ₹1,23,456", () => {
    expect(recordButtonLabel("1,23,456", "INR", { name: "Asha", me: false })).toBe("Record ₹1,23,456 from Asha");
  });
  it("nothing typed, zero or nonsense: it just says Record payment (the server still gives the reason)", () => {
    for (const t of ["", "0", "abc", "1.234"]) expect(recordButtonLabel(t, "INR", { name: "Meera", me: false })).toBe("Record payment");
  });
  it("no payer picked: Record payment", () => {
    expect(recordButtonLabel("500", "INR", null)).toBe("Record payment");
  });
});

describe("Settle up: the progress bar", () => {
  it("1 payment made, 2 to go: 3 segments, 1 filled", () => expect(progressSegments(1, 3)).toEqual({ segments: 3, filled: 1 }));
  it("nothing paid yet: 3 segments, none filled", () => expect(progressSegments(0, 3)).toEqual({ segments: 3, filled: 0 }));
  it("all paid: every segment filled", () => expect(progressSegments(3, 3)).toEqual({ segments: 3, filled: 3 }));
  it("12 payments are drawn as 8 segments in proportion: 5 of 12 is 3.33 of 8, so 3", () => expect(progressSegments(5, 12)).toEqual({ segments: 8, filled: 3 }));
  it("never fills past the end or below nothing", () => {
    expect(progressSegments(20, 10)).toEqual({ segments: 8, filled: 8 });
    expect(progressSegments(-2, 4)).toEqual({ segments: 4, filled: 0 });
  });
});

describe("Payment recorded: what the view says", () => {
  const name = (id: string) => ({ me: "Asha", m: "Meera", r: "Ravi", n: "Nupur" })[id] ?? "Someone";
  const base = { me: "me", name, money: inr, groupName: "Thailand trip" };
  it("Meera pays ₹17,618.19 and nothing is left: Meera is all square", () => {
    expect(recordedWords({ ...base, payment: { from: "m", to: "me", amount: 1761819 }, left: [] })).toEqual({
      headline: "Meera’s all square",
      sub: "Nothing left to pay in Thailand trip",
      stubLine: "is square with you",
    });
  });
  it("a part payment: ₹5,000 recorded of ₹17,618.19 leaves ₹12,618.19 (500000 + 1261819 = 1761819)", () => {
    const w = recordedWords({ ...base, payment: { from: "m", to: "me", amount: 500000 }, left: [{ from: "m", to: "me", amount: 1261819 }, { from: "r", to: "n", amount: 1089579 }] });
    expect(w.headline).toBe("₹5,000 recorded, ₹12,618.19 left");
    expect(w.stubLine).toBe("₹12,618.19 still to pay");
    expect(w.sub).toBe("2 payments left in Thailand trip");
  });
  it("paid in full but Meera still has a payment with someone else: square with you, not all square", () => {
    const w = recordedWords({ ...base, payment: { from: "m", to: "me", amount: 100 }, left: [{ from: "m", to: "r", amount: 50 }] });
    expect(w.headline).toBe("Meera and you are square");
    expect(w.sub).toBe("1 payment left in Thailand trip");
  });
  it("I paid: You're all square, or You and Nupur are square while I still owe someone else", () => {
    expect(recordedWords({ ...base, payment: { from: "me", to: "n", amount: 100 }, left: [] }).headline).toBe("You’re all square");
    expect(recordedWords({ ...base, payment: { from: "me", to: "n", amount: 100 }, left: [{ from: "me", to: "r", amount: 70 }] }).headline).toBe("You and Nupur are square");
  });
});

describe("Pay Nupur: the saved way to be paid is masked", () => {
  it("a UPI ID keeps two letters and its handle", () => expect(maskPayWay({ upiId: "nupur@okicici", payLink: "" })).toBe("nu•••@okicici"));
  it("a pay link shows only its site", () => expect(maskPayWay({ upiId: "", payLink: "https://www.paypal.me/nupur" })).toBe("paypal.me"));
  it("nothing saved shows nothing", () => expect(maskPayWay(null)).toBe(""));
});

describe("restyle only: every action, field and hook is still on the pages", () => {
  const settle = src("src/app/groups/[id]/settle/page.tsx");
  const all = src("src/app/settle/page.tsx");
  const form = src("src/components/RecordPaymentForm.tsx");
  const pay = src("src/app/groups/[id]/pay/page.tsx");
  it("group Settle up keeps its actions and the fields they send", () => {
    for (const s of ["claimPaidAction", "confirmClaimAction", "declineClaimAction", "confirmPaymentAction", "rejectPaymentAction", "withdrawClaimAction", "markAllPaidAction", "recordCustomPayment", "settleEverything", "undoChange"]) expect(settle).toContain(s);
    for (const s of ['name="groupId"', 'name="fromId"', 'name="toId"', 'name="amount"', 'name="back" value="settle"', 'name="claimId"', 'name="paymentId"', 'name="plan"', 'name="over" value="1"']) expect(settle).toContain(s);
    expect(settle).toContain("value={toInputAmount(t.amount, group.currency)}"); // the recorded amount is the exact suggested one
    expect(settle).toContain("value={t.amount}"); // the claim carries the exact suggested amount
  });
  it("group Settle up keeps the hooks the tests read", () => {
    for (const s of ["data-i-paid", "data-mark-paid", "data-remind", "data-claim-waiting", "data-claim-above", "data-claim-declined", "data-waiting", "\"data-claim\"", "data-over-warning", "data-settle-actions", 'data-more-options="settle"', 'aria-label="Did you get these?"', "data-transfer-row"]) expect(settle).toContain(s);
    expect(src("src/components/PayScreens.tsx")).toContain("data-settled-pct={pct}");
    expect(src("src/components/SettleRow.tsx")).toContain("data-different-amount");
  });
  it("only one cream button on the screen: the first ticket's, and none when someone is waiting on you to confirm", () => {
    expect(settle).toContain("i === 0 && confirmCount === 0 ? CREAM : OUTLINE_PILL");
    expect(settle).toContain("claimsToMe.length === 0 && i === 0 ? CREAM : OUTLINE_PILL");
  });
  it("all-groups Settle up keeps its actions, ids and hooks", () => {
    for (const s of ["settleAcrossGroups", "data-cross-preview", "data-cross-record", "data-cross-lines", "data-cross-total", "data-remind", "settleRowId(", 'id={way === "in" ? "remind" : "pay"}', 'name="parts"', "crossActionLabel(it.net)", "crossPreview(it, common)"]) expect(all).toContain(s);
  });
  it("Record a payment still sends the same fields and keeps its hooks", () => {
    for (const s of ['name="groupId"', 'name="back" value="settle"', 'name="fromId"', 'name="toId"', 'name="amount"', 'name="over" value="1"', "data-to={m.id}", "data-over-warning", "data-over-record", "recordCustomPayment", "keyField"]) expect(form).toContain(s);
    expect(pay).toContain("data-over-cancel");
    expect(pay).toContain("<FreshKey");
    expect(pay).toContain('back={fromSettle ? `/groups/${group.id}/settle`');
    expect(form + pay).not.toContain("Read as");
  });
  it("the Balances tab keeps the numbers and hooks its tests read", () => {
    const b = src("src/app/groups/[id]/_components/BalancesTab.tsx");
    for (const s of ["data-balance=", "data-exact=", "data-title=", "data-foreign-part", "data-ledger-summary", "data-our-passports", "data-passport-link"]) expect(b).toContain(s);
  });
});
