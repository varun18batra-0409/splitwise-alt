import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Part 1a of the look-and-feel batch: shared pieces are plain and neutral. Read as text, so no browser is needed.
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("one calm page", () => {
  it("a group's layout no longer paints a per-group tint", () => {
    const s = src("src/app/groups/[id]/layout.tsx");
    expect(s).not.toMatch(/groupTint|tintStyle|data-tint/);
  });
  it("nothing reads --color-tint any more", () => {
    expect(src("src/components/AddExpenseForm.tsx")).not.toContain("--color-tint");
    expect(src("src/app/groups/[id]/page.tsx")).not.toContain("--color-tint");
  });
  it("the soft money boxes are plain cards", () => {
    const css = src("src/app/globals.css");
    expect(css).toMatch(/--color-owe-soft: #16161a/);
    expect(css).toMatch(/--color-owed-soft: #16161a/);
    expect(css).toMatch(/--color-accent-soft: #1f1f24/);
  });
});

describe("neutral icon tiles", () => {
  it("every category tile is #1f1f24 with off-white at 75%", () => {
    const s = src("src/components/ExpenseGlyph.tsx");
    expect(s).toContain('background: "#1f1f24"');
    expect(s).not.toContain("CATEGORY_TINT");
  });
});

describe("currencies by code", () => {
  it("pickers show the code, not a flag emoji", () => {
    expect(src("src/components/CurrencySelect.tsx")).not.toContain(".flag");
    expect(src("src/components/CurrencyPicker.tsx")).not.toContain(".flag");
    expect(src("src/components/SettingsControls.tsx")).not.toContain(".flag");
    expect(src("src/components/AddExpenseForm.tsx")).not.toContain("cur.flag");
  });
});

describe("the tab bar stays off form screens", () => {
  const nav = src("src/components/BottomNav.tsx");
  const hide = /const HIDE = \[(.*)\];/.exec(nav)![1];
  const res = hide.split(/,\s*(?=\/)/).map((r) => new RegExp(r.trim().slice(1, r.trim().lastIndexOf("/")).replace(/\\\//g, "/")));
  it.each([
    "/groups/g1/add",
    "/groups/g1/expenses/e1/edit",
    "/groups/g1/pay",
    "/groups/g1/settings",
    "/groups/g1/bills/new",
    "/groups/g1/people/m1/move",
    "/groups/new",
  ])("%s hides it", (path) => {
    expect(res.some((re) => re.test(path))).toBe(true);
  });
  it("group pages keep it", () => {
    expect(res.some((re) => re.test("/groups/g1"))).toBe(false);
    expect(res.some((re) => re.test("/groups/g1/settle"))).toBe(false);
  });
});

describe("one name for the settle action", () => {
  it("never says They’ve paid me", () => {
    expect(src("src/lib/settle-row.ts")).not.toContain('"They’ve paid me"');
    expect(src("src/lib/cross-settle.ts")).not.toContain('"They’ve paid me"');
  });
});
