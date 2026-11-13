import { describe, expect, it } from "vitest";
import {
  amountTier,
  crowdWord,
  groupMark,
  homeTicket,
  initialOf,
  moneyPeople,
  payHref,
  rankGroups,
  remindHref,
  routeEnds,
  sideTotal,
  ticketContext,
  type InvolvedGroup,
  type MoneyMode,
  type PeopleGroup,
} from "@/lib/home/money-card";
import { cardBalance, cardStatus } from "@/lib/home/group-card";

// Home's boarding-pass money card: every situation is a plain function, so every one is checked here with the numbers worked by hand.
// Amounts are minor units (paise): 420000 paise = ₹4,200.

const same = (n: number) => n;
const me = { id: "me", name: "Me", phone: "", accountId: "acc-me" };
const person = (id: string, name: string) => ({ id, name, phone: "", accountId: `acc-${id}` });

// A group where I pay each person (iPay) and/or each person pays me (theyPay).
const grp = (groupId: string, groupName: string, currency: string, iPay: [string, string, number][], theyPay: [string, string, number][] = []): PeopleGroup => ({
  groupId,
  groupName,
  currency,
  myId: "me",
  members: [me, ...iPay.map(([id, n]) => person(id, n)), ...theyPay.map(([id, n]) => person(id, n))],
  transfers: [...iPay.map(([id, , amount]) => ({ from: "me", to: id, amount })), ...theyPay.map(([id, , amount]) => ({ from: id, to: "me", amount }))],
});
const peopleOf = (groups: PeopleGroup[], side: "owe" | "owed", toCommon: (n: number, c: string) => number | null = same) => moneyPeople(groups, side, "INR", toCommon);
const involvedOf = (groups: PeopleGroup[], types: Record<string, string>): InvolvedGroup[] =>
  groups.map((g) => ({ id: g.groupId, name: g.groupName, type: types[g.groupId] ?? "other", weight: g.transfers.reduce((t, x) => t + x.amount, 0) }));

function ticketFor(groups: PeopleGroup[], types: Record<string, string>, mode: MoneyMode, toCommon: (n: number, c: string) => number | null = same, acrossCurrencies = false) {
  return homeTicket({
    mode,
    acrossCurrencies,
    owe: peopleOf(groups, "owe", toCommon),
    owed: peopleOf(groups, "owed", toCommon),
    common: "INR",
    hero: { text: "₹1" },
    groups: involvedOf(groups, types),
  });
}

describe("the mark on the route line", () => {
  it("plane for trips, house for flats, heart for couples, spade for game nights, a dot for anything else", () => {
    expect(groupMark("trip")).toBe("plane");
    expect(groupMark("home")).toBe("house");
    expect(groupMark("couple")).toBe("heart");
    expect(groupMark("pot")).toBe("spade");
    expect(groupMark("other")).toBe("dot");
    expect(groupMark("")).toBe("dot");
  });
});

