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

  // CHANGED on 16 Nov by the founder (Option A): the amount boxes now show grouped digits AS YOU TYPE (1,23,456.50), reversing the
  // earlier "plain digits only" rule. The safety the old rule gave now comes from AmountInput (caret kept by counting digits;
  // tests/amount-input.test.ts) and from the text sent to the server parsing to the same amount. There is still no select-on-focus
  // and no swap of the text on focus or blur.
  it("the amount boxes use the grouped-as-you-type box, with no select-on-focus and no swap on focus or blur", () => {
    for (const f of ["src/components/AddExpenseForm.tsx", "src/components/RecordPaymentForm.tsx", "src/components/BillForm.tsx"]) {
      const form = src(f);
      expect(form, f).toContain("<AmountInput");
      expect(form, f).toContain("value={amount}");
      expect(form, f).not.toMatch(/amountFocused|setFocused|selectWholeAmount|select-amount/);
    }
    const box = src("src/components/AmountInput.tsx");
    expect(box).toContain('inputMode="decimal"');
    expect(box).toContain("editAmountInput(");
    expect(box).not.toMatch(/onFocus|onBlur|\.select\(\)/);
    for (const f of ["src/app/groups/[id]/budgets/page.tsx", "src/app/groups/[id]/deposit/page.tsx"]) expect(src(f), f).toContain("<AmountInput");
  });
  it("the big payment amount and the Add expense amount shrink by length so a huge number stays on one line", () => {
    expect(src("src/components/RecordPaymentForm.tsx")).toContain('amountSizeClass(amount, "pay")');
    expect(src("src/components/AddExpenseForm.tsx")).toContain('amountSizeClass(amount, "hero")');
  });
});
