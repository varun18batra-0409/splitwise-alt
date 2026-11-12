import { describe, expect, it } from "vitest";
import { firstName, moneyActions, moneyLabel, moneyPeople, payHref, peopleLine, personButtonLabel, remindHref, whoLine, type PeopleGroup } from "@/lib/home/money-card";
import { crossSettle, settleRowId } from "@/lib/cross-settle";
import { formatMoney } from "@/lib/money";

// The people line on Home's money card: initial circles and "Nupur, Ravi and 2 others". No amounts on Home.
// Amounts (minor units, paise) are only used here to put the biggest first.

const same = (n: number) => n; // all one currency
const person = (id: string, name: string, accountId: string | null = `acc-${id}`) => ({ id, name, phone: "", accountId });

// A group where I ("me") pay each person the amount given.
const iPay = (groupId: string, groupName: string, currency: string, pays: [string, string, number, (string | null)?][]): PeopleGroup => ({
  groupId,
  groupName,
  currency,
  myId: "me",
  members: [{ id: "me", name: "Me", phone: "", accountId: "acc-me" }, ...pays.map(([id, name, , acc]) => person(id, name, acc === undefined ? `acc-${id}` : acc))],
  transfers: pays.map(([id, , amount]) => ({ from: "me", to: id, amount })),
});
const line = (groups: PeopleGroup[], side: "owe" | "owed" = "owe", toCommon: (n: number, c: string) => number | null = same) => peopleLine(moneyPeople(groups, side, "INR", toCommon));

