import type { Transfer } from "./settle";

// Smart Settle across groups.
//
// Each group already has its own Smart Settle payments. When the same person is
// in several of your groups, the payments between you and them are netted into
// ONE payment. Example: Goa trip says you pay Asha ₹1,000; Flat says Asha pays
// you ₹400 → across groups, you pay Asha ₹600.
//
// The same person is recognised by their Loopin account (signed in with a
// verified email) — two different people who happen to share a name are never
// merged. Someone added by name only (not on Loopin yet) is matched by phone
// number (last 10 digits), else by name (ignoring capitals and extra spaces).
// Recording it as paid records the underlying payment in each group, so every
// group's own balances stay right.

export type GroupForSettle = {
  groupId: string;
  groupName: string;
  currency: string;
  myId: string;
  members: { id: string; name: string; phone: string; accountId?: string | null }[];
  transfers: Transfer[];
};

export type CrossPart = {
  groupId: string;
  groupName: string;
  currency: string;
  fromId: string;
  toId: string;
  amount: number; // in the group's currency
  iPay: boolean;
};

export type CrossItem = {
  key: string;
  name: string;
  net: number; // in the common currency: + they pay you, − you pay them
  parts: CrossPart[];
  converted: boolean; // some parts were converted from another currency
};

export function personKey(m: { name: string; phone: string; accountId?: string | null }): string {
  if (m.accountId) return `acc:${m.accountId}`;
  const digits = m.phone.replace(/\D/g, "");
  if (digits.length >= 8) return `tel:${digits.slice(-10)}`;
  return `name:${m.name.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

export function crossSettle(
  groups: GroupForSettle[],
  commonCurrency: string,
  toCommon: (amount: number, currency: string) => number | null,
): { items: CrossItem[]; skippedGroups: string[] } {
  const byPerson = new Map<string, CrossItem>();
  const skippedGroups: string[] = [];

  for (const g of groups) {
    const member = (id: string) => g.members.find((m) => m.id === id);
    for (const t of g.transfers) {
      if (t.from !== g.myId && t.to !== g.myId) continue; // only payments involving you
      const otherId = t.from === g.myId ? t.to : t.from;
      const other = member(otherId);
      if (!other) continue;
      const amountCommon = g.currency === commonCurrency ? t.amount : toCommon(t.amount, g.currency);
      if (amountCommon === null) {
        if (!skippedGroups.includes(g.groupName)) skippedGroups.push(g.groupName);
        continue;
      }
      const key = personKey(other);
      const item = byPerson.get(key) ?? { key, name: other.name, net: 0, parts: [], converted: false };
      const iPay = t.from === g.myId;
      item.net += iPay ? -amountCommon : amountCommon;
      item.converted ||= g.currency !== commonCurrency;
      item.parts.push({ groupId: g.groupId, groupName: g.groupName, currency: g.currency, fromId: t.from, toId: t.to, amount: t.amount, iPay });
      byPerson.set(key, item);
    }
  }

  const items = [...byPerson.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.name.localeCompare(b.name));
  return { items, skippedGroups };
}
