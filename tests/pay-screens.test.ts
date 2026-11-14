import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/money";
import { maskPayWay, recordButtonLabel, recordButtonText, recordedWords } from "@/lib/pay-words";

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

describe("Record a payment: the button shows the amount, no payer", () => {
  it("1082.50 -> Record ₹1,082.50 (108250 paise); typed with a comma 12,50 -> Record ₹12.50", () => {
    expect(recordButtonText("1082.50", "INR")).toBe("Record ₹1,082.50");
    expect(recordButtonText("12,50", "INR")).toBe("Record ₹12.50");
  });
  it("nothing usable typed: Record payment, and the label never says 'from you'", () => {
    for (const t of ["", "0", "abc"]) expect(recordButtonText(t, "INR")).toBe("Record payment");
    expect(recordButtonText("500", "INR")).not.toContain("from");
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
      note: "",
    });
  });
  // Hand-worked (paise): Nupur owes Asha ₹500 = 50000.
  it("₹500 owed, ₹600 recorded: not square, Nupur now owes you ₹100 (60000 - 50000 = 10000)", () => {
    const w = recordedWords({ ...base, payment: { from: "n", to: "me", amount: 60000 }, left: [{ from: "me", to: "n", amount: 10000 }] });
    expect(w.headline).toBe("₹600 recorded");
    expect(w.note).toBe("You now owe Nupur ₹100");
    expect(w.headline + w.note + w.stubLine).not.toMatch(/square/);
  });
  it("the overpayer sees it the other way: I paid Nupur ₹600 of ₹500, Nupur now owes me ₹100", () => {
    const w = recordedWords({ ...base, payment: { from: "me", to: "n", amount: 60000 }, left: [{ from: "n", to: "me", amount: 10000 }] });
    expect(w.headline).toBe("₹600 recorded");
    expect(w.note).toBe("Nupur now owes you ₹100");
    expect(w.headline + w.note + w.stubLine).not.toMatch(/square/);
  });
  it("someone else's overpayment names both people", () => {
    const w = recordedWords({ ...base, payment: { from: "m", to: "n", amount: 60000 }, left: [{ from: "n", to: "m", amount: 10000 }] });
    expect(w.note).toBe("Nupur now owes Meera ₹100");
  });
  it("₹500 owed, ₹200 recorded: ₹200 recorded, ₹300 left (50000 - 20000 = 30000)", () => {
    const w = recordedWords({ ...base, payment: { from: "me", to: "n", amount: 20000 }, left: [{ from: "me", to: "n", amount: 30000 }] });
    expect(w.headline).toBe("₹200 recorded, ₹300 left");
    expect(w.note).toBe("");
  });
  // Square with Nupur but I still owe Ravi ₹0.70 (70 paise): "You and Nupur are square". With nothing else left for me it is "You’re all square" (next test).
  it("₹500 owed, ₹500 recorded: exactly square", () => {
    const w = recordedWords({ ...base, payment: { from: "me", to: "n", amount: 50000 }, left: [{ from: "me", to: "r", amount: 70 }] });
    expect(w.headline).toBe("You and Nupur are square");
    expect(w.note).toBe("");
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
  it("someone who left, or a closed group, still gets Open payment app but no claim; a leaver has no Undo report", () => {
    expect(settle).toContain('const payOnly = f.plan.main === "pay-app" && (iLeft || group.closed)');
    expect(settle).toContain('(f.plan.action || f.plan.main === "pay-app") && iPay');
    expect(settle).toContain("iLeft ? null : (");
    expect(src("src/components/PayScreens.tsx")).toContain("{tellButton && (");
  });
  it("the progress bar is the money measure (the % settled), not a count of payments", () => {
    const ps = src("src/components/PayScreens.tsx");
    expect(ps).toContain("{pct}% settled");
    expect(ps).not.toMatch(/of \{total\} done/);
  });
  it("Record a payment announces the amount politely, and From and To open independently", () => {
    expect(form).toContain('aria-live="polite"');
    expect(form).toContain("Will record");
    expect(form).not.toContain('const open = to ? picked : "to"');
    expect(src("src/components/PayScreens.tsx")).toContain("sr-only");
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
    for (const s of ["data-balance=", "data-exact=", "data-title=", "data-foreign-part", "data-our-passports", "data-passport-link"]) expect(b).toContain(s);
  });
});

describe("Record a payment form: submits are never blocked silently", () => {
  const form = src("src/components/RecordPaymentForm.tsx");
  it("the browser's own check is off and a missing choice is said aloud", () => {
    expect(form).toMatch(/noValidate/);
    expect(form).not.toMatch(/onInvalid/);
    expect(form).toMatch(/role="alert"/);
  });
});
