import { describe, expect, it } from "vitest";
import { moneyLabel, moneyPeople, peopleLine, type PeopleGroup } from "@/lib/home/money-card";

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
