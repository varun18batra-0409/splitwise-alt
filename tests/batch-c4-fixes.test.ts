import { describe, expect, it, vi } from "vitest";
import { mixedDirections, moneyLead, moneySub } from "@/lib/home/money-card";
import { errorNeedsMore, fasterEntryColumns } from "@/lib/add-expense-more";
import { singleFlight } from "@/lib/single-flight";

describe("Scan a bill: one photo at a time", () => {
  it("two photos picked while the first is still being read send exactly one upload", async () => {
    let release: () => void = () => {};
    const post = vi.fn(() => new Promise<void>((r) => (release = r))); // a slow reply
    const pick = singleFlight(async (_file: string) => {
      await post();
    });
    const first = pick("bill-1.jpg");
    const second = await pick("bill-2.jpg"); // tapped again while busy
    expect(second).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toBe(true);
    // Once the first is done a new photo is accepted again.
    const third = pick("bill-3.jpg");
    release();
    expect(await third).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
  });
  it("a failed upload doesn't leave it stuck", async () => {
    const pick = singleFlight(async (n: number) => {
      if (n === 1) throw new Error("offline");
    });
    await expect(pick(1)).rejects.toThrow("offline");
    expect(await pick(2)).toBe(true);
  });
});

describe("Home money card: counting people on the right side", () => {
  // You owe A 500 and C 100; B owes you 300.
  const people = [
    { name: "Asha", net: -50000 },
    { name: "Ben", net: 30000 },
    { name: "Chitra", net: -10000 },
  ];
  it("“you owe … to N people” counts only the people you owe (2, not 3)", () => {
    expect(moneySub({ mode: "owe", groups: 2, allGroups: 2, people })).toBe("across 2 groups, to 2 people");
  });
  it("“coming back … from N people” counts only people who owe you (1: named)", () => {
    expect(moneySub({ mode: "owed", groups: 2, allGroups: 2, people })).toBe("across 2 groups, from Ben");
  });
  it("it evens out: everyone counts", () => {
    expect(moneySub({ mode: "even", groups: 2, allGroups: 2, people })).toBe("across 2 groups, with 3 people");
  });
});

describe("Home money card: no open groups", () => {
  it("doesn't say “your 0 groups”", () => {
    expect(moneySub({ mode: "square", groups: 0, allGroups: 0, people: [] })).toBe("Nobody owes anybody");
    expect(moneySub({ mode: "square", groups: 0, allGroups: 1, people: [] })).toBe("Nobody owes anybody in your group");
    expect(moneySub({ mode: "square", groups: 0, allGroups: 4, people: [] })).toBe("Nobody owes anybody in your 4 groups");
  });
});

describe("Home money card: several currencies with no saved rate", () => {
  it("one currency you're owed, one you owe -> neutral", () => {
    expect(mixedDirections(["+₹500.00", "−€20.00"])).toBe(true);
    expect(moneyLead("even", true)).toBe("Across currencies");
  });
  it("all pointing the same way keeps the normal wording", () => {
    expect(mixedDirections(["−€20.00", "−$10.00"])).toBe(false);
    expect(mixedDirections(["+₹500.00", "+€20.00"])).toBe(false);
    expect(moneyLead("owe", false)).toBe("You owe");
  });
  it("a square currency (zero) doesn't make it mixed", () => {
    expect(mixedDirections(["−€20.00", "+$0.00"])).toBe(false);
  });
});

describe("Add expense: More opens for a several-payers error", () => {
  it("opens for “The payers add up to …” and “Pick who paid.” when several payers is on", () => {
    expect(errorNeedsMore("The payers add up to ₹900.00, but the total is ₹1,000.00.", true)).toBe(true);
    expect(errorNeedsMore("Pick who paid.", true)).toBe(true);
  });
  it("not when several payers is off, or for other errors", () => {
    expect(errorNeedsMore("The payers add up to ₹900.00, but the total is ₹1,000.00.", false)).toBe(false);
    expect(errorNeedsMore("Enter an amount.", true)).toBe(false);
  });
});

describe("Add expense: the Faster entry row", () => {
  it("new expense, several people: Scan, Speak, Type a line", () => {
    expect(fasterEntryColumns({ billRun: false, quickOk: true, editing: false, hasPhoto: false })).toBe(3);
  });
  it("a waiting bill has no Scan button", () => {
    expect(fasterEntryColumns({ billRun: true, quickOk: true, editing: false, hasPhoto: false })).toBe(2);
  });
  it("editing with a photo: row hidden (Replace / Remove already do it)", () => {
    expect(fasterEntryColumns({ billRun: false, quickOk: false, editing: true, hasPhoto: true })).toBe(0);
  });
  it("editing without a photo: only “Bill photo”", () => {
    expect(fasterEntryColumns({ billRun: false, quickOk: false, editing: true, hasPhoto: false })).toBe(1);
  });
});