describe("Home money card: who the money is with", () => {
  it("labels are just “You owe” / “Coming back to you”", () => {
    expect(moneyLabel({ mode: "owe" })).toBe("You owe");
    expect(moneyLabel({ mode: "owed" })).toBe("Coming back to you");
  });

  it("one person: “Nupur”", () => {
    const l = line([iPay("g1", "Goa", "INR", [["n", "Nupur", 50000]])]);
    expect(l.text).toBe("Nupur");
    expect(l.names).toEqual(["Nupur"]);
  });

  it("two people: “Nupur and Ravi”, biggest first (₹500 before ₹300 whatever the order they were listed in)", () => {
    const l = line([iPay("g1", "Goa", "INR", [["r", "Ravi", 30000], ["n", "Nupur", 50000]])]);
    expect(l.text).toBe("Nupur and Ravi");
    expect(l.names).toEqual(["Nupur", "Ravi"]);
  });

  it("three people: “Nupur, Ravi and Asha” (500, 300, 200)", () => {
    const l = line([iPay("g1", "Goa", "INR", [["a", "Asha", 20000], ["r", "Ravi", 30000], ["n", "Nupur", 50000]])]);
    expect(l.text).toBe("Nupur, Ravi and Asha");
    expect(l.names).toEqual(["Nupur", "Ravi", "Asha"]);
  });

  it("five people: “Nupur, Ravi and 3 others”, and only three circles", () => {
    const l = line([iPay("g1", "Goa", "INR", [["a", "A", 5000], ["b", "B", 10000], ["c", "C", 20000], ["d", "Ravi", 30000], ["e", "Nupur", 50000]])]);
    expect(l.text).toBe("Nupur, Ravi and 3 others");
    expect(l.names).toEqual(["Nupur", "Ravi", "C"]);
  });

  it("four people: “and 2 others”", () => {
    const l = line([iPay("g1", "Goa", "INR", [["a", "A", 1000], ["b", "B", 2000], ["c", "C", 3000], ["d", "D", 4000]])]);
    expect(l.text).toBe("D, C and 2 others");
  });

  it("the same signed-in person in two groups is named once: Goa 300 + Flat 200 = Nupur 500", () => {
    const groups = [iPay("g1", "Goa", "INR", [["n1", "Nupur", 30000, "acc-nupur"]]), iPay("g2", "Flat 402", "INR", [["n2", "Nupur", 20000, "acc-nupur"]])];
    expect(moneyPeople(groups, "owe", "INR", same).map((e) => e.amount)).toEqual([50000]);
    expect(line(groups).text).toBe("Nupur");
  });

  it("nets across groups like Settle up: I pay Asha 400 in Goa, she pays me 100 in the Flat -> I owe her 300, and she is not on the “owed” side", () => {
    const flat: PeopleGroup = {
      groupId: "g2",
      groupName: "Flat",
      currency: "INR",
      myId: "me",
      members: [{ id: "me", name: "Me", phone: "", accountId: "acc-me" }, person("a2", "Asha", "acc-asha")],
      transfers: [{ from: "a2", to: "me", amount: 10000 }],
    };
    const groups = [iPay("g1", "Goa", "INR", [["a1", "Asha", 40000, "acc-asha"]]), flat];
    expect(moneyPeople(groups, "owe", "INR", same).map((e) => e.amount)).toEqual([30000]);
    expect(line(groups, "owed").text).toBe("");
  });

  it("people added by name only are not merged: “Ravi (Goa) and Ravi (Flat 402)”", () => {
    const l = line([iPay("g1", "Goa", "INR", [["r1", "Ravi", 30000, null]]), iPay("g2", "Flat 402", "INR", [["r2", "Ravi", 20000, null]])]);
    expect(l.text).toBe("Ravi (Goa) and Ravi (Flat 402)");
  });

  it("people who owe me are on the “owed” side only", () => {
    const g: PeopleGroup = {
      groupId: "g1",
      groupName: "Goa",
      currency: "INR",
      myId: "me",
      members: [{ id: "me", name: "Me", phone: "", accountId: "acc-me" }, person("m", "Meera"), person("a", "Asha")],
      transfers: [{ from: "a", to: "me", amount: 1725100 }, { from: "m", to: "me", amount: 1761800 }],
    };
    expect(line([g], "owed").text).toBe("Meera and Asha"); // ₹17,618 before ₹17,251
    expect(line([g], "owe").text).toBe("");
  });

  it("mixed currencies with no saved rate: both people are still named; the INR one first", () => {
    const noRate = (n: number, c: string) => (c === "INR" ? n : null);
    const l = line([iPay("g1", "Goa", "INR", [["n", "Nupur", 50000]]), iPay("g2", "Phuket", "THB", [["m", "Mali", 30000]])], "owe", noRate);
    expect(l.text).toBe("Nupur and Mali");
  });

  it("a person with money in two currencies is named once", () => {
    const noRate = (n: number, c: string) => (c === "INR" ? n : null);
    const l = line([iPay("g1", "Goa", "INR", [["n1", "Nupur", 50000, "acc-n"]]), iPay("g2", "Phuket", "THB", [["n2", "Nupur", 30000, "acc-n"]])], "owe", noRate);
    expect(l.names).toEqual(["Nupur"]);
  });

  it("all square: no line", () => {
    const g: PeopleGroup = { groupId: "g1", groupName: "Goa", currency: "INR", myId: "me", members: [person("me", "Me")], transfers: [] };
    expect(line([g])).toEqual({ names: [], text: "" });
  });
});

// ---- The who-line under the amount: "Nupur ₹1,800 · Ravi ₹650" ----
// Amounts are paise: ₹1,800 = 180000. Same entries as the people line, so the same rules about who counts.

// A group where each person pays ME the amount given.
const theyPay = (groupId: string, groupName: string, pays: [string, string, number, (string | null)?][]): PeopleGroup => ({
  groupId,
  groupName,
  currency: "INR",
  myId: "me",
  members: [{ id: "me", name: "Me", phone: "", accountId: "acc-me" }, ...pays.map(([id, name, , acc]) => person(id, name, acc === undefined ? `acc-${id}` : acc))],
  transfers: pays.map(([id, , amount]) => ({ from: id, to: "me", amount })),
});
const who = (groups: PeopleGroup[], side: "owe" | "owed" = "owe", toCommon: (n: number, c: string) => number | null = same) => whoLine(moneyPeople(groups, side, "INR", toCommon));

