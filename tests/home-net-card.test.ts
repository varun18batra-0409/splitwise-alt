import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { homeNetCard, type NetItem } from "@/lib/home/money-card";

// Home's slim Net card (16 Nov). Amounts are paise (minor units); the expected figures are worked out by hand beside each test.
const same = (a: number) => a; // only INR here: nothing to convert
const inr = (net: number, direct: boolean): NetItem => ({ currency: "INR", net, direct });
const card = (items: NetItem[], toCommon: (a: number, c: string) => number | null = (a, c) => (c === "INR" ? same(a) : null)) => homeNetCard({ items, common: "INR", toCommon });

describe("the slim Net card", () => {
  it("(1) groups owe you 2291600 (₹22,916), you owe 60000 (₹600) directly: net 2291600 - 60000 = 2231600 (₹22,316), you're owed; lines +₹22,916 and −₹600", () => {
    const c = card([inr(2291600, false), inr(-60000, true)]);
    if (c.kind !== "net") throw new Error("net");
    expect(c.value).toBe(2231600);
    expect(c.tone).toBe("owed");
    expect(c.label).toBe("Net · you’re owed");
    expect(c.amount).toBe("₹22,316");
    expect(c.lines.map((l) => [l.kind, l.sign, l.amount, l.text])).toEqual([
      ["group", "+", 2291600, "Group +₹22,916"],
      ["direct", "−", -60000, "With a person −₹600"],
    ]);
    expect(c.aria).toBe("Net, you’re owed ₹22,316. Group +₹22,916, With a person −₹600. Open Settle up");
  });
  it("(2) you owe 50000 (₹500) in groups, you're owed 20000 (₹200) directly: net 20000 - 50000 = -30000, you owe ₹300; lines −₹500 and +₹200", () => {
    const c = card([inr(-50000, false), inr(20000, true)]);
    if (c.kind !== "net") throw new Error("net");
    expect(c.value).toBe(-30000);
    expect(c.tone).toBe("owe");
    expect(c.label).toBe("Net · you owe");
    expect(c.amount).toBe("₹300");
    expect(c.lines.map((l) => [l.kind, l.sign, l.text])).toEqual([
      ["group", "−", "Group −₹500"],
      ["direct", "+", "With a person +₹200"],
    ]);
  });
  it("(3) only groups, owed 2291600: net 2291600 and no lines (a single line would only repeat the net)", () => {
    const c = card([inr(2291600, false)]);
    if (c.kind !== "net") throw new Error("net");
    expect(c.value).toBe(2291600);
    expect(c.lines).toEqual([]);
    // two groups that net to the same thing: still one kind, still no lines
    const two = card([inr(1000000, false), inr(1291600, false)]);
    expect(two.kind === "net" && two.value).toBe(2291600);
    expect(two.kind === "net" && two.lines).toEqual([]);
  });
  it("a kind that nets to 0 is hidden, so the other one (which equals the net) is hidden too", () => {
    const c = card([inr(500000, false), inr(300000, true), inr(-300000, true)]);
    expect(c.kind === "net" && c.lines).toEqual([]);
    expect(c.kind === "net" && c.value).toBe(500000);
  });
  it("(4) everything zero, or nothing at all: All square, You’re all square", () => {
    for (const items of [[], [inr(0, false), inr(0, true)]]) {
      const c = card(items);
      expect(c).toMatchObject({ kind: "square", label: "All square", text: "You’re all square", href: "/settle" });
    }
  });
  it("it never says All square while any money is open, even when the net is 0: 'Net · evens out' with both lines", () => {
    const c = card([inr(40000, false), inr(-40000, true)]);
    if (c.kind !== "net") throw new Error("net");
    expect(c.value).toBe(0);
    expect(c.tone).toBe("plain");
    expect(c.label).toBe("Net · evens out");
    expect(c.amount).toBe("₹0");
    expect(c.lines).toHaveLength(2);
  });
  it("(5) the whole card is one link to /settle, in every state", () => {
    for (const items of [[], [inr(100, false)], [inr(-100, true)], [inr(100, false), inr(-50, true)]]) expect(card(items).href).toBe("/settle");
  });

  it("other currencies at a saved rate keep the ≈: €10 (1000 cents) at 90 rupees each = 90000 paise, added to ₹100 (10000) owed = 100000 → ≈ ₹1,000", () => {
    const toCommon = (a: number, c: string) => (c === "INR" ? a : c === "EUR" ? a * 90 : null);
    const c = card([inr(10000, false), { currency: "EUR", net: 1000, direct: true }], toCommon);
    if (c.kind !== "net") throw new Error("net");
    expect(c.value).toBe(100000);
    expect(c.approx).toBe(true);
    expect(c.amount).toBe("≈ ₹1,000");
    expect(c.lines.map((l) => l.text)).toEqual(["Group +₹100", "With a person ≈ +₹900"]);
  });
  it("a currency with no saved rate is not added into another: each currency on its own, no lines, never All square", () => {
    // ₹500 owed and €20 owed, no rate: "₹500 · EUR 20", you're owed
    const c = card([inr(50000, false), { currency: "EUR", net: 2000, direct: true }]);
    if (c.kind !== "net") throw new Error("net");
    expect(c.value).toBeNull();
    expect(c.tone).toBe("owed");
    expect(c.amount).toBe("₹500 · EUR 20");
    expect(c.lines).toEqual([]);
    // opposite directions: neutral, signs kept
    const m = card([inr(50000, false), { currency: "EUR", net: -2000, direct: true }]);
    expect(m.kind === "net" && [m.tone, m.label, m.amount]).toEqual(["plain", "Net · across currencies", "+₹500 · −EUR 20"]);
  });
});

describe("Home draws the card", () => {
  const hm = readFileSync(`${__dirname}/../src/components/HomeMoney.tsx`, "utf8");
  const page = readFileSync(`${__dirname}/../src/app/(home)/page.tsx`, "utf8");
  it("builds it from open groups (their balance) and pairs (marked direct), and the card is the only money block", () => {
    expect(page).toContain("homeNetCard({");
    expect(page).toContain("direct: false");
    expect(page).toContain("direct: true");
    expect(page).toContain("<MoneyCard card={netCard} />");
    expect(hm).toContain("export function MoneyCard({ card }: { card: NetCard })");
  });
});
