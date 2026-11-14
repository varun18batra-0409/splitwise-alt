import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Source checks for the 320 px fixes (the real layout check is e2e/tests/45-big-amounts-small-phone.spec.ts).
const src = (f: string) => readFileSync(f, "utf8");

describe("big amounts on small phones", () => {
  it("the activity row's 'paid … · edited' may use two lines and can shrink, and the names give way first", () => {
    const row = src("src/components/ActivityRow.tsx");
    // R1 item 1: the payer's name is never cut; it wraps. The group and date line is the one that may be cut.
    expect(row).toMatch(/<p className="mt-0\.5 break-words[^"]*" data-paid-line>/);
    expect(row).not.toContain("shrink-[4] truncate");
    expect(row).toContain("data-where-line");
  });
  it("the two-sided ticket sizes its amount by length instead of a fixed 24px", () => {
    const home = src("src/components/HomeMoney.tsx");
    expect(home).toContain("bothAmountSize(line.amount)");
    expect(home).not.toMatch(/mt-0\.5 block[^`]*font-display text-\[24px\]/);
    expect(home).toContain("whitespace-nowrap font-display");
  });

  it("both amount boxes hold the plain typed amount: no grouping swap, no select-on-focus", () => {
    for (const f of ["src/components/AddExpenseForm.tsx", "src/components/RecordPaymentForm.tsx"]) {
      const form = src(f);
      expect(form, f).not.toContain("groupDigits");
      expect(form, f).not.toMatch(/amountFocused|setFocused|selectWholeAmount|select-amount/);
      expect(form, f).toContain("value={amount}");
      expect(form, f).toContain('inputMode="decimal"');
    }
  });
});
