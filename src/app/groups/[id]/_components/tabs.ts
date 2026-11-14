// Which tabs a group page has, and which one a link opens. Pure, so the page and the tests read the same rules.
//
// Trips (and flats and couples, "Overview" being This month there): Overview / Expenses / People, and Memories.
// Card nights keep Games / Balances / Activity. Memories shows for every trip, and for any other group only once you have a postcard in it.
// Addresses stay as they were so every saved link, push and test keeps working: ?tab=activity is Expenses, ?tab=balances is People,
// ?tab=month is a flat's Overview. New ones: overview, memories. ?tab=charts (and recap) open "Trip recap", which is not in the tab bar.

export type TabId = "overview" | "month" | "activity" | "balances" | "memories" | "recap" | "bills" | "list" | "games";
export type GroupTab = { id: TabId; label: string };

export type TabFacts = {
  type: string;
  leaver: { removed: boolean } | null; // someone who left (or was removed) from this group
  hasPostcards: boolean; // you sent or received a postcard from this group
};

const OVERVIEW: GroupTab = { id: "overview", label: "Overview" };
const MONTH: GroupTab = { id: "month", label: "Overview" };
const EXPENSES: GroupTab = { id: "activity", label: "Expenses" };
const PEOPLE: GroupTab = { id: "balances", label: "People" };
const MEMORIES: GroupTab = { id: "memories", label: "Memories" };

export function showMemories(f: TabFacts): boolean {
  if (f.leaver?.removed) return false; // someone taken out sees no memories
  return f.type === "trip" || f.hasPostcards;
}

export function groupTabs(f: TabFacts): GroupTab[] {
  const home = !f.leaver && (f.type === "home" || f.type === "couple");
  const pot = !f.leaver && f.type === "pot";
  const base: GroupTab[] = home
    ? [MONTH, EXPENSES, PEOPLE]
    : pot
      ? [{ id: "games", label: "Games" }, { id: "balances", label: "Balances" }, { id: "activity", label: "Activity" }]
      : [OVERVIEW, EXPENSES, PEOPLE];
  return showMemories(f) ? [...base, MEMORIES] : base;
}

// Every address the page accepts, mapped to the tab it opens. A tab the group doesn't have, or an unknown one, opens its own first tab.
// Pages behind a tab of their own: Trip recap (from the Overview's footer), and a flat's Bills and List (from the Overview tiles).
const ALIASES: Record<string, TabId> = {
  overview: "overview",
  month: "month",
  activity: "activity",
  expenses: "activity",
  balances: "balances",
  people: "balances",
  memories: "memories",
  charts: "recap",
  recap: "recap",
  bills: "bills",
  list: "list",
  games: "games",
};

export function resolveTab(raw: string | undefined, tabs: GroupTab[], f: Pick<TabFacts, "type" | "leaver">): TabId {
  const home = !f.leaver && (f.type === "home" || f.type === "couple");
  const first = tabs[0].id;
  const want = ALIASES[(raw ?? "").toLowerCase()];
  if (!want) return first;
  // "overview" on a flat is its This month, and "month" on a trip is its Overview.
  if (want === "overview" && home) return "month";
  if (want === "month" && !home) return first === "games" ? "games" : "overview";
  if (tabs.some((t) => t.id === want)) return want;
  // Trip recap works on every group; Bills and List only on flats and couples.
  if (want === "recap") return "recap";
  if ((want === "bills" || want === "list") && home) return want;
  return first;
}

// The tab that is lit in the bar while a page behind it is open (Trip recap, a flat's Bills and List belong to the Overview).
export function litTab(tab: TabId, tabs: GroupTab[]): TabId {
  if (tabs.some((t) => t.id === tab)) return tab;
  return tabs[0].id;
}
