import { randomBytes } from "node:crypto";
import { cleanNames, cleanPhone, sameName } from "./names";
import { formatMoney, isSupportedCurrency, parseAmount } from "./money";
import { parseDay } from "./dates";

// "Collect" rules with no database: checking the form, UPI and pay links,
// progress and the reminder message. Tested in tests/collect.test.ts.

export const MAX_ENTRIES = 300;

export type EntryLike = { name: string; amount: number; status: string };

// "a8Kz3pQ_x2": hard to guess, short enough to share.
export const newCollectCode = () => randomBytes(8).toString("base64url");

// A UPI ID like "asha@okicici" or "9876543210@ybl".
export function cleanUpi(raw: string): string | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return "";
  return /^[a-z0-9][a-z0-9._-]{1,99}@[a-z][a-z0-9.-]{1,48}$/.test(v) ? v : null;
}

// Only well-known payment links (so a collection can't send people to a look-alike page).
const PAY_HOSTS = ["paypal.me", "www.paypal.me", "venmo.com", "account.venmo.com", "cash.app", "revolut.me", "monzo.me"];
export function cleanPayLink(raw: string): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== "https:" || !PAY_HOSTS.includes(u.hostname.toLowerCase())) return null;
    return u.toString().slice(0, 200);
  } catch {
    return null;
  }
}

// The link that opens Google Pay / PhonePe / Paytm with everything filled in.
export function upiLink(c: { upiId: string; organiser: string; title: string }, amountMinor: number): string {
  const q = [
    `pa=${encodeURIComponent(c.upiId)}`,
    `pn=${encodeURIComponent(c.organiser.slice(0, 40))}`,
    ...(amountMinor > 0 ? [`am=${(amountMinor / 100).toFixed(2)}`] : []),
    "cu=INR",
    `tn=${encodeURIComponent(c.title.slice(0, 40))}`,
  ];
  return `upi://pay?${q.join("&")}`;
}

// Totals for the progress bar: who's paid (said so or checked), and how much.
export function progress(entries: EntryLike[], perPerson: number) {
  const paid = entries.filter((e) => e.status === "paid" || e.status === "confirmed");
  const due = entries.filter((e) => e.status === "due");
  const collected = paid.reduce((s, e) => s + e.amount, 0);
  const people = paid.length + due.length;
  const target = perPerson > 0 && people > 0 ? perPerson * people : 0;
  return { paidCount: paid.length, dueCount: due.length, people, collected, target, checked: paid.filter((e) => e.status === "confirmed").length };
}

// The message the organiser sends to the group ("still to pay: …").
export function reminderText(c: { title: string; organiser: string; amount: number; currency: string; dueDate: string }, due: string[], link: string): string {
  const each = c.amount > 0 ? `${formatMoney(c.amount, c.currency)} each` : "any amount";
  const by = c.dueDate ? ` by ${new Date(`${c.dueDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : "";
  const who = due.length ? `\nStill to pay: ${due.slice(0, 30).join(", ")}${due.length > 30 ? "…" : ""}` : "";
  return `${c.title}: ${each}${by}.${who}\nPay and tick your name here: ${link}`;
}

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

export type NewCollection = { title: string; note: string; currency: string; amount: string; dueDate: string; upiId: string; payLink: string; names: string; contacts?: string };

// Checks the form; returns what to save.
export function checkNewCollection(input: NewCollection, now = new Date()): Ok<{ data: { title: string; note: string; currency: string; amount: number; dueDate: string; upiId: string; payLink: string }; names: string[] }> | Fail {
  const title = input.title.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!title) return { ok: false, error: "Give the collection a name, like “Teacher’s Day gift”." };
  const currency = isSupportedCurrency(input.currency) ? input.currency : "INR";
  let amount = 0;
  if (input.amount.trim()) {
    const a = parseAmount(input.amount, currency);
    if (a === null) return { ok: false, error: "Enter the amount per person, like 300, or leave it empty for any amount." };
    amount = a;
  }
  let dueDate = "";
  if (input.dueDate.trim()) {
    // Any real date from today on (a far-future check isn't needed here).
    const d = parseDay(input.dueDate, new Date(now.getTime() + 400 * 86_400_000));
    if (!d) return { ok: false, error: "Pick a real date for “pay by”." };
    dueDate = input.dueDate.trim();
  }
  const upiId = cleanUpi(input.upiId);
  if (upiId === null) return { ok: false, error: "That UPI ID doesn’t look right. It’s like name@okicici or 98xxxxxx@ybl." };
  const payLink = cleanPayLink(input.payLink);
  if (payLink === null) return { ok: false, error: "Use a PayPal.me, Venmo, Cash App, Revolut or Monzo link, or leave it empty." };
  const names = cleanNames(input.names.split(/[\n,]+/)).slice(0, MAX_ENTRIES);
  return { ok: true, data: { title, note: input.note.trim().slice(0, 300), currency, amount, dueDate, upiId, payLink }, names };
}

// People picked from the organiser's contacts: [{ name, tel }] as sent by the
// form. Returns each listed name's phone (only for names on the list).
// A 10-digit Indian mobile without a country code gets +91 for rupee collections.
export function phonesFor(names: string[], contactsJson: string, currency: string): Record<string, string> {
  let picked: unknown;
  try {
    picked = JSON.parse(contactsJson || "[]");
  } catch {
    return {};
  }
  if (!Array.isArray(picked)) return {};
  const out: Record<string, string> = {};
  for (const c of picked.slice(0, MAX_ENTRIES)) {
    if (!c || typeof c !== "object") continue;
    const name = cleanNames([String((c as { name?: unknown }).name ?? "")])[0];
    let tel = cleanPhone(String((c as { tel?: unknown }).tel ?? ""));
    if (!name || tel.replace("+", "").length < 8) continue;
    if (!tel.startsWith("+") && currency === "INR" && /^[6-9]\d{9}$/.test(tel)) tel = `+91${tel}`;
    if (!tel.startsWith("+") && /^0[6-9]\d{9}$/.test(tel) && currency === "INR") tel = `+91${tel.slice(1)}`;
    const listed = names.find((n) => sameName(n, name));
    if (listed && !out[listed]) out[listed] = tel;
  }
  return out;
}

// A WhatsApp chat with one person, message typed in. Numbers without a country code open WhatsApp's own picker.
export function whatsappTo(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, "");
  return phone.startsWith("+") && digits.length >= 8 ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// The personal reminder: "Hi Ravi! ₹300 for Diwali fund by 5 Nov…"
export function personalReminder(c: { title: string; amount: number; currency: string; dueDate: string }, name: string, link: string): string {
  const first = name.split(" ")[0];
  const each = c.amount > 0 ? `${formatMoney(c.amount, c.currency)} for ` : "";
  const by = c.dueDate ? ` by ${new Date(`${c.dueDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : "";
  return `Hi ${first}! ${each}${c.title}${by}. Pay and tick your name here: ${link}`;
}
