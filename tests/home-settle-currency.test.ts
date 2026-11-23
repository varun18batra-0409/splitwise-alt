import { describe, expect, it } from "vitest";
import { crossSettle, settleRowId, type GroupForSettle } from "@/lib/cross-settle";
import { moneyPeople, payHref, whoLine, type PeopleGroup } from "@/lib/home/money-card";

// Settle up and Home agree for a person with money in two currencies (outside review J1, J2): one card per currency on Settle,
// one entry per currency on Home, nothing netted or converted between them, and every Home link lands on a card that exists.
// Money is whole minor units, worked out by hand. Display currency INR; the test rate is 1 cent = 84 paise.

const rate = (amount: number, currency: string) => (currency === "USD" ? amount * 84 : null);
const me = { id: "me", name: "Varun", phone: "" };
const asha = (id: string) => ({ id, name: "Asha", phone: "", accountId: "acc-asha" });

// G1 (USD trip): I owe Asha 5,000 cents. G2 (INR flat): Asha owes me 100,000 paise (₹1,000).
const g1 = { groupId: "g1", groupName: "NYC trip", currency: "USD", myId: "me", members: [me, asha("a1")], transfers: [{ from: "me", to: "a1", amount: 5000 }] };
const g2 = { groupId: "g2", groupName: "Flat", currency: "INR", myId: "me", members: [me, asha("a2")], transfers: [{ from: "a2", to: "me", amount: 100000 }] };

describe("a person at USD -5,000 and INR +100,000", () => {
  const settle = crossSettle([g1, g2] as GroupForSettle[], "INR", rate).items;
  const ownE = moneyPeople([g1, g2] as PeopleGroup[], "owe", "INR", rate);
  const owedE = moneyPeople([g1, g2] as PeopleGroup[], "owed", "INR", rate);

  it("Settle has two cards with separate exact amounts", () => {
    expect(settle).toHaveLength(2);
    const usd = settle.find((i) => i.currency === "USD")!;
    const inr = settle.find((i) => i.currency === "INR")!;
    expect([usd.netOwn, inr.netOwn]).toEqual([-5000, 100000]);
    expect(usd.id).not.toBe(inr.id);
  });

  it("Home has one entry per currency, exact, never netted (5,000 cents is 420,000 paise: netting would show 320,000 owed)", () => {
    expect(ownE.map((e) => [e.name, e.currency, e.amount, e.approx])).toEqual([["Asha", "USD", 5000, false]]);
    expect(owedE.map((e) => [e.name, e.currency, e.amount, e.approx])).toEqual([["Asha", "INR", 100000, false]]);
    // Home and Settle say the same amounts.
    expect(ownE[0].amount).toBe(-settle.find((i) => i.currency === "USD")!.netOwn);
    expect(owedE[0].amount).toBe(settle.find((i) => i.currency === "INR")!.netOwn);
  });

  it("the who line names both, in their own currencies", () => {
    expect(whoLine(ownE, owedE, "owe").text).toBe("Asha $50 · Asha owes you ₹1,000");
  });

  it("Home's Pay link lands on a Settle card that exists", () => {
    const cardIds = new Set(settle.filter((i) => i.netOwn < 0).map((i) => settleRowId("pay", i.id)));
    const href = payHref(ownE[0], "INR");
    expect(href.startsWith("/settle#")).toBe(true);
    expect(cardIds.has(href.slice("/settle#".length))).toBe(true);
  });

  it("with INR owed (the display currency card) the other way round, the link still lands on a card", () => {
    // Now I owe ₹1,000 in the flat and Asha owes me $50 in the trip.
    const a = { ...g1, transfers: [{ from: "a1", to: "me", amount: 5000 }] };
    const b = { ...g2, transfers: [{ from: "me", to: "a2", amount: 100000 }] };
    const items = crossSettle([a, b] as GroupForSettle[], "INR", rate).items;
    const owe = moneyPeople([a, b] as PeopleGroup[], "owe", "INR", rate);
    expect(owe.map((e) => [e.currency, e.amount])).toEqual([["INR", 100000]]);
    const cardIds = new Set(items.filter((i) => i.netOwn < 0).map((i) => settleRowId("pay", i.id)));
    expect(cardIds.has(payHref(owe[0], "INR").slice("/settle#".length))).toBe(true);
  });

  it("no display-currency card (USD and EUR, shown in INR): Home and Settle still pick the same card", () => {
    const eur = { ...g2, groupId: "g3", currency: "EUR", transfers: [{ from: "me", to: "a2", amount: 3000 }] };
    const toCommon = (amount: number, currency: string) => (currency === "USD" ? amount * 84 : currency === "EUR" ? amount * 90 : null);
    const items = crossSettle([g1, eur] as GroupForSettle[], "INR", toCommon).items; // I owe $50 and €30
    const owe = moneyPeople([g1, eur] as PeopleGroup[], "owe", "INR", toCommon);
    expect(items.map((i) => [i.currency, i.netOwn]).sort()).toEqual([["EUR", -3000], ["USD", -5000]]);
    expect(owe.map((e) => [e.currency, e.amount]).sort()).toEqual([["EUR", 3000], ["USD", 5000]]);
    const cardIds = new Set(items.map((i) => settleRowId("pay", i.id)));
    expect(cardIds.size).toBe(2);
    for (const e of owe) expect(cardIds.has(payHref(e, "INR").slice("/settle#".length))).toBe(true);
  });
});

describe("a person is never shown as square because their currencies cancel", () => {
  it("$50 owed and ₹4,200 owed back at 84 (5,000 x 84 = 420,000 paise) is two entries, one on each side", () => {
    const b = { ...g2, transfers: [{ from: "a2", to: "me", amount: 420000 }] };
    expect(moneyPeople([g1, b] as PeopleGroup[], "owe", "INR", rate).map((e) => [e.currency, e.amount])).toEqual([["USD", 5000]]);
    expect(moneyPeople([g1, b] as PeopleGroup[], "owed", "INR", rate).map((e) => [e.currency, e.amount])).toEqual([["INR", 420000]]);
  });
});

describe("Home looks the same for people in one currency", () => {
  it("a person with only a USD group is still converted, marked ≈, and linked by the plain key", () => {
    const e = moneyPeople([g1] as PeopleGroup[], "owe", "INR", rate);
    expect(e.map((x) => [x.currency, x.amount, x.approx, x.mixed, x.anchor])).toEqual([["INR", 420000, true, undefined, undefined]]);
    expect(payHref(e[0], "INR")).toBe(`/settle#${settleRowId("pay", e[0].key)}`);
    expect(crossSettle([g1] as GroupForSettle[], "INR", rate).items[0].id).toBe(e[0].key);
  });

  it("two USD groups with the same person are still added together: 5,000 + 3,000 = 8,000 cents, 672,000 paise", () => {
    const b = { ...g1, groupId: "g9", groupName: "Cabin", members: [me, asha("a9")], transfers: [{ from: "me", to: "a9", amount: 3000 }] };
    const e = moneyPeople([g1, b] as PeopleGroup[], "owe", "INR", rate);
    expect(e.map((x) => [x.currency, x.amount, x.approx])).toEqual([["INR", 672000, true]]);
  });
});
