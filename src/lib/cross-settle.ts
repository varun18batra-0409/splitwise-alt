import { formatMoney } from "./money";
import type { Transfer } from "./settle";

// Smart Settle across groups.
//
// Each group already has its own Smart Settle payments. When the same person is
// in several of your groups, the payments between you and them are netted into
// ONE payment. Example: Goa trip says you pay Asha ₹1,000; Flat says Asha pays
// you ₹400 → across groups, you pay Asha ₹600.
//
// The same person is recognised by their Loopin account (signed in with a
// verified email), else by their full international phone number (a number typed
// with or without the country code is the same number; +1 650… and +91 650… are not). Two people who only
// share a name are NEVER merged: someone added by name alone is settled group by
// group (each group's own row), because a name can't prove it's the same person.
// Recording it as paid records the underlying payment in each group, so every
// group's own balances stay right.

export type GroupForSettle = {
  groupId: string;
  groupName: string;
  currency: string;
  region?: string; // the group's country (ISO code like "IN"); local numbers are read in it. Left out: guessed from the currency
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

// Country calling code and the lengths of a number without it (after dropping a leading trunk 0).
const CALLING: Record<string, { code: string; national: number[] }> = {
  IN: { code: "91", national: [10] },
  US: { code: "1", national: [10] },
  CA: { code: "1", national: [10] },
  GB: { code: "44", national: [10] },
  AU: { code: "61", national: [9] },
  SG: { code: "65", national: [8] },
  AE: { code: "971", national: [9] },
};
const CURRENCY_REGION: Record<string, string> = { INR: "IN", USD: "US", CAD: "CA", GBP: "GB", AUD: "AU", SGD: "SG", AED: "AE" };

export function regionForGroup(g: { region?: string; currency: string }): string {
  return (g.region || CURRENCY_REGION[g.currency] || "").toUpperCase();
}

// A phone number as full international digits (no +): "+91 98765 43210", "098765-43210" and "98765 43210" in an Indian
// group are all "919876543210". With no usable country, the digits are kept as typed (minus a leading 0).
export function fullPhoneDigits(raw: string, region = ""): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.replace(/^0+/, "");
  if (digits.startsWith("00")) return digits.replace(/^0+/, "");
  const info = CALLING[region.toUpperCase()];
  const local = digits.replace(/^0+/, "");
  if (!info) return local;
  if (local.startsWith(info.code) && info.national.includes(local.length - info.code.length)) return local;
  if (info.national.includes(local.length)) return info.code + local;
  return local;
}

export function personKey(m: { id?: string; name: string; phone: string; accountId?: string | null }, groupId = "", region = ""): string {
  if (m.accountId) return `acc:${m.accountId}`;
  const digits = m.phone.replace(/\D/g, "");
  if (digits.length >= 8) return `tel:${fullPhoneDigits(m.phone, region)}`;
  // Name only: never matched across groups. Its own row, in its own group.
  return `solo:${groupId}:${m.id ?? m.name.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

// The id of a person's row on the all-groups Settle up, so Home can link straight to it ("/settle#pay-acc_x1").
export function settleRowId(way: "pay" | "remind", key: string): string {
  return `${way}-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
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
      const key = personKey(other, g.groupId, regionForGroup(g));
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

// The opener on the all-groups Settle screen. Unlike a group's own "I’ve paid" (a claim the other person confirms),
// this records straight away in every group, so it gets different words: "Record payment".
export function crossActionLabel(net: number): "They’ve paid me" | "Record payment" | "Mark paid" {
  return net > 0 ? "They’ve paid me" : net < 0 ? "Record payment" : "Mark paid";
}

// What "They’ve paid me" / "Record payment" is about to record, in words, before anything is saved.
// Each group's part is exact (in that group's own currency). Only the combined
// total can be converted, so only the total carries ≈.
export function crossPreview(item: CrossItem, common: string): { lines: string[]; total: string; text: string; button: string } {
  // A fixed order, whatever order the groups loaded in: what you pay first, then what you get, each by group name.
  const parts = [...item.parts].sort((a, b) => Number(b.iPay) - Number(a.iPay) || a.groupName.localeCompare(b.groupName));
  const lines = parts.map((p) => `${p.groupName}: ${p.iPay ? `you pay ${item.name} ${formatMoney(p.amount, p.currency)}` : `${item.name} pays you ${formatMoney(p.amount, p.currency)}`}`);
  const amount = `${item.converted ? "≈ " : ""}${formatMoney(Math.abs(item.net), common)}`;
  const total = item.net < 0 ? `Together: you pay ${item.name} ${amount}` : item.net > 0 ? `Together: ${item.name} pays you ${amount}` : `Together: you and ${item.name} are even`;
  const n = item.parts.length;
  return { lines, total, text: `${[...lines, total].join(" · ")}.`, button: `Record in ${n} ${n === 1 ? "group" : "groups"}` };
}
