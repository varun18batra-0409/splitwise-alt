import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { groupTabs, litTab, resolveTab, showMemories, type TabFacts } from "@/app/groups/[id]/_components/tabs";

// R4: which tabs a group has, and which one an address opens. Old addresses keep working (?tab=activity, ?tab=balances, ?tab=charts, #item-…).
const facts = (o: Partial<TabFacts> = {}): TabFacts => ({ type: "trip", leaver: null, hasPostcards: false, ...o });
const ids = (f: TabFacts) => groupTabs(f).map((t) => t.id);
const labels = (f: TabFacts) => groupTabs(f).map((t) => t.label);

describe("the tabs of each kind of group", () => {
  it("a trip: Overview, Expenses, People, Memories", () => {
    expect(labels(facts())).toEqual(["Overview", "Expenses", "People", "Memories"]);
    expect(ids(facts())).toEqual(["overview", "activity", "balances", "memories"]);
  });
  it("a flat or a couple: This month is its Overview, then Expenses and People (Bills and List open from the Overview tiles); Memories only with a postcard", () => {
    for (const type of ["home", "couple"]) {
      expect(labels(facts({ type }))).toEqual(["Overview", "Expenses", "People"]);
      expect(ids(facts({ type }))).toEqual(["month", "activity", "balances"]);
      expect(ids(facts({ type, hasPostcards: true }))).toEqual(["month", "activity", "balances", "memories"]);
    }
  });
  it("a card night keeps Games / Balances / Activity", () => {
    expect(labels(facts({ type: "pot" }))).toEqual(["Games", "Balances", "Activity"]);
    expect(ids(facts({ type: "pot", hasPostcards: true }))).toEqual(["games", "balances", "activity", "memories"]);
  });
  it("any other group: Overview, Expenses, People; Memories hidden until you have a postcard in it", () => {
    expect(labels(facts({ type: "other" }))).toEqual(["Overview", "Expenses", "People"]);
    expect(ids(facts({ type: "other", hasPostcards: true }))).toContain("memories");
  });
  it("someone who left sees Overview, Expenses, People and Memories (read-only); someone removed sees no Memories", () => {
    expect(ids(facts({ leaver: { removed: false } }))).toEqual(["overview", "activity", "balances", "memories"]);
    expect(ids(facts({ leaver: { removed: true } }))).toEqual(["overview", "activity", "balances"]);
    expect(ids(facts({ type: "home", leaver: { removed: false } }))).toEqual(["overview", "activity", "balances"]); // a leaver of a flat sees the plain tabs
    expect(showMemories(facts({ leaver: { removed: true }, hasPostcards: true }))).toBe(false);
  });
});

describe("addresses", () => {
  const trip = facts();
  const tripTabs = groupTabs(trip);
  const r = (raw: string | undefined, f: TabFacts = trip) => resolveTab(raw, groupTabs(f), f);
  it("old addresses: activity is Expenses, balances is People, charts is Trip recap", () => {
    expect(r("activity")).toBe("activity");
    expect(r("balances")).toBe("balances");
    expect(r("charts")).toBe("recap");
    expect(r("recap")).toBe("recap");
  });
  it("new names work too: expenses, people, overview, memories", () => {
    expect([r("expenses"), r("people"), r("overview"), r("memories")]).toEqual(["activity", "balances", "overview", "memories"]);
    expect(r("MEMORIES")).toBe("memories");
  });
  it("nothing or something unknown opens the group's own first tab: a trip's Overview, a flat's This month, a card night's Games", () => {
    expect([r(undefined), r(""), r("nonsense")]).toEqual(["overview", "overview", "overview"]);
    expect(r(undefined, facts({ type: "home" }))).toBe("month");
    expect(r("nonsense", facts({ type: "pot" }))).toBe("games");
  });
  it("overview on a flat is This month; month on a trip is its Overview", () => {
    expect(r("overview", facts({ type: "home" }))).toBe("month");
    expect(r("month")).toBe("overview");
    expect(r("month", facts({ type: "pot" }))).toBe("games");
  });
  it("Bills and List only on a flat or a couple; elsewhere they open the first tab", () => {
    expect(r("bills", facts({ type: "home" }))).toBe("bills");
    expect(r("list", facts({ type: "couple" }))).toBe("list");
    expect(r("bills")).toBe("overview");
    expect(r("bills", facts({ leaver: { removed: false }, type: "home" }))).toBe("overview");
  });
  it("Memories where there is none opens the first tab (a flat with no postcard, someone removed)", () => {
    expect(r("memories", facts({ type: "home" }))).toBe("month");
    expect(r("memories", facts({ leaver: { removed: true } }))).toBe("overview");
  });
  it("Trip recap works on every group; the tab bar lights Overview while it is open", () => {
    expect(r("charts", facts({ type: "home" }))).toBe("recap");
    expect(r("charts", facts({ type: "pot" }))).toBe("recap");
    expect(litTab("recap", tripTabs)).toBe("overview");
    expect(litTab("memories", tripTabs)).toBe("memories");
    expect(litTab("bills", groupTabs(facts({ type: "home" })))).toBe("month");
  });
});

describe("the page wires it", () => {
  const page = readFileSync("src/app/groups/[id]/page.tsx", "utf8");
  it("uses groupTabs and resolveTab, loads the history only for Expenses, and shows the ticket only where planned", () => {
    expect(page).toContain("groupTabs(");
    expect(page).toContain("resolveTab(");
    expect(page).toContain('raw !== "activity" && raw !== "expenses"');
    expect(page).toContain('{tab === "overview" && <OverviewTab');
    expect(page).toContain("{pot && <MoneyTicket");
  });
  it("notices and the closed banner show on every tab", () => {
    expect(page).toContain("<GroupNotices sp={sp} />");
    expect(page).toContain("<ClosedBanner v={v} />");
  });
  it("the old links are still made by the app: Expenses, People and Trip recap addresses", () => {
    expect(readFileSync("src/lib/paths.ts", "utf8")).toContain("?tab=activity");
    expect(readFileSync("src/app/groups/[id]/_components/OverviewTab.tsx", "utf8")).toContain("?tab=charts");
    expect(readFileSync("src/app/groups/[id]/_components/GroupSummary.tsx", "utf8")).toContain("?tab=balances&why=${myId}#why-${myId}");
  });
});