describe("the who-line: names with amounts", () => {
  it("two people: Nupur ₹1,800 and Ravi ₹650 -> “Nupur ₹1,800 · Ravi ₹650”, nothing after", () => {
    const l = who([iPay("g1", "Goa", "INR", [["r", "Ravi", 65000], ["n", "Nupur", 180000]])]);
    expect(l.text).toBe("Nupur ₹1,800 · Ravi ₹650");
    expect(l.parts.map((p) => p.name)).toEqual(["Nupur", "Ravi"]);
    expect(l.tail).toBe("");
  });

  it("one person: just “Nupur ₹1,800”", () => {
    expect(who([iPay("g1", "Goa", "INR", [["n", "Nupur", 180000]])]).text).toBe("Nupur ₹1,800");
  });

  it("four people (₹4,000, ₹3,000, ₹200, ₹100): top two with amounts, then “· 2 others”", () => {
    const l = who([iPay("g1", "Goa", "INR", [["a", "Asha", 10000], ["b", "Bela", 20000], ["c", "Chirag", 300000], ["d", "Dev", 400000]])]);
    expect(l.text).toBe("Dev ₹4,000 · Chirag ₹3,000 · 2 others");
    expect(l.others).toBe(2);
  });

  it("three people: “· 1 other” (singular)", () => {
    const l = who([iPay("g1", "Goa", "INR", [["a", "Asha", 10000], ["b", "Bela", 20000], ["c", "Chirag", 300000]])]);
    expect(l.text).toBe("Chirag ₹3,000 · Bela ₹200 · 1 other");
  });

  it("rounding is Home's rule: exact under ₹1,000, whole rupees from ₹1,000, exact amount kept for the tooltip", () => {
    const one = (paise: number) => who([iPay("g1", "Goa", "INR", [["n", "Nupur", paise]])]).parts[0];
    expect(one(99999)).toMatchObject({ amount: "₹999.99", exact: "₹999.99" }); // ₹999.99 stays exact
    expect(one(100000)).toMatchObject({ amount: "₹1,000", exact: "₹1,000" });
    expect(one(100049)).toMatchObject({ amount: "₹1,000", exact: "₹1,000.49" }); // 1000.49 rounds down
    expect(one(100050)).toMatchObject({ amount: "₹1,001", exact: "₹1,000.50" }); // 1000.50 rounds up
    expect(who([iPay("g1", "Goa", "INR", [["n", "Nupur", 100050]])]).label).toBe("Nupur ₹1,000.50"); // spoken label is exact
  });

  it("mixed groups sum per person: Nupur ₹900 in Goa + ₹100 in the Flat = ₹1,000 (shown ₹1,000, not ₹900); Ravi ₹120 in the Flat only", () => {
    const groups = [iPay("g1", "Goa", "INR", [["n1", "Nupur", 90000, "acc-nupur"]]), iPay("g2", "Flat", "INR", [["n2", "Nupur", 10000, "acc-nupur"], ["r", "Ravi", 12000]])];
    expect(who(groups).text).toBe("Nupur ₹1,000 · Ravi ₹120");
  });

  it("nets like Settle up: I pay Asha ₹400 in Goa and she pays me ₹100 in the Flat -> I owe ₹300; she is not on the owed line", () => {
    const groups = [iPay("g1", "Goa", "INR", [["a1", "Asha", 40000, "acc-asha"]]), theyPay("g2", "Flat", [["a2", "Asha", 10000, "acc-asha"]])];
    expect(who(groups).text).toBe("Asha ₹300");
    expect(who(groups, "owed").text).toBe("");
  });

  it("people who owe me, largest first: Meera ₹17,618 before Asha ₹17,251", () => {
    expect(who([theyPay("g1", "Goa", [["a", "Asha", 1725100], ["m", "Meera", 1761800]])], "owed").text).toBe("Meera ₹17,618 · Asha ₹17,251");
  });

  it("a converted amount carries ≈ (THB 300.00 at 1 THB = ₹2.50 -> ≈ ₹750)", () => {
    const toInr = (n: number, c: string) => (c === "THB" ? Math.round(n * 2.5) : n);
    const l = who([iPay("g1", "Phuket", "THB", [["m", "Mali", 30000]])], "owe", toInr);
    expect(l.parts[0].amount).toBe("≈ ₹750");
  });

  it("two name-only Ravis stay two people, told apart by group", () => {
    const l = who([iPay("g1", "Goa", "INR", [["r1", "Ravi", 30000, null]]), iPay("g2", "Flat 402", "INR", [["r2", "Ravi", 20000, null]])]);
    expect(l.text).toBe("Ravi (Goa) ₹300 · Ravi (Flat 402) ₹200");
  });

  it("nobody: empty line", () => {
    expect(who([{ groupId: "g1", groupName: "Goa", currency: "INR", myId: "me", members: [person("me", "Me")], transfers: [] }])).toMatchObject({ text: "", parts: [], others: 0 });
  });
});

