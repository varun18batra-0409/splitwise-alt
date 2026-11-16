import { describe, expect, it, vi } from "vitest";

// LM-1 (16 Nov line review), the safety net behind the name matching: before anything is saved, a file whose lines don't add up is refused.
// Every expense's payers and shares must each add up to its amount, and everyone's balances together must be 0. A file that fails (a name
// that was matched wrongly, an amount that was read wrongly) used to be saved with its balances out by whatever was lost; now nothing is saved.
// The reading itself is replaced here by a hand-made file so a broken one can be fed in; the refusal happens before the database is touched.

const crafted = vi.hoisted(() => ({ parsed: null as unknown }));
vi.mock("@/lib/import-formats", async (orig) => ({ ...(await orig<typeof import("@/lib/import-formats")>()), parseImport: () => crafted.parsed }));

const { importSplitwise } = await import("@/lib/splitwise-import");

const SAFE_TEXT = "This file couldn’t be read safely, so nothing was brought over. Check the names and amounts in it and try again.";
const input = { text: "", groupName: "Imported", type: "trip", me: 0 };
const row = (nets: number[], cost: number) => ({ line: 2, date: "", description: "Dinner", category: "", cost, nets, payment: false });
const file = (rows: ReturnType<typeof row>[]) => ({ ok: true, people: ["Asha", "Ravi"], currency: "INR", rows, skipped: [], otherCurrencies: [], expected: null });

describe("a file whose lines don't add up is refused before anything is saved", () => {
  it("Asha paid 10000 but only 5000 of it was given to anyone (nets +5000 / 0, the other share was lost): refused", async () => {
    // Hand-worked: nets [5000, 0] sum to 5000, not 0. planRow gives payers 10000, shares only 5000: out by 5000.
    crafted.parsed = file([row([5000, 0], 10000)]);
    expect(await importSplitwise({ id: "acc-not-used" }, input)).toEqual({ ok: false, error: SAFE_TEXT });
  });

  it("one bad line among good ones refuses the whole file (nothing is half-saved)", async () => {
    // Line 1 is clean (+5000 / -5000, cost 10000: payers 10000, shares 5000 + 5000). Line 2 lost half (+3000 / 0, cost 6000: shares only 3000).
    crafted.parsed = file([row([5000, -5000], 10000), row([3000, 0], 6000)]);
    expect(await importSplitwise({ id: "acc-not-used" }, input)).toEqual({ ok: false, error: SAFE_TEXT });
  });

  it("the other checks that were there still speak first (a person to be 'you', a group name)", async () => {
    crafted.parsed = file([row([5000, -5000], 10000)]);
    expect(await importSplitwise({ id: "x" }, { ...input, me: 7 })).toEqual({ ok: false, error: "Pick which person is you." });
    expect(await importSplitwise({ id: "x" }, { ...input, groupName: "   " })).toEqual({ ok: false, error: "Give the group a name." });
  });
});
