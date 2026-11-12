import { describe, expect, it } from "vitest";
import { orderStories } from "@/lib/home/story-order";
import { cardBalance, CARD_ROW_MAX, rowEnd, tripTag } from "@/lib/home/group-card";
import { moneyLabel } from "@/lib/home/money-card";
import { formatMoney } from "@/lib/money";

// Home, design A: stories row, slim money card, group polaroids.

describe("stories row: order", () => {
  const s = (id: string, at: number) => ({ id, at });
  it("nothing to show -> an empty list (Home hides the whole row)", () => {
    expect(orderStories([], new Set())).toEqual([]);
  });
  it("unseen first, most recent first; then the seen ones, most recent first", () => {
    const list = [s("goa", 50), s("pot", 90), s("thai", 10), s("year", 70), s("nov", 30)];
    // seen: goa and year. Unseen by recency: pot 90, nov 30, thai 10. Seen by recency: year 70, goa 50.
    expect(orderStories(list, new Set(["goa", "year"])).map((x) => x.id)).toEqual(["pot", "nov", "thai", "year", "goa"]);
  });
  it("all unseen -> pure recency; all seen -> pure recency", () => {
    const list = [s("a", 1), s("b", 3), s("c", 2)];
    expect(orderStories(list, new Set()).map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(orderStories(list, new Set(["a", "b", "c"])).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
  it("a seen id that isn't in the list changes nothing, and the input isn't changed", () => {
    const list = [s("a", 1), s("b", 2)];
    expect(orderStories(list, new Set(["zzz"])).map((x) => x.id)).toEqual(["b", "a"]);
    expect(list.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("group cards: balance words and colour", () => {
  it("owed to you -> green, with a plus", () => {
    // 17,618 rupees = 1,761,800 paise
    expect(cardBalance(1761800, (n) => formatMoney(n, "INR"))).toEqual({ text: "+₹17,618", tone: "owed", spoken: "you’re owed ₹17,618" });
  });
  it("you owe -> orange, with a minus sign (not a hyphen)", () => {
    const b = cardBalance(-50000, (n) => formatMoney(n, "INR")); // 500 rupees
    expect(b).toEqual({ text: "−₹500", tone: "owe", spoken: "you owe ₹500" });
    expect(b.text.startsWith("−")).toBe(true);
  });
  it("even -> the word “square”, no colour", () => {
    expect(cardBalance(0, (n) => formatMoney(n, "INR"))).toEqual({ text: "square", tone: "square", spoken: "all square" });
  });
  it("uses the group's own currency and format", () => {
    expect(cardBalance(1250, (n) => formatMoney(n, "USD")).text).toBe("+$12.50");
    expect(cardBalance(-4797500, (n) => formatMoney(n, "INR")).text).toBe("−₹47,975");
  });
});

describe("group cards: the trip tag", () => {
  it("a trip that is on says which day", () => {
    expect(tripTag({ kind: "during", day: 2, of: 5 })).toBe("Day 2 of 5");
    expect(tripTag({ kind: "today" })).toBe("Starts today");
  });
  it("no tag before, after or without a trip", () => {
    expect(tripTag({ kind: "before", days: 6 })).toBeNull();
    expect(tripTag(null)).toBeNull();
    expect(tripTag(undefined)).toBeNull();
  });
});

describe("group cards: the end of the row", () => {
  it("“+ New group” is the first card now, so the end of the row never offers it (1 to 10 groups -> nothing extra)", () => {
    for (const n of [1, 2, 3, 4, 7, CARD_ROW_MAX]) expect(rowEnd(n)).toBeNull();
  });
  it("more than 10 -> “See all N” instead of a very long row", () => {
    expect(rowEnd(CARD_ROW_MAX + 1)).toBe("all");
  });
});

describe("slim money card label", () => {
  const two = [{ name: "Asha", net: -200000 }, { name: "Ravi", net: -145000 }];
  it("owed -> Coming back to you", () => expect(moneyLabel({ mode: "owed", people: [] })).toBe("Coming back to you"));
  it("you owe -> just “You owe” (the people line says who)", () => {
    expect(moneyLabel({ mode: "owe", people: two })).toBe("You owe");
    expect(moneyLabel({ mode: "owe", people: [two[0]] })).toBe("You owe");
    expect(moneyLabel({ mode: "owe" })).toBe("You owe");
  });
  it("square and even and mixed currencies", () => {
    expect(moneyLabel({ mode: "square", people: [] })).toBe("Nobody owes anybody");
    expect(moneyLabel({ mode: "even", people: two })).toBe("It all evens out");
    expect(moneyLabel({ mode: "owe", acrossCurrencies: true, people: two })).toBe("Across currencies");
  });
});
