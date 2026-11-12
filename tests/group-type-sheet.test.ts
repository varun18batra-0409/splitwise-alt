import { describe, expect, it } from "vitest";
import { SHEET_OFF_KEY, markSheetSeen, sheetFor, sheetKey, shouldShowSheet } from "@/lib/group-type-sheet";

// A tiny phone storage, and one that is blocked (private browsing, strict settings).
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const blocked = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("the one-time group-type sheet: what it says", () => {
  it("a flat: two cards and the two buttons from the design", () => {
    const s = sheetFor("home", "g1")!;
    expect(s.title).toBe("Your home group is ready");
    expect(s.cards.map((c) => c.title)).toEqual(["Bills that repeat", "Moving in or out"]);
    expect(s.primary).toEqual({ label: "Add the first bill", href: "/groups/g1/bills/new" });
  });
  it("a couple: Your split first, plus one more card", () => {
    const s = sheetFor("couple", "g2")!;
    expect(s.cards).toHaveLength(2);
    expect(s.cards[0].title).toBe("Your split");
    expect(s.cards[0].body).toMatch(/60\/40/);
    expect(s.cards[0].body).toMatch(/incomes/);
    expect(s.primary.href).toBe("/groups/g2/add");
  });
  it("a card night: Game tally vs Money owed, and results go in only after confirming", () => {
    const s = sheetFor("pot", "g3")!;
    expect(s.cards[0].title).toBe("Game tally vs Money owed");
    expect(s.cards[1].body).toMatch(/asks before/);
    expect(s.primary.href).toBe("/groups/g3/pot/new");
  });
  it("trips and everything else get no sheet", () => {
    expect(sheetFor("trip", "g")).toBeNull();
    expect(sheetFor("other", "g")).toBeNull();
  });
  it("says nothing about India-only things or other apps", () => {
    for (const t of ["home", "couple", "pot"]) expect(JSON.stringify(sheetFor(t, "g"))).not.toMatch(/UPI|Diwali|Teen Patti|splitwise/i);
  });
});

describe("the one-time group-type sheet: shown once per phone and group", () => {
  it("shows the first time; “Got it” hides it for good; another group still shows", () => {
    const store = memory();
    expect(shouldShowSheet(store, "flat-1")).toBe(true);
    markSheetSeen(store, "flat-1"); // “Got it”
    expect(shouldShowSheet(store, "flat-1")).toBe(false);
    expect(shouldShowSheet(store, "flat-1")).toBe(false); // and on every later visit
    expect(shouldShowSheet(store, "flat-2")).toBe(true);
    expect(store.getItem(sheetKey("flat-1"))).toBe("1");
  });
  it("a test browser can switch it off", () => {
    const store = memory();
    store.setItem(SHEET_OFF_KEY, "1");
    expect(shouldShowSheet(store, "flat-1")).toBe(false);
  });
  it("never blocks the page: blocked or missing storage doesn’t throw and just leaves the sheet out", () => {
    expect(() => shouldShowSheet(blocked, "g")).not.toThrow();
    expect(shouldShowSheet(blocked, "g")).toBe(false);
    expect(() => markSheetSeen(blocked, "g")).not.toThrow();
    expect(shouldShowSheet(null, "g")).toBe(false);
    expect(shouldShowSheet(undefined, "g")).toBe(false);
    expect(() => markSheetSeen(undefined, "g")).not.toThrow();
  });
});