describe("the main button: who to pay, who to remind, and where it goes", () => {
  const owe = (groups: PeopleGroup[]) => moneyActions("owe", moneyPeople(groups, "owe", "INR", same), "INR");
  const owed = (groups: PeopleGroup[]) => moneyActions("owed", moneyPeople(groups, "owed", "INR", same), "INR");

  it("owing Nupur ₹1,800 and Ravi ₹650: the bright button is “Pay Nupur ₹1,800” to her row on /settle; the second is Add expense", () => {
    const [main, second] = owe([iPay("g1", "Goa", "INR", [["r", "Ravi", 65000], ["n", "Nupur", 180000, "acc-nupur"]])]);
    expect(main).toMatchObject({ key: "pay", label: "Pay Nupur ₹1,800", href: "/settle#pay-acc_acc-nupur", bright: true });
    expect(second).toMatchObject({ key: "add", label: "Add expense", href: "/add", bright: false });
  });

  it("the row id on /settle is the same one Home links to", () => {
    expect(settleRowId("pay", "acc:acc-nupur")).toBe("pay-acc_acc-nupur");
    expect(settleRowId("remind", "tel:9876543210")).toBe("remind-tel_9876543210");
  });

  it("long names and long amounts shorten instead of overflowing", () => {
    expect(firstName("Priyadarshini Rao")).toBe("Priyadarshi…"); // 11 letters + …
    expect(personButtonLabel("Pay", "Priyadarshi…", "₹1,800")).toBe("Pay Priyadarshi…"); // 23 characters with the amount, so no amount
    expect(personButtonLabel("Pay", "Ravi", "₹12,34,567")).toBe("Pay Ravi"); // 19 characters
    expect(personButtonLabel("Pay", "Nupur", "₹1,800")).toBe("Pay Nupur ₹1,800"); // exactly 16 fits
    expect(personButtonLabel("Pay", "Ravi", undefined)).toBe("Pay Ravi");
  });

  it("a converted amount is not in the button (only “Pay Mali”)", () => {
    const toInr = (n: number, c: string) => (c === "THB" ? Math.round(n * 2.5) : n);
    const [main] = moneyActions("owe", moneyPeople([iPay("g1", "Phuket", "THB", [["m", "Mali", 30000]])], "owe", "INR", toInr), "INR");
    expect(main.label).toBe("Pay Mali");
  });

  it("an amount with no saved rate has no row on /settle, so Pay goes to that group's own Settle up", () => {
    const noRate = (n: number, c: string) => (c === "INR" ? n : null);
    const people = moneyPeople([iPay("g2", "Phuket", "THB", [["m", "Mali", 30000]])], "owe", "INR", noRate);
    expect(payHref(people[0], "INR")).toBe("/groups/g2/settle");
  });

  it("owed by Kabir ₹300 in Goa and ₹500 in the Flat: “Remind Kabir” opens the remind route for the Flat (where he owes most)", () => {
    const groups = [theyPay("g1", "Goa", [["k1", "Kabir", 30000, "acc-kabir"], ["x", "Xena", 10000]]), theyPay("g2", "Flat", [["k2", "Kabir", 50000, "acc-kabir"]])];
    const [main, second] = owed(groups);
    expect(main).toMatchObject({ key: "remind", label: "Remind Kabir", href: "/groups/g2/remind?from=k2", bright: true });
    expect(second.label).toBe("Add expense");
    // Kabir is the biggest: ₹800 against Xena's ₹100.
    expect(who(groups, "owed").text).toBe("Kabir ₹800 · Xena ₹100");
  });

  it("remind never picks a group where I am the one paying", () => {
    const flat = iPay("g2", "Flat", "INR", [["k2", "Kabir", 90000, "acc-kabir"]]); // I pay Kabir ₹900 here
    const goa = theyPay("g1", "Goa", [["k1", "Kabir", 100000, "acc-kabir"]]); // he pays me ₹1,000 there -> he owes me ₹100 net
    const p = moneyPeople([goa, flat], "owed", "INR", same)[0];
    expect(p.amount).toBe(10000);
    expect(remindHref(p)).toBe("/groups/g1/remind?from=k1");
  });

  it("all square and even keep today's buttons", () => {
    expect(moneyActions("square", [], "INR").map((b) => b.label)).toEqual(["Add expense", "New group"]);
    expect(moneyActions("even", [], "INR").map((b) => b.label)).toEqual(["Add expense", "Settle up"]);
    expect(moneyActions("square", [], "INR")[0].bright).toBe(true);
  });

  it("owing but nobody named: today's buttons, Settle up bright", () => {
    const [add, settle] = moneyActions("owe", [], "INR");
    expect(add).toMatchObject({ key: "add", bright: false });
    expect(settle).toMatchObject({ key: "settle", label: "Settle up", bright: true });
  });
});

