import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Add expense is back to the layout of the 12 Nov release (commit 42e49884), with every later safety fix kept.
// Read as text, so no browser is needed.
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const form = src("src/components/AddExpenseForm.tsx");

describe("Add expense: the earlier layout is back", () => {
  it("the page puts the trip's photo across the top behind the title", () => {
    const page = src("src/app/groups/[id]/add/page.tsx");
    expect(page).toContain("<SheetPage");
    expect(page).toContain("`Add to ${group.name}`");
    expect(page).not.toContain("AddHeader");
  });
  it("order: currency pill, amount, day, Faster entry, What was it?, Who paid?, How to split?, More, Save", () => {
    const at = (s: string) => form.indexOf(s);
    const order = ["data-amount-hero", "Faster entry", "What was it?", 'kind === "refund" ? "Who got the money?" : "Who paid?"', "How to split?", "data-more", "data-expense-result", ": \"Save & add another\"}"].map(at);
    expect(order.every((n) => n > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(form).toContain('placeholder="e.g. Beach dinner"');
  });
  it("Who paid? and How to split? are chip rows again (no two-row sentence card)", () => {
    for (const s of ["data-payer-row", "data-split-row", "Everyone equally", "Only some", ">\n            Custom\n"]) expect(form).toContain(s);
    for (const s of ["data-sentence-card", "data-row-paid", "data-row-split", "data-split-panel", "closePanel"]) expect(form).not.toContain(s);
  });
  it("Faster entry is three labelled buttons", () => {
    for (const s of ['label={existingReceiptId ? "Bill photo" : "Scan a bill"}', 'label="Speak"', 'label="Type a line"']) expect(form).toContain(s);
    expect(form).toContain("line-clamp-2");
  });
});

describe("Add expense: the later fixes are kept", () => {
  it("Money back stays in More (no switch at the top), with its note and Undo", () => {
    expect(form).not.toContain('aria-label="Money spent or money back"');
    for (const s of ["data-money-back-row", 'aria-label="Money back"', "data-money-back-note", "A refund or a deposit coming back", '"Hide notes and more"', "`Notes, money back"]) expect(form).toContain(s);
  });
  it("the amount is a plain box that is exactly as wide as its text, and long amounts step down for 320px phones", () => {
    expect(form).toContain("invisible col-start-1 row-start-1");
    expect(form).not.toMatch(/size=\{Math\.max\(2/);
    expect(form).not.toContain("groupDigits");
    for (const s of ["clamp(52px,17vw,72px)", "clamp(40px,13vw,56px)", "clamp(30px,9.5vw,42px)"]) expect(form).toContain(s);
  });
  it("the result line, the read-back, the foreign currency card and the 44px tap targets are still there", () => {
    for (const s of ["The result shows once it adds up", "data-expense-result", "data-amount-echo", "data-fx-card", "data-fx-maths", "min-h-11", "data-multi-pay-row"]) expect(form).toContain(s);
    // Bad payer or share amounts and a bad card fee still open what they are about.
    expect(form).toContain("/person|amounts|percent|shares/i");
    expect(form).toContain("/card markup/i");
    expect(form).toContain("errorNeedsMore(preview.error, multiPay)");
  });
  it("one main button: Save expense is the filled one, Save & add another is a quiet link", () => {
    expect(form).toContain("className={primaryButtonClass}");
    expect(form).toContain("underline underline-offset-4 active:text-fg disabled:opacity-50");
  });
});
