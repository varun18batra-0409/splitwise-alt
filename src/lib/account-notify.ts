// What a person wants Loopin to send them, across all their groups: "Notifications & email".
// Stored on the account as JSON in Account.notifyPrefs. "" means everything is on, as before.
// Only what is switched OFF is written down, so new items are on for everyone by default:
//   {"push":{"payments":false,"expenses.added":false},"email":{"groups.added":false}}
// A key is a category ("payments") or an item ("payments.claimed"). Category off beats item on.
// A group's own settings (Member.notify) still apply on top: see `bothAllow`.
// Sign-in codes and security emails never ask any of this.

export type Channel = "push" | "email";

export type Item = { id: string; label: string };
export type Category = { id: string; label: string; hint: string; push: Item[]; email: Item[] };

export const CATEGORIES: Category[] = [
  {
    id: "expenses",
    label: "Expenses",
    hint: "What happens to the bills in your groups.",
    push: [
      { id: "expenses.added", label: "Someone adds an expense" },
      { id: "expenses.changed", label: "An expense is changed or deleted" },
      { id: "expenses.reactions", label: "Someone reacts to your expense" },
    ],
    email: [],
  },
  {
    id: "payments",
    label: "Payments",
    hint: "Money moving between you and your friends.",
    push: [
      { id: "payments.claimed", label: "Someone says they paid you" },
      { id: "payments.answered", label: "A payment you made is confirmed or questioned" },
      { id: "payments.recorded", label: "Someone records a payment" },
      { id: "payments.collect", label: "Collections: added, reminders and payments" },
    ],
    email: [],
  },
  {
    id: "groups",
    label: "Groups and people",
    hint: "Who is in your groups, and how they change.",
    push: [
      { id: "groups.added", label: "Someone adds you to a group" },
      { id: "groups.people", label: "Someone joins, leaves or is removed" },
      { id: "groups.changes", label: "A group is closed, deleted or its currency changes" },
      { id: "groups.games", label: "Game night starts or finishes" },
      { id: "groups.shopping", label: "Someone is going shopping" },
    ],
    email: [{ id: "groups.added", label: "Someone adds me to a group" }],
  },
  {
    id: "reminders",
    label: "Reminders",
    hint: "Gentle nudges when something is due.",
    push: [
      { id: "reminders.bills", label: "Bills due" },
      { id: "reminders.settle", label: "Settle-up reminders" },
      { id: "reminders.budgets", label: "Budget alerts" },
      { id: "reminders.trips", label: "Trip countdowns" },
    ],
    email: [],
  },
  {
    id: "memories",
    label: "Memories",
    hint: "The nice looking-back moments.",
    push: [
      { id: "memories.lane", label: "Memories and stories" },
      { id: "memories.recaps", label: "Trip day recaps" },
      { id: "memories.postcards", label: "Postcards" },
      { id: "memories.passport", label: "Passport moments" },
    ],
    email: [],
  },
  {
    id: "summaries",
    label: "Summaries",
    hint: "A look back at the month.",
    push: [{ id: "summaries.monthly", label: "Monthly group summary" }],
    email: [],
  },
];

export type ItemId = string;

const itemsOf = (channel: Channel) => CATEGORIES.flatMap((c) => c[channel].map((i) => i.id));
const ITEM_IDS: Record<Channel, Set<string>> = { push: new Set(itemsOf("push")), email: new Set(itemsOf("email")) };
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

// Is this a real switch (a category, or an item that exists on that channel)?
export function isKnownKey(channel: Channel, key: string): boolean {
  if (channel !== "push" && channel !== "email") return false;
  return ITEM_IDS[channel].has(key) || (CATEGORY_IDS.has(key) && CATEGORIES.find((c) => c.id === key)![channel].length > 0);
}

type Parsed = Record<Channel, Record<string, false>>;

export function parseAccountPrefs(json?: string | null): Parsed {
  const out: Parsed = { push: {}, email: {} };
  if (!json) return out;
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== "object") return out;
    for (const ch of ["push", "email"] as const) {
      const part = v[ch];
      if (!part || typeof part !== "object") continue;
      for (const [k, val] of Object.entries(part)) if (val === false && isKnownKey(ch, k)) out[ch][k] = false;
    }
  } catch {
    // broken data means the default: everything on
  }
  return out;
}

// Is this item allowed for this person? A category that is off blocks all its items.
export function allows(json: string | null | undefined, channel: Channel, item: ItemId): boolean {
  const p = parseAccountPrefs(json)[channel];
  const cat = item.split(".")[0];
  return p[cat] !== false && p[item] !== false;
}

// The same, for the two settings that must both agree: the person's account and the group's own
// settings (Member.notify, already worked out by the caller as `groupAllows`).
export function bothAllow(accountJson: string | null | undefined, channel: Channel, item: ItemId, groupAllows: boolean): boolean {
  return groupAllows && allows(accountJson, channel, item);
}

// Returns the new JSON with one switch changed. "on" removes the entry (default); "" when nothing is off.
export function setPref(json: string | null | undefined, channel: Channel, key: string, on: boolean): string {
  const p = parseAccountPrefs(json);
  if (on) delete p[channel][key];
  else p[channel][key] = false;
  const out: Partial<Parsed> = {};
  for (const ch of ["push", "email"] as const) if (Object.keys(p[ch]).length) out[ch] = p[ch];
  return Object.keys(out).length ? JSON.stringify(out) : "";
}

// Which switch a group event belongs to.
export function eventItem(kind: string): ItemId {
  if (kind === "expense_added") return "expenses.added";
  if (kind.startsWith("expense_") || kind.startsWith("bill_") || kind === "split_changed") return "expenses.changed";
  if (kind === "payment_confirmed") return "payments.answered";
  if (kind === "payment_claimed") return "payments.claimed";
  if (kind.startsWith("payment_")) return "payments.recorded";
  if (kind.startsWith("member")) return "groups.people";
  if (kind.startsWith("pot_")) return "groups.games";
  return "groups.changes";
}

// Which switch a personal note (Alerts) belongs to, for its phone message.
export function noteItem(kind: string): ItemId {
  if (kind.startsWith("collect_")) return "payments.collect";
  if (kind === "group_invite") return "groups.added";
  if (kind === "postcard") return "memories.postcards";
  if (kind === "passport" || kind.startsWith("passport_")) return "memories.passport";
  return "groups.changes";
}
