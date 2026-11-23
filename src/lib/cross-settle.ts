import { formatMoney } from "./money";
import type { Transfer } from "./settle";

// Smart Settle across groups.
//
// Each group already has its own Smart Settle payments. When the same person is
// in several of your groups, the payments between you and them are netted into
// ONE payment. Example: Goa trip says you pay Asha ₹1,000; Flat says Asha pays
// you ₹400 → across groups, you pay Asha ₹600.
//
// The same person is recognised by their Loopin account (signed in with a verified email) and by nothing else.
// A phone number or a name alone can't prove it's the same person, and the server refuses to record one payment across
// groups unless it is the same account in every part. So someone without an account (added by phone or by name) is
// settled group by group: each group gets its own row for them.
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
  key: string; // the person
  id: string; // this card: the person's key, with the currency added for the person's second (and later) card, so anchors and ?pay= stay unique
  currency: string; // the currency of the groups in this card: a person owed in two currencies gets one card per currency, never one netted card
  netOwn: number; // exact, in `currency`: + they pay you, − you pay them. Every "who pays whom" decision uses this, never `net`
  mixed: boolean; // the same person also has a card in another currency
  name: string;
  net: number; // in the common currency, for sorting and the "≈" totals only (informational): + they pay you, − you pay them
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

// A phone number split into the country code it CARRIES (only a "+" or "00" start counts as carrying one; "" if none) and
// the national number. A number typed without a country code keeps cc "" whatever group it is in, because the group's
// country is only a guess about the person. National numbers longer than 10 digits keep their last 10.
function phoneParts(raw: string, region = ""): { cc: string; national: string } {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") || digits.startsWith("00")) {
    const full = digits.replace(/^0+/, "");
    const known = Object.values(CALLING).find((c) => full.startsWith(c.code) && c.national.includes(full.length - c.code.length));
    if (known) return { cc: known.code, national: full.slice(known.code.length) };
    return full.length > 10 ? { cc: full.slice(0, full.length - 10), national: full.slice(-10) } : { cc: "", national: full };
  }
  const local = digits.replace(/^0+/, "");
  const info = CALLING[region.toUpperCase()];
  if (info && local.startsWith(info.code) && info.national.includes(local.length - info.code.length)) return { cc: "", national: local.slice(info.code.length) };
  return { cc: "", national: local.length > 10 ? local.slice(-10) : local };
}

export function personKey(m: { id?: string; name: string; phone: string; accountId?: string | null }, groupId = "", region = ""): string {
  if (m.accountId) return `acc:${m.accountId}`;
  const digits = m.phone.replace(/\D/g, "");
  if (digits.length >= 8) {
    const { cc, national } = phoneParts(m.phone, region);
    return `tel:${cc}:${national}`;
  }
  // Name only: never matched across groups. Its own row, in its own group.
  return `solo:${groupId}:${m.id ?? m.name.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

// Across all the people being compared: a number WITHOUT a country code joins the one number WITH a country code that
// has the same national digits ("98765 43210" in a Thai trip group and "+91 98765 43210" in an Indian flat are one
// person). Two numbers that both carry a code only match when the codes match (+1 650… is not +91 650…); if the
// same digits appear under two different codes, a number without a code is left on its own rather than guessed.
export function phoneKeyResolver(keys: Iterable<string>): (key: string) => string {
  const codes = new Map<string, Set<string>>();
  for (const k of keys) {
    const m = /^tel:(\d+):(\d+)$/.exec(k);
    if (m) (codes.get(m[2]) ?? codes.set(m[2], new Set()).get(m[2])!).add(m[1]);
  }
  return (k) => {
    const m = /^tel::(\d+)$/.exec(k);
    const set = m ? codes.get(m[1]) : undefined;
    return m && set && set.size === 1 ? `tel:${[...set][0]}:${m[1]}` : k;
  };
}

// The id of a person's row on the all-groups Settle up, so Home can link straight to it ("/settle#pay-acc_x1").
export function settleRowId(way: "pay" | "remind", key: string): string {
  return `${way}-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

// The key a person is combined under across groups on Settle up: their Loopin account, else their own row in their own group.
export function crossPersonKey(m: { id?: string; name: string; phone: string; accountId?: string | null }, groupId = ""): string {
  return m.accountId ? personKey(m, groupId) : personKey({ id: m.id, name: m.name, phone: "" }, groupId);
}

export function crossSettle(
  groups: GroupForSettle[],
  commonCurrency: string,
  toCommon: (amount: number, currency: string) => number | null,
): { items: CrossItem[]; skippedGroups: string[] } {
  // One card per person AND group currency: ₹4,200 owed in one group is never netted against $50 owed in another.
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
      const key = crossPersonKey(other, g.groupId);
      const slot = `${key}|${g.currency}`;
      const item = byPerson.get(slot) ?? { key, id: key, currency: g.currency, netOwn: 0, mixed: false, name: other.name, net: 0, parts: [], converted: false };
      const iPay = t.from === g.myId;
      item.net += iPay ? -amountCommon : amountCommon;
      item.netOwn += iPay ? -t.amount : t.amount;
      item.converted ||= g.currency !== commonCurrency;
      item.parts.push({ groupId: g.groupId, groupName: g.groupName, currency: g.currency, fromId: t.from, toId: t.to, amount: t.amount, iPay });
      byPerson.set(slot, item);
    }
  }

  const items = [...byPerson.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.name.localeCompare(b.name) || a.currency.localeCompare(b.currency));
  // A person's first card (the one in the display currency if there is one) keeps the old anchor id (Home links to it); the others get the currency added.
  const seenKeys = new Set<string>();
  for (const it of [...items].sort((a, b) => Number(b.currency === commonCurrency) - Number(a.currency === commonCurrency))) {
    if (seenKeys.has(it.key)) {
      it.id = `${it.key}|${it.currency}`;
      for (const o of items) if (o.key === it.key) o.mixed = true;
    } else seenKeys.add(it.key);
  }
  return { items, skippedGroups };
}

