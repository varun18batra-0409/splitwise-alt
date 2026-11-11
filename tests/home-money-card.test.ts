import { describe, expect, it } from "vitest";
import { moneyButtons, moneyLead, moneyMode, moneySub, stripWords } from "@/lib/home/money-card";

// Which of the two buttons on Home's money card is the bright one.
const brightOf = (mode: Parameters<typeof moneyButtons>[0]) => moneyButtons(mode).filter((b) => b.bright).map((b) => b.label);

describe("Home money card: where you stand", () => {
  it("you owe -> Settle up", () => {
    const m = moneyMode({ owedLines: 0, oweLines: 1, netValue: -345000 });
    expect(m).toBe("owe");
    expect(brightOf(m)).toEqual(["Settle up"]);
    expect(moneyButtons(m).map((b) => b.label)).toEqual(["Add expense", "Settle up"]);
  });
  it("you're owed -> Add expense is bright, Settle up is quiet", () => {
    const m = moneyMode({ owedLines: 1, oweLines: 0, netValue: 6826300 });
    expect(m).toBe("owed");
    expect(brightOf(m)).toEqual(["Add expense"]);
    expect(moneyButtons(m)[1].label).toBe("Settle up");
  });
  it("owed in one group and owing in another, net zero -> Add expense is bright", () => {
    const m = moneyMode({ owedLines: 1, oweLines: 1, netValue: 0 });
    expect(m).toBe("even");
    expect(brightOf(m)).toEqual(["Add expense"]);
  });
  it("all square -> Add expense is bright and the second button is New group", () => {
    const m = moneyMode({ owedLines: 0, oweLines: 0, netValue: 0 });
    expect(m).toBe("square");
    expect(brightOf(m)).toEqual(["Add expense"]);
    expect(moneyButtons(m)[1]).toEqual({ label: "New group", href: "/groups/new", bright: false });
  });
  it("Add expense always goes to /add (the group picker, or straight into the only group), like the bottom bar's +", () => {
    for (const m of ["owe", "owed", "even", "square"] as const) expect(moneyButtons(m)[0].href).toBe("/add");
  });
  it("exactly one button is bright, always", () => {
    for (const m of ["owe", "owed", "even", "square"] as const) expect(moneyButtons(m).filter((b) => b.bright)).toHaveLength(1);
  });
});

describe("Home money card: the words", () => {
  it("leads", () => {
    expect(moneyLead("owe")).toBe("You owe");
    expect(moneyLead("owed")).toBe("Coming back to you");
  });
  it("“across 3 groups, from 4 people”, “to” when you owe, “in one group” for one", () => {
    const four = [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }];
    expect(moneySub({ mode: "owed", groups: 3, allGroups: 3, people: four })).toBe("across 3 groups, from 4 people");
    expect(moneySub({ mode: "owe", groups: 2, allGroups: 3, people: [{ name: "Asha" }, { name: "Ravi" }] })).toBe("across 2 groups, to 2 people");
    expect(moneySub({ mode: "owe", groups: 1, allGroups: 1, people: [{ name: "Asha" }] })).toBe("in one group, to Asha");
    expect(moneySub({ mode: "square", groups: 0, allGroups: 3, people: [] })).toBe("Nobody owes anybody in your 3 groups");
  });
});

describe("Home countdown strip words", () => {
  it("before, tomorrow, today, during, after", () => {
    expect(stripWords("Goa", { kind: "before", days: 6 })).toEqual({ pre: "Goa in ", num: "6", post: " sleeps" });
    expect(stripWords("Goa", { kind: "before", days: 12 })).toEqual({ pre: "Goa in ", num: "12", post: " days" });
    expect(stripWords("Goa", { kind: "before", days: 70 })).toEqual({ pre: "Goa in ", num: "10", post: " weeks" });
    expect(stripWords("Goa", { kind: "before", days: 1 })).toEqual({ pre: "Goa ", post: "tomorrow" });
    expect(stripWords("Goa", { kind: "today" })).toEqual({ pre: "It’s Goa day", post: "" });
    expect(stripWords("Goa", { kind: "during", day: 3, of: 6 })).toEqual({ pre: "Goa, day 3 of 6", post: "" });
    expect(stripWords("Goa", { kind: "after" })).toBeNull();
  });
});
