import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Batch 4 of the look-and-feel work: the pages people see before they join. Read as text, so no browser is needed.
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("amount boxes are exactly as wide as their digits", () => {
  for (const f of ["src/components/RecordPaymentForm.tsx", "src/components/AddExpenseForm.tsx"]) {
    it(`${f} sizes the amount with a hidden copy of the text, not size=`, () => {
      const s = src(f);
      expect(s).toContain("inline-grid");
      expect(s).toContain("invisible col-start-1 row-start-1");
      expect(s).not.toMatch(/size=\{Math\.max\(2/);
      expect(s).toContain("clamp(34px,10vw,40px)");
    });
  }
});

describe("start screen", () => {
  const home = src("src/app/(home)/page.tsx");
  it("says the promise, keeps the ways in and the quieter rows", () => {
    expect(home).toContain("Good times.");
    expect(home).toContain("Shared fairly.");
    expect(home).toContain("Split expenses, settle up and keep the memories.");
    for (const s of ['href="/groups/new"', "<JoinByLink />", 'href="/signin"', "Already here?", "Coming from another app?", "How Loopin works", "Quick start"]) expect(home).toContain(s);
    expect(home).not.toContain("Start with one group");
  });
  it("the hero is decorative and the receipt adds up (3,240 + 4,800 = 8,040)", () => {
    const hero = src("src/components/StartHero.tsx");
    expect(hero).toContain("aria-hidden");
    expect(3240 + 4800).toBe(8040);
    for (const s of ["₹3,240", "₹4,800", "₹8,040", "Group expense"]) expect(hero).toContain(s);
  });
  it("the invite-link button has its new name", () => expect(src("src/components/JoinByLink.tsx")).toContain("Join with a link"));
});

describe("invite page", () => {
  const join = src("src/app/join/[code]/page.tsx");
  it("keeps its actions, hooks and hidden fields", () => {
    for (const s of ["joinAsExisting", "joinAsNew", 'name="code"', 'name="memberId"', "data-join-card", "data-join-footnote", "data-join-gone", "data-join-removed", "/api/auth/google/start", "<GoogleG />"]) expect(join).toContain(s);
  });
  it("uses Continue with Google, and only names the inviter when the invite recorded one", () => {
    expect(join).toContain("Continue with Google");
    expect(join).not.toContain("Join with Google");
    expect(join).toContain("Invited by {invitedFirst}");
    expect(join).toContain("No amounts are shown before you join.");
    expect(join).toContain("No names or amounts are shown before you join.");
  });
});

describe("pay link and collect link", () => {
  const pay = src("src/app/p/[token]/page.tsx");
  const collect = src("src/app/c/[code]/page.tsx");
  it("the pay link's I've paid button keeps its hooks and is no longer green", () => {
    expect(pay).toContain("data-i-paid");
    expect(pay).toContain("data-paylink-amount");
    expect(pay).not.toContain("bg-owed");
    expect(pay).toContain("text-owe");
  });
  it("the collect link has no stamp and no tick in its words, and only one cream button", () => {
    expect(collect).not.toContain("stampCounts");
    expect(src("src/components/CollectBits.tsx")).not.toContain("I’ve paid ✓");
    expect(src("src/components/CollectBits.tsx")).toContain('label="I’ve paid" outline={outline}');
    expect(collect).toContain("outline={Boolean(upi || c.payLink)}");
    expect(collect).toContain("data-bar-confirmed");
    expect(collect).toContain("data-bar-reported");
  });
});