// The opener on the all-groups Settle screen. Unlike a group's own "I’ve paid" (a claim the other person confirms),
// this records straight away in every group, so it gets different words: "Record payment".
export function crossActionLabel(net: number): "Mark paid" | "Record payment" {
  return net < 0 ? "Record payment" : "Mark paid";
}

// What "Mark paid" / "Record payment" is about to record, in words, before anything is saved.
// Each group's part is exact (in that group's own currency). Only the combined
// total can be converted, so only the total carries ≈.
export function crossPreview(item: CrossItem, common: string): { lines: string[]; total: string; text: string; button: string } {
  // A person with cards in two currencies: the total is exact, in the card's own currency (nothing is converted).
  const exact = item.mixed;
  const net = exact ? item.netOwn : item.net;
  const cur = exact ? item.currency : common;
  // A fixed order, whatever order the groups loaded in: what you pay first, then what you get, each by group name.
  const parts = [...item.parts].sort((a, b) => Number(b.iPay) - Number(a.iPay) || a.groupName.localeCompare(b.groupName));
  const lines = parts.map((p) => `${p.groupName}: ${p.iPay ? `you pay ${item.name} ${formatMoney(p.amount, p.currency)}` : `${item.name} pays you ${formatMoney(p.amount, p.currency)}`}`);
  const amount = `${item.converted && !exact ? "≈ " : ""}${formatMoney(Math.abs(net), cur)}`;
  const total = net < 0 ? `Together: you pay ${item.name} ${amount}` : net > 0 ? `Together: ${item.name} pays you ${amount}` : `Together: you and ${item.name} are even`;
  const n = item.parts.length;
  return { lines, total, text: `${[...lines, total].join(" · ")}.`, button: `Record in ${n} ${n === 1 ? "group" : "groups"}` };
}

// "Even across groups": someone you are even with overall, though you owe them in one group and they owe you in another. Nothing is
// paid for them: "Clear both" records the same linked parts as "Record payment" always did, and they cancel each other.
// Even only when every part is in ONE currency and the parts, signed by who pays, add to exactly 0 in that currency. A converted net of 0
// across different currencies (₹4,200 against $50 at 84) is not even: Clear both would swap currencies. Two USD groups seen from an INR account still qualify.
export function isEvenItem(item: Pick<CrossItem, "parts">): boolean {
  if (item.parts.length === 0) return false;
  const currency = item.parts[0].currency;
  if (!item.parts.every((p) => p.currency === currency)) return false;
  return item.parts.reduce((t, p) => t + (p.iPay ? -p.amount : p.amount), 0) === 0;
}

// What Clear both is about to record, one line per group in that group's own currency ("You paid Asha ₹1,000 in Thailand trip").
export function clearBothLines(item: CrossItem): string[] {
  const parts = [...item.parts].sort((a, b) => Number(b.iPay) - Number(a.iPay) || a.groupName.localeCompare(b.groupName));
  return parts.map((p) => (p.iPay ? `You paid ${item.name} ${formatMoney(p.amount, p.currency)} in ${p.groupName}` : `${item.name} paid you ${formatMoney(p.amount, p.currency)} in ${p.groupName}`));
}

// The one plain line on that row: what you are owed first, then what you owe, each in its own group ("Owed ₹4,200 in Flat 402, owe ₹4,200 in Thailand trip. Nothing to pay.").
export function evenCaption(item: CrossItem): string {
  const parts = [...item.parts].sort((a, b) => Number(a.iPay) - Number(b.iPay) || a.groupName.localeCompare(b.groupName));
  const bits = parts.map((p) => `${p.iPay ? "owe" : "owed"} ${formatMoney(p.amount, p.currency)} in ${p.groupName}`);
  const line = bits.join(", ");
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}. Nothing to pay.`;
}

// The Clear both sheet's words: nothing is paid, the two sides cancel.
export const CLEAR_BOTH_SUBTITLE = "Nothing is paid. The two sides cancel each other out.";
export const CLEAR_BOTH_NOTE = "This only cancels what you owe each other across groups. No money moves.";
