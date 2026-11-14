import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Batch 5b of the look-and-feel work: Your groups, the flat overview, recurring bills, collect (organiser). Read as text, so no browser is needed.
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("Your groups", () => {
  const page = src("src/app/groups/page.tsx");
  const lines = src("src/components/GroupLines.tsx");
  it("keeps the bell, the list hook, the closed and deleted groups and every link", () => {
    for (const s of ['title="Your groups" back="/" bell', "data-all-groups", "Closed groups (", "data-recently-deleted", "restoreGroup", 'href="/groups/new"', "<GroupRow"]) expect(page).toContain(s);
  });
  it("the search box only appears with more than six groups, and filters by the name on each row", () => {
    expect(page).toContain("live.length > 6 && <GroupSearch />");
    expect(lines).toContain("data-name={g.group.name.toLowerCase()}");
    const search = src("src/components/GroupSearch.tsx");
    expect(search).toContain("Find a group");
    expect(search).toContain("[data-all-groups] > li[data-name]");
  });
  it("each row is photo, name, one quiet line and a chevron, with the amount alone in colour", () => {
    expect(lines).toContain("h-16 w-16");
    expect(lines).toContain("rounded-[12px]");
    expect(lines).toContain("font-display text-[17px]");
    expect(lines).toContain("You’re owed");
    expect(lines).toContain("You owe");
    expect(lines).toContain("Bills & shopping");
    expect(lines).toContain("All settled");
    expect(lines).toContain("text-owed");
    expect(lines).toContain("text-owe");
    expect(lines).toContain("data-group-line");
    expect(lines).toContain("data-exact={exact}");
    // Exact amounts (paise included), never the rounded Home figure.
    expect(lines).toContain("formatMoney(b, g.group.currency)");
    expect(lines).not.toContain("overviewMoney");
    expect(lines).toContain("<ChevronRight");
  });
  it("starts a group from a quiet row and lists collections in the same row style", () => {
    expect(page).toContain("Start a group");
    expect(page).toContain('aria-label="Collections"');
    expect(page).toContain("to check");
    expect(page).toContain("href={`/c/${c.code}`}");
  });
});

describe("group header", () => {
  const head = src("src/app/groups/[id]/_components/GroupHeader.tsx");
  it("has no emoji of its own and keeps the countdown, weather and Trip recap hooks", () => {
    expect(head).not.toMatch(/[\u{1F300}-\u{1FAFF}☀-➿]/u);
    for (const s of ["data-countdown-line", "data-trip-weather", "data-group-recap", "Trip recap"]) expect(head).toContain(s);
    expect(head).toContain("Extended_Pictographic");
  });
});

describe("the flat overview", () => {
  const month = src("src/app/groups/[id]/_components/ThisMonthTab.tsx");
  it("has four equal tiles (two by two on the smallest phones) linking to what exists", () => {
    expect(month).toContain("data-flat-tiles");
    expect(month).toContain("grid-cols-2");
    expect(month).toContain("min-[340px]:grid-cols-4");
    for (const s of ['label: "Bills"', 'label: "Shopping"', 'label: "Budget"', 'label: "Deposit"', "?tab=bills", "?tab=list", "/budgets", "/deposit"]) expect(month).toContain(s);
    expect(month).toContain('group.type === "home" ? [{ label: "Deposit"');
  });
  it("shows the next bill with View bill, and still offers Enter amount", () => {
    for (const s of ["data-next-bill", "Next bill", "View bill", "Enter amount", "/bills/${next.id}", "extras.upcoming?.[0]", "extras.upcoming?.slice(1)"]) expect(month).toContain(s);
  });
  it("shows the shopping list card with Add item and plain checkbox rows", () => {
    for (const s of ["data-shopping-card", "Shopping list", "Add item", "shopping?:"]) expect(month).toContain(s);
    const page = src("src/app/groups/[id]/page.tsx");
    expect(page).toContain("shopping: { items: shopRows.slice(0, 3), total: shopRows.length }");
    expect(page).toContain('expenseId: "", boughtAt: null');
  });
  it("does not invent a monthly check-in (nothing like it exists to link to)", () => {
    expect(month).not.toContain("Monthly check-in");
  });
});

describe("recurring bills", () => {
  const bills = src("src/app/groups/[id]/_components/BillsTab.tsx");
  it("keeps its hooks and labels, and no status chip has a coloured fill", () => {
    for (const s of ["data-bill-state", "Add a bill", "Enter amount", "Add it", "Fix it", "/bills/new", "billBadge"]) expect(bills).toContain(s);
    expect(bills).not.toContain("bg-owe/");
    expect(bills).not.toContain("bg-owed/");
    expect(bills).not.toContain("✓");
  });
  it("shows Monthly or Daily, a neutral status, the daily calendar link and one cream button", () => {
    for (const s of ['"Daily"', '"Monthly"', "Review days", "Due ${shortDate(b.due)}", "View daily calendar", "#calendar", "primaryButtonClass"]) expect(bills).toContain(s);
    expect(src("src/lib/home/bills.ts")).toContain('label: "Added this month"');
  });
});

describe("collect, organiser view", () => {
  const page = src("src/app/c/[code]/page.tsx");
  it("shows three numbers, the goal, the three-part bar and the counts line", () => {
    for (const s of ["confirmed</p>", "reported</p>", "remaining</p>", "Goal: {money(p.target)}", "data-bar-confirmed", "data-bar-reported", "data-collection-progress"]) expect(page).toContain(s);
    // Only the money that has arrived may be green.
    expect(page).toContain("p.confirmedAmount > 0 ? \"text-owed\"");
  });
  it("remaining is the goal less what is confirmed and reported (hand-worked: 1,800 - 600 - 300 = 900)", () => {
    expect(page).toContain("Math.max(0, p.target - p.confirmedAmount - p.reportedAmount)");
    expect(1800 - 600 - 300).toBe(900);
  });
  it("rows say Says paid or Confirmed, with an outline Confirm received, and Share collection link is the one cream button", () => {
    for (const s of ['"Says paid"', '"Confirmed"', "Confirm received", "Share collection link", "primaryButtonClass", "Paid cash", "Uncheck", 'aria-label="Still to pay"', 'aria-label="Paid"']) expect(page).toContain(s);
    expect(page).not.toContain('"Got it"');
    expect(page).toContain("border border-fg/25");
  });
  it("the payer's page keeps its own words", () => {
    for (const s of ["is collecting", "say they've paid", "Reported, awaiting check", "I’ve paid", "checked by"]) expect(page + src("src/lib/collect-rules.ts") + src("src/components/CollectBits.tsx")).toContain(s);
  });
});
