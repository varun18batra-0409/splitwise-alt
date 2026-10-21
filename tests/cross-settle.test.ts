import { describe, expect, it } from "vitest";
import { crossSettle, personKey, type GroupForSettle } from "@/lib/cross-settle";
import { netBalances } from "@/lib/balances";
import { smartSettle } from "@/lib/settle";

const goa: GroupForSettle = {
  groupId: "g1",
  groupName: "Goa trip",
  currency: "INR",
  myId: "me1",
  members: [
    { id: "me1", name: "Varun", phone: "" },
    { id: "a1", name: "Asha", phone: "+91 98765 43210" },
    { id: "r1", name: "Ravi", phone: "" },
  ],
  transfers: [
    { from: "me1", to: "a1", amount: 100000 }, // I pay Asha ₹1,000
    { from: "r1", to: "a1", amount: 50000 }, // not involving me — ignored
  ],
};
const flat: GroupForSettle = {
  groupId: "g2",
  groupName: "Flat",
  currency: "INR",
  myId: "me2",
  members: [
    { id: "me2", name: "Varun", phone: "" },
    { id: "a2", name: "asha  ", phone: "9876543210" }, // same Asha (same phone)
    { id: "r2", name: "Ravi", phone: "" },
  ],
  transfers: [
    { from: "a2", to: "me2", amount: 40000 }, // Asha pays me ₹400
    { from: "r2", to: "me2", amount: 25000 }, // Ravi pays me ₹250
  ],
};

describe("Smart Settle across groups", () => {
  it("nets payments with the same person into one", () => {
    const { items } = crossSettle([goa, flat], "INR", () => null);
    const asha = items.find((i) => i.name === "Asha")!;
    expect(asha.net).toBe(-60000); // you pay Asha ₹600 instead of two payments
    expect(asha.parts.map((p) => [p.groupName, p.iPay, p.amount])).toEqual([
      ["Goa trip", true, 100000],
      ["Flat", false, 40000],
    ]);
    const ravi = items.find((i) => i.name === "Ravi")!;
    expect(ravi.net).toBe(25000); // matched by name; only the Flat payment involves me
  });

  it("recognises people by phone first, then by name", () => {
    expect(personKey({ name: "Asha", phone: "+91 98765 43210" })).toBe(personKey({ name: "A. Sharma", phone: "098765-43210" }));
    expect(personKey({ name: "Ravi  Kumar", phone: "" })).toBe(personKey({ name: "ravi kumar", phone: "" }));
    expect(personKey({ name: "Ravi", phone: "" })).not.toBe(personKey({ name: "Ravi", phone: "9999999999" }));
    // On Loopin: the account decides. Two different Rahuls are never merged; one Rahul is, whatever he's called.
    expect(personKey({ name: "Rahul", phone: "", accountId: "a1" })).not.toBe(personKey({ name: "Rahul", phone: "", accountId: "a2" }));
    expect(personKey({ name: "Rahul", phone: "", accountId: "a1" })).toBe(personKey({ name: "Rahul K", phone: "", accountId: "a1" }));
  });

  it("converts other currencies to the common one, and skips groups without a rate", () => {
    const usd: GroupForSettle = { ...goa, groupId: "g3", groupName: "NYC", currency: "USD", transfers: [{ from: "a1", to: "me1", amount: 1000 }] };
    const thb: GroupForSettle = { ...goa, groupId: "g4", groupName: "Bangkok", currency: "THB", transfers: [{ from: "a1", to: "me1", amount: 1000 }] };
    const { items, skippedGroups } = crossSettle([usd, thb], "INR", (amt, cur) => (cur === "USD" ? amt * 84 : null));
    expect(items[0].net).toBe(84000);
    expect(items[0].converted).toBe(true);
    expect(skippedGroups).toEqual(["Bangkok"]);
  });

  it("recording each group's part clears the balance between you in every group", () => {
    // Build real group balances, apply the parts as payments, and check nothing is left between us.
    const g1Net = netBalances(["me1", "a1"], [{ paidById: "a1", amount: 200000, shares: [{ memberId: "me1", amount: 100000 }, { memberId: "a1", amount: 100000 }] }]);
    const g2Net = netBalances(["me2", "a2"], [{ paidById: "me2", amount: 80000, shares: [{ memberId: "me2", amount: 40000 }, { memberId: "a2", amount: 40000 }] }]);
    const groups: GroupForSettle[] = [
      { ...goa, members: goa.members.slice(0, 2), transfers: smartSettle(g1Net) },
      { ...flat, members: flat.members.slice(0, 2), transfers: smartSettle(g2Net) },
    ];
    const { items } = crossSettle(groups, "INR", () => null);
    expect(items[0].net).toBe(-60000);
    const after1 = netBalances(["me1", "a1"], [{ paidById: "a1", amount: 200000, shares: [{ memberId: "me1", amount: 100000 }, { memberId: "a1", amount: 100000 }] }],
      items[0].parts.filter((p) => p.groupId === "g1").map((p) => ({ fromId: p.fromId, toId: p.toId, amount: p.amount })));
    const after2 = netBalances(["me2", "a2"], [{ paidById: "me2", amount: 80000, shares: [{ memberId: "me2", amount: 40000 }, { memberId: "a2", amount: 40000 }] }],
      items[0].parts.filter((p) => p.groupId === "g2").map((p) => ({ fromId: p.fromId, toId: p.toId, amount: p.amount })));
    expect([after1.me1, after1.a1, after2.me2, after2.a2]).toEqual([0, 0, 0, 0]);
  });
});

describe("second currency", () => {
  it("picks the foreign currency used most, unless set or turned off", async () => {
    const { resolveSecondary } = await import("@/lib/secondary");
    const ex = [{ originalCurrency: "THB" }, { originalCurrency: "THB" }, { originalCurrency: "INR" }, { originalCurrency: "VND" }];
    expect(resolveSecondary("", "INR", ex)).toBe("THB");
    expect(resolveSecondary("USD", "INR", ex)).toBe("USD");
    expect(resolveSecondary("none", "INR", ex)).toBeNull();
    expect(resolveSecondary("", "INR", [{ originalCurrency: "INR" }])).toBeNull();
  });

  it("totals spending per original currency with the amount it came to", async () => {
    const { spentByCurrency } = await import("@/lib/secondary");
    expect(spentByCurrency([
      { originalCurrency: "THB", originalAmount: 300000, amount: 772500 },
      { originalCurrency: "THB", originalAmount: 100000, amount: 250000 },
      { originalCurrency: "INR", originalAmount: 90000, amount: 90000 },
    ])).toEqual([
      { currency: "THB", original: 400000, group: 1022500, count: 2 },
      { currency: "INR", original: 90000, group: 90000, count: 1 },
    ]);
  });
});