// ---- Money in both directions: the line has to explain the net amount in the card ----
describe("the who-line when money goes both ways", () => {
  // I owe Nupur ₹1,800 (Goa); Ravi owes me ₹1,000 (Flat).
  const goa = iPay("g1", "Goa", "INR", [["n", "Nupur", 180000]]);
  const flat = theyPay("g2", "Flat", [["r", "Ravi", 100000]]);
  const both = [goa, flat];
  const owePeople = moneyPeople(both, "owe", "INR", same);
  const owedPeople = moneyPeople(both, "owed", "INR", same);

  it("owe ₹1,800, ₹1,000 coming back: the card says ₹800 and the line names both", () => {
    expect(formatMoney(180000 - 100000)).toBe("₹800"); // 1,800 - 1,000 = 800
    const l = whoLine(owePeople, owedPeople, "owe");
    expect(l.text).toBe("Nupur ₹1,800 · Ravi owes you ₹1,000");
    expect(l.opposite).toMatchObject({ name: "Ravi", amount: "₹1,000", kind: "owes-you" });
    expect(l.label).toBe("Nupur ₹1,800. Also Ravi owes you ₹1,000");
  });

  it("the other way round (owed ₹5,000 by Meera, I owe Asha ₹200): “Meera ₹5,000 · you owe Asha ₹200”, card ₹4,800", () => {
    const g = [theyPay("g1", "Goa", [["m", "Meera", 500000]]), iPay("g2", "Flat", "INR", [["a", "Asha", 20000]])];
    expect(formatMoney(500000 - 20000)).toBe("₹4,800");
    expect(whoLine(moneyPeople(g, "owed", "INR", same), moneyPeople(g, "owe", "INR", same), "owed").text).toBe("Meera ₹5,000 · you owe Asha ₹200");
  });

  it("three people on the main side and one on the other: top two, “· 1 other”, then the other side's person (3 names in all)", () => {
    const main = iPay("g1", "Goa", "INR", [["c", "Chirag", 300000], ["b", "Bela", 200000], ["a", "Asha", 100000]]);
    const back = theyPay("g2", "Flat", [["r", "Ravi", 100000]]);
    const l = whoLine(moneyPeople([main, back], "owe", "INR", same), moneyPeople([main, back], "owed", "INR", same), "owe");
    expect(l.text).toBe("Chirag ₹3,000 · Bela ₹2,000 · 1 other · Ravi owes you ₹1,000");
    expect(l.parts.length + (l.opposite ? 1 : 0)).toBe(3);
    expect(formatMoney(300000 + 200000 + 100000 - 100000)).toBe("₹5,000"); // what the card would say
  });

  it("only the biggest person from the other side is added (Ravi ₹1,000 before Kiran ₹300)", () => {
    const back = theyPay("g2", "Flat", [["k", "Kiran", 30000], ["r", "Ravi", 100000]]);
    const l = whoLine(moneyPeople([goa, back], "owe", "INR", same), moneyPeople([goa, back], "owed", "INR", same), "owe");
    expect(l.text).toBe("Nupur ₹1,800 · Ravi owes you ₹1,000");
  });

  it("nothing going the other way: no extra part; the Pay button is unchanged either way", () => {
    expect(whoLine(moneyPeople([goa], "owe", "INR", same), moneyPeople([goa], "owed", "INR", same), "owe")).toMatchObject({ opposite: null, text: "Nupur ₹1,800" });
    expect(moneyActions("owe", owePeople, "INR")[0]).toMatchObject({ key: "pay", label: "Pay Nupur ₹1,800", href: "/settle#pay-acc_acc-n" });
  });
});

