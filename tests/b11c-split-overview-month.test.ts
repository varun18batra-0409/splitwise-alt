import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { monthCardMode, monthNumbers } from "../src/lib/home/banner";

// 16 Nov, founder-approved mockups: one split row, "Add expense" on every group overview, the quieter month card.
const src = (p: string) => readFileSync(p, "utf8");

describe("one split row", () => {
  const form = src("src/components/AddExpenseForm.tsx");
  it("the row is Everyone equally, Only some, Amounts, %, Shares, Items; it wraps and never scrolls sideways", () => {
    const row = form.slice(form.indexOf("data-split-row") - 80, form.indexOf("data-split-row") + 400);
    expect(row).toContain("flex-wrap");
    expect(row).not.toContain("overflow-x-auto");
    for (const s of ["Everyone equally", "Only some", "Amounts", "Shares", "Items"]) expect(form).toContain(s);
  });
  it("no second 'Who was it for?' or 'Selected / One person' control", () => {
    expect(form).not.toContain("Who was it for?");
    expect(form).not.toContain('label: "One person"');
    expect(form).not.toContain('label: "Selected"');
  });
  it("the date stays one 'Today' pill that opens Today / Yesterday / Pick date; scanning a bill no longer opens it", () => {
    expect(form).toContain("Pick date");
    expect(form).not.toMatch(/if \(b\.date !== today\) setShowDate\(true\)/);
  });
});

describe("Add expense on every group overview", () => {
  const ov = src("src/app/groups/[id]/_components/OverviewTab.tsx");
  it("shown whatever the balance; hidden only when closed or left", () => {
    expect(ov).toContain("const canAdd = !group.closed && !v.leaver;");
  });
});

describe("moment caption placeholder", () => {
  it("starts with e.g. and is dimmer", () => {
    const f = src("src/app/groups/[id]/moments/new/MomentForm.tsx");
    expect(f).toContain('placeholder="e.g. The boat we almost missed"');
    expect(f).toContain("placeholder:text-fg/35");
  });
});

describe("home month card", () => {
  const m = (share: number, count: number) => ({ month: "2026-11", name: "November", wrapped: false, share, currency: "INR", converted: false, count, top: null });
  it("no share: no card; one expense with a share: one slim line; otherwise the full card", () => {
    expect(monthCardMode(null)).toBe("none");
    expect(monthCardMode(m(0, 1))).toBe("none");
    expect(monthCardMode(m(0, 5))).toBe("none");
    expect(monthCardMode(m(214616, 1))).toBe("slim");
    expect(monthCardMode(m(214616, 3))).toBe("full");
  });
  it("monthNumbers itself is unchanged: one expense you didn't share in still counts 1 with share 0", () => {
    const now = new Date("2026-11-16T06:00:00Z");
    const e = { amount: 100, category: "food", spentAt: now, createdAt: now, shares: [{ memberId: "other", amount: 100 }] };
    const r = monthNumbers([{ currency: "INR", myId: "me", expenses: [e] }], (a) => a, "INR", now, "Asia/Kolkata");
    expect(r?.count).toBe(1);
    expect(monthCardMode(r)).toBe("none");
  });
  it("the page shows 'November · 1 expense · your share' and See November", () => {
    const p = src("src/app/(home)/page.tsx");
    expect(p).toContain("· 1 expense · your share");
    expect(p).toContain("data-month-slim");
  });
});