describe("which group the stub shows", () => {
  const g = (id: string, name: string, weight: number): InvolvedGroup => ({ id, name, type: "trip", weight });
  it("the group with the most money first: ₹54,122 beats ₹4,200", () => {
    expect(rankGroups([g("a", "Flat", 420000), g("b", "Thailand Trip", 5412200)]).map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("equal money: by name, then id, so it never flickers", () => {
    expect(rankGroups([g("2", "Goa", 100), g("1", "Goa", 100), g("3", "Bali", 100)]).map((x) => x.id)).toEqual(["3", "1", "2"]);
  });
  it("the grey line names the top group, and “and 2 more” when the money spans three", () => {
    expect(ticketContext([])).toBe("");
    expect(ticketContext([g("b", "Thailand Trip", 1)])).toBe("Thailand Trip");
    expect(ticketContext([g("b", "Thailand Trip", 3), g("a", "Flat", 2), g("c", "Goa", 1)])).toBe("Thailand Trip and 2 more");
  });
});

describe("the route line", () => {
  it("you owe one person: You to Nupur (first name only)", () => {
    expect(routeEnds("owe", ["Nupur"], "people")).toEqual({ from: "You", to: "Nupur" });
  });
  it("one person owes you: Kabir to You", () => {
    expect(routeEnds("owed", ["Kabir"], "people")).toEqual({ from: "Kabir", to: "You" });
  });
  it("three flatmates owe you: “3 flatmates” to You; you owe three: You to “3 people”", () => {
    expect(routeEnds("owed", ["K", "A", "M"], "flatmates")).toEqual({ from: "3 flatmates", to: "You" });
    expect(routeEnds("owe", ["K", "A", "M"], "flatmates")).toEqual({ from: "You", to: "3 people" });
  });
  it("“flatmates” only when every group is a flat", () => {
    expect(crowdWord(["home", "home"])).toBe("flatmates");
    expect(crowdWord(["home", "trip"])).toBe("people");
    expect(crowdWord([])).toBe("people");
  });
  it("initials for the little faces", () => {
    expect(initialOf("kabir")).toBe("K");
    expect(initialOf("  Asha Rao")).toBe("A");
    expect(initialOf("")).toBe("?");
  });
});

describe("the amount never adds two currencies", () => {
  it("one currency: ₹12,00,000 + ₹11,00,000 paise-wise = 1200000 + 1100000 + 848000 = 3148000 paise = ₹31,480", () => {
    const e = peopleOf([grp("g1", "Flat 402", "INR", [], [["k", "Kabir", 1200000], ["a", "Asha", 1100000], ["m", "Meera", 848000]])], "owed");
    expect(sideTotal(e).text).toBe("₹31,480");
  });
  it("two currencies stay apart: ₹4,200 and a separate dollar amount, joined with a dot, never one number", () => {
    const inr = grp("g1", "Flat", "INR", [], [["k", "Kabir", 420000]]);
    const usd = grp("g2", "NYC", "USD", [], [["a", "Asha", 2000]]);
    const e = peopleOf([inr, usd], "owed", (n, c) => (c === "INR" ? n : null));
    const t = sideTotal(e);
    expect(t.text.split(" · ")).toHaveLength(2);
    expect(t.text.startsWith("₹4,200")).toBe(true);
    expect(t.text).toContain("$20");
  });
  it("a converted amount keeps its ≈", () => {
    const usd = grp("g2", "NYC", "USD", [], [["a", "Asha", 1000]]);
    const e = peopleOf([usd], "owed", (n) => n * 80); // $10.00 -> 80,000 paise = ₹800 (made-up rate 80)
    expect(sideTotal(e).text).toBe("≈ ₹800");
  });
  it("the amount is drawn smaller as it gets longer, so it always fits", () => {
    expect(amountTier("₹54,122")).toBe("xl"); // 7 characters
    expect(amountTier("₹12,34,567")).toBe("l"); // 10
    expect(amountTier("₹4,200 · $20.00")).toBe("m"); // 15
  });
});

describe("the ticket for each money situation", () => {
  it("nothing owed: all square, one “New group” button, no amounts", () => {
    const t = ticketFor([], {}, "square");
    expect(t).toMatchObject({ kind: "square", amount: "All square", label: "Nobody owes anybody" });
    if (t.kind === "square") expect(t.action).toMatchObject({ key: "new-group", label: "New group", href: "/groups/new" });
  });

  it("you owe Nupur ₹54,122 in a trip: route You to Nupur with a plane, the orange side, “Pay Nupur”", () => {
    const groups = [grp("g1", "Thailand Trip", "INR", [["n", "Nupur Shah", 5412200]])];
    const t = ticketFor(groups, { g1: "trip" }, "owe");
    expect(t.kind).toBe("one");
    if (t.kind !== "one") return;
    expect(t).toMatchObject({ from: "You", to: "Nupur", mark: "plane", context: "Thailand Trip" });
    expect(t.line).toMatchObject({ side: "owe", count: 1, amount: "₹54,122", faces: [] });
    expect(t.line.action).toMatchObject({ key: "pay", label: "Pay Nupur", bright: true });
    expect(t.line.action.href).toBe(payHref(peopleOf(groups, "owe")[0], "INR"));
    expect(t.line.action.fullLabel).toContain("Pay Nupur Shah");
  });

  it("Kabir owes you ₹22,916 in a flat: route Kabir to You with a house, the green side, “Remind Kabir” to the remind route", () => {
    const groups = [grp("g1", "Flat 402", "INR", [], [["k", "Kabir Rao", 2291600]])];
    const t = ticketFor(groups, { g1: "home" }, "owed");
    expect(t.kind).toBe("one");
    if (t.kind !== "one") return;
    expect(t).toMatchObject({ from: "Kabir", to: "You", mark: "house", context: "Flat 402" });
    expect(t.line).toMatchObject({ side: "owed", amount: "₹22,916" });
    expect(t.line.action).toMatchObject({ key: "remind", label: "Remind Kabir", href: "/groups/g1/remind?from=k" });
    expect(t.line.action.href).toBe(remindHref(peopleOf(groups, "owed")[0]));
  });

  it("three flatmates owe you 12,000 + 11,000 + 8,480 = ₹31,480: “3 flatmates” to You, faces K A M, “Remind all 3” to the list", () => {
    const groups = [grp("g1", "Flat 402", "INR", [], [["a", "Asha", 1100000], ["k", "Kabir", 1200000], ["m", "Meera", 848000]])];
    const t = ticketFor(groups, { g1: "home" }, "owed");
    expect(t.kind).toBe("one");
    if (t.kind !== "one") return;
    expect(t).toMatchObject({ from: "3 flatmates", to: "You" });
    expect(t.line).toMatchObject({ count: 3, amount: "₹31,480", faces: ["K", "A", "M"], peopleHref: "/settle#remind" });
    expect(t.line.action).toMatchObject({ key: "remind", label: "Remind all 3", href: "/settle#remind" });
  });

  it("you owe three people: “You” to “3 people”, and Pay goes to the biggest one (Kabir ₹12,000)", () => {
    const groups = [grp("g1", "Goa", "INR", [["a", "Asha", 1100000], ["k", "Kabir", 1200000], ["m", "Meera", 848000]])];
    const t = ticketFor(groups, { g1: "trip" }, "owe");
    expect(t.kind).toBe("one");
    if (t.kind !== "one") return;
    expect(t).toMatchObject({ from: "You", to: "3 people" });
    expect(t.line).toMatchObject({ amount: "₹31,480", peopleHref: "/settle#pay" });
    expect(t.line.action).toMatchObject({ key: "pay", label: "Pay Kabir" });
    expect(t.line.action.href).toBe(payHref(peopleOf(groups, "owe")[0], "INR"));
  });

  it("both ways: you owe Nupur ₹4,200 and Kabir owes you ₹22,916 stay two lines, never ₹18,716", () => {
    const groups = [grp("g1", "Flat 402", "INR", [["n", "Nupur", 420000]], [["k", "Kabir", 2291600]])];
    const t = ticketFor(groups, { g1: "home" }, "owed");
    expect(t.kind).toBe("both");
    if (t.kind !== "both") return;
    const [a, b] = t.lines;
    expect(a).toMatchObject({ side: "owe", name: "Nupur", amount: "₹4,200", phrase: "You owe Nupur" });
    expect(a.action).toMatchObject({ key: "pay", label: "Pay", bright: true });
    expect(b).toMatchObject({ side: "owed", name: "Kabir", amount: "₹22,916", phrase: "Kabir owes you" });
    expect(b.action).toMatchObject({ key: "remind", label: "Remind", bright: false, href: "/groups/g1/remind?from=k" });
    expect(JSON.stringify(t)).not.toContain("18,716");
  });

  it("both ways with several people on one side: a count and that side's total, each side with its own list link", () => {
    const groups = [grp("g1", "Flat 402", "INR", [["n", "Nupur", 420000]], [["k", "Kabir", 1000000], ["a", "Asha", 500000]])];
    const t = ticketFor(groups, { g1: "home" }, "owed");
    expect(t.kind).toBe("both");
    if (t.kind !== "both") return;
    expect(t.lines[1]).toMatchObject({ name: "2 flatmates", amount: "₹15,000", phrase: "2 flatmates owe you", peopleHref: "/settle#remind" });
    expect(t.lines[1].action).toMatchObject({ label: "Remind", href: "/settle#remind" });
    expect(t.lines[0].peopleHref).toBe("/settle#pay");
  });

  it("owing in one group and owed in another, even net: still two lines (the net being zero hides nothing)", () => {
    const groups = [grp("g1", "Goa", "INR", [["n", "Nupur", 100000]]), grp("g2", "Flat", "INR", [], [["k", "Kabir", 100000]])];
    expect(ticketFor(groups, { g1: "trip", g2: "home" }, "even").kind).toBe("both");
  });

  it("money across two groups: the stub's mark and name follow the group with the most money, and the line says “and 1 more”", () => {
    const groups = [grp("g1", "Flat", "INR", [["n", "Nupur", 420000]]), grp("g2", "Thailand Trip", "INR", [["n", "Nupur", 5000000]])];
    // The same signed-in person in both groups is one person: ₹4,200 + ₹50,000 = ₹54,200.
    const t = ticketFor(groups, { g1: "home", g2: "trip" }, "owe");
    expect(t.kind).toBe("one");
    if (t.kind === "one") {
      expect(t.mark).toBe("plane");
      expect(t.line).toMatchObject({ count: 1, amount: "₹54,200" });
      expect(t.context).toBe("Thailand Trip and 1 more");
    }
  });

  it("different currencies with no saved rate: each keeps its own amount in the one line", () => {
    const groups = [grp("g1", "Flat", "INR", [], [["k", "Kabir", 420000]]), grp("g2", "NYC", "USD", [], [["a", "Asha", 2000]])];
    const t = ticketFor(groups, { g1: "home", g2: "trip" }, "owed", (n, c) => (c === "INR" ? n : null));
    expect(t.kind).toBe("one");
    if (t.kind === "one") {
      expect(t.line.amount.split(" · ")).toHaveLength(2);
      expect(t.line.amount).toContain("₹4,200");
    }
  });

  it("it evens out and nobody can be named: the card's own total with Settle up", () => {
    const t = homeTicket({ mode: "even", acrossCurrencies: true, owe: [], owed: [], common: "INR", hero: { text: "+₹500 · −€20" }, groups: [] });
    expect(t).toMatchObject({ kind: "neutral", label: "Across currencies", amount: "+₹500 · −€20" });
    if (t.kind === "neutral") expect(t.action).toMatchObject({ key: "settle", label: "Settle up", href: "/settle" });
  });

  it("never offers “Add expense”: the bottom bar's + does that", () => {
    const groups = [grp("g1", "Goa", "INR", [["n", "Nupur", 5000]], [["k", "Kabir", 9000]])];
    expect(JSON.stringify(ticketFor(groups, { g1: "trip" }, "owed"))).not.toContain("Add expense");
    expect(JSON.stringify(ticketFor([], {}, "square"))).not.toContain("Add expense");
  });
});

describe("the status under each polaroid's name", () => {
  const f = (n: number) => `₹${n / 100}`;
  it("owe: “You owe ₹541.22”-style words in the owe colour; owed: “Owed …”; even: “✓ All settled”", () => {
    expect(cardStatus(-5412200, (n) => `₹${n / 100}`)).toEqual({ text: "You owe ₹54122", tone: "owe" });
    expect(cardStatus(300000, f)).toEqual({ text: "Owed ₹3000", tone: "owed" });
    expect(cardStatus(0, f)).toEqual({ text: "✓ All settled", tone: "square" });
  });
  it("it is the same balance and tone as the polaroid's tag hook, only the words differ", () => {
    for (const b of [-5412200, 0, 300000]) expect(cardStatus(b, f).tone).toBe(cardBalance(b, f).tone);
  });
});