// ---- Home must agree with /settle: same people, same amounts, same row ids ----
describe("Home's per-person amounts equal the rows on /settle", () => {
  // Goa: I pay Nupur ₹1,200; Ravi pays me ₹1,500.   Flat: I pay Nupur ₹600 and Ravi ₹500; Asha pays me ₹200.
  // By hand: Nupur -1,200 - 600 = -₹1,800 (I owe); Ravi +1,500 - 500 = +₹1,000; Asha +₹200.
  const goa: PeopleGroup = {
    groupId: "g1",
    groupName: "Goa",
    currency: "INR",
    myId: "me",
    members: [person("me", "Me"), person("n1", "Nupur", "acc-nupur"), person("r1", "Ravi", "acc-ravi")],
    transfers: [{ from: "me", to: "n1", amount: 120000 }, { from: "r1", to: "me", amount: 150000 }],
  };
  const flat: PeopleGroup = {
    groupId: "g2",
    groupName: "Flat",
    currency: "INR",
    myId: "me",
    members: [person("me", "Me"), person("n2", "Nupur", "acc-nupur"), person("r2", "Ravi", "acc-ravi"), person("a2", "Asha", "acc-asha")],
    transfers: [{ from: "me", to: "n2", amount: 60000 }, { from: "me", to: "r2", amount: 50000 }, { from: "a2", to: "me", amount: 20000 }],
  };
  const groups = [goa, flat];
  const settle = crossSettle(groups, "INR", same).items; // exactly what the /settle page builds its rows from

  it("/settle's rows are the hand-worked ones", () => {
    expect(settle.map((i) => [i.name, i.net])).toEqual([["Nupur", -180000], ["Ravi", 100000], ["Asha", 20000]]);
  });

  it("every “you owe” person: same amount and same #pay id as /settle's row", () => {
    const home = moneyPeople(groups, "owe", "INR", same);
    const rows = settle.filter((i) => i.net < 0);
    expect(home.map((h) => [h.key, h.amount])).toEqual(rows.map((r) => [r.key, -r.net]));
    expect(payHref(home[0], "INR")).toBe(`/settle#${settleRowId("pay", rows[0].key)}`);
    expect(whoLine(home).parts[0].amount).toBe("₹1,800");
  });

  it("every “owed to you” person: same amounts, same order, same people as /settle's “Coming to you” rows", () => {
    const home = moneyPeople(groups, "owed", "INR", same);
    const rows = settle.filter((i) => i.net > 0);
    expect(home.map((h) => [h.key, h.name, h.amount])).toEqual(rows.map((r) => [r.key, r.name, r.net]));
    expect(whoLine(home).text).toBe("Ravi ₹1,000 · Asha ₹200");
    // Remind goes to the group where Ravi owes most (Goa ₹1,500, member r1), the same part /settle's Remind uses.
    const biggest = [...rows[0].parts].filter((p) => !p.iPay).sort((a, b) => b.amount - a.amount)[0];
    expect(remindHref(home[0])).toBe(`/groups/${biggest.groupId}/remind?from=${biggest.fromId}`);
    expect(remindHref(home[0])).toBe("/groups/g1/remind?from=r1");
  });

  it("the card's net equals what /settle's rows add up to: 1,000 + 200 - 1,800 = -₹600", () => {
    expect(settle.reduce((t, i) => t + i.net, 0)).toBe(-60000);
  });
});
