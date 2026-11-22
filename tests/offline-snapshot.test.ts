import { describe, expect, it } from "vitest";
import { buildSnapshot, type SnapshotView } from "@/lib/offline/snapshot";
import { balanceParts } from "@/lib/group-summary-text";
import { formatMoney } from "@/lib/money";

// The offline copy of a group is worked out on the server. Hand-worked example: Asha paid ₹1,200 for six people (A to F); you are B.
// B's share is 120000 / 6 = 20000, so B owes 20000 paise (₹200), and Smart Settle has five payments of 20000 to A.

const ids = ["a", "b", "c", "d", "e", "f"];
const NOW = new Date("2026-11-18T10:00:00.000Z");
const view = (over: Partial<SnapshotView["group"]> = {}, leaver: unknown = null): SnapshotView => ({
  myId: "b",
  tz: "Asia/Kolkata",
  leaver,
  net: { a: 100000, b: -20000, c: -20000, d: -20000, e: -20000, f: -20000 },
  transfers: ["b", "c", "d", "e", "f"].map((from) => ({ from, to: "a", amount: 20000 })),
  nameOf: (id) => (id === "b" ? "You" : id.toUpperCase()),
  money: (m) => formatMoney(m, "INR"),
  eq: () => null,
  group: {
    id: "g1", name: "Goa trip", type: "trip", currency: "INR", cardMarkupBp: 0, closed: false, deletedAt: null, tripStart: "", tripEnd: "",
    members: ids.map((id) => ({ id, name: id.toUpperCase(), leftAt: null, splitWeight: 100 })),
    expenses: [{ id: "e1", description: "Taxi", category: "transport", amount: 120000, paidById: "a", createdAt: new Date("2026-11-18T05:00:00Z"), shares: ids.map((memberId) => ({ memberId, amount: 20000 })) }],
    payments: [],
    ...over,
  },
});

describe("the offline copy of a group", () => {
  it("holds your balance as the server worked it out, in the money card's own words", () => {
    const s = buildSnapshot(view(), { splitName: "Group split", now: NOW })!;
    expect(s.balance.paise).toBe(-20000);
    expect(s.balance.label).toBe("You owe");
    expect(s.balance.tone).toBe("owe");
    expect(s.balance.text).toBe(formatMoney(20000, "INR")); // exact, paise included, as MoneyTicket shows it
    expect(s.balance).toMatchObject(balanceParts(-20000, "INR")); // the very function MoneyTicket uses
    expect(s.balance.summary).toBe("You pay A. 5 payments clear everything.");
    expect(s.balance.canSettle).toBe(true);
    expect(s.peopleCount).toBe(6);
    expect(s.savedAt).toBe(NOW.toISOString());
  });
  it("its newest row says what the expense meant for you", () => {
    const s = buildSnapshot(view(), { splitName: "Group split", now: NOW })!;
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ title: "Taxi", line: `A paid ${formatMoney(120000, "INR")}`, effectLabel: "you owe", effectAmount: formatMoney(20000, "INR"), tone: "owe" });
  });
  it("never holds a phone number or an email", () => {
    const text = JSON.stringify(buildSnapshot(view(), { splitName: "Group split", now: NOW }));
    expect(text).not.toMatch(/phone|email|mail|@/i);
    const s = buildSnapshot(view(), { splitName: "Group split", now: NOW })!;
    expect(Object.keys(s.members[0]).sort()).toEqual(["id", "name", "splitWeight"]);
  });
  it("is not kept for someone who left, a closed or deleted group, or a pair", () => {
    expect(buildSnapshot(view({}, { leftAt: new Date() }), { splitName: "x" })).toBeNull();
    expect(buildSnapshot(view({ closed: true }), { splitName: "x" })).toBeNull();
    expect(buildSnapshot(view({ deletedAt: new Date() }), { splitName: "x" })).toBeNull();
    expect(buildSnapshot(view({ type: "direct" }), { splitName: "x" })).toBeNull();
  });
  it("lists only the people still in the group", () => {
    const members = ids.map((id) => ({ id, name: id.toUpperCase(), leftAt: id === "f" ? new Date() : null, splitWeight: 100 }));
    const s = buildSnapshot(view({ members }), { splitName: "x", now: NOW })!;
    expect(s.members.map((m) => m.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
});
