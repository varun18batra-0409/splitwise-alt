import { dayKey, DEFAULT_TIME_ZONE } from "../dates";
import { addMonths, monthKey } from "./month";
import { getCategory } from "../categories";
import type { CoverId } from "../covers";

// The cards that slide by at the top of Home (besides your balance): your
// month in numbers, a seasonal nudge, and "Coming from another app?".

type Exp = { amount: number; kind?: string | null; category: string; spentAt: Date | null; createdAt: Date; shares: { memberId: string; amount: number }[] };

export type MonthNumbers = {
  month: string; // "2026-10"
  name: string; // "October"
  wrapped: boolean; // true: last month, looked back on in the first days of a new one
  share: number; // your part of everything, in `currency` (refunds taken off)
  currency: string;
  converted: boolean; // some groups were in other currencies (shown with ≈)
  count: number; // expenses
  top: string | null; // the category you spent most on ("Stay")
};

// Which month the card is about: this one, or (in the first three days of a month) the one that just ended.
export function viewMonth(now = new Date(), tz: string = DEFAULT_TIME_ZONE): { month: string; wrapped: boolean } {
  const today = dayKey(now, tz);
  const wrapped = Number(today.slice(8, 10)) <= 3;
  return { month: wrapped ? addMonths(today.slice(0, 7), -1) : today.slice(0, 7), wrapped };
}

// Your month: what your part came to across your groups. In the first three
// days of a month it looks back at the one that just ended.
export function monthNumbers(
  groups: { currency: string; myId: string; expenses: Exp[] }[],
  toCommon: (amount: number, currency: string) => number | null,
  common: string,
  now = new Date(),
  tz: string = DEFAULT_TIME_ZONE,
): MonthNumbers | null {
  const { month, wrapped } = viewMonth(now, tz);
  let share = 0;
  let count = 0;
  let converted = false;
  const byCat = new Map<string, number>();
  for (const g of groups) {
    for (const e of g.expenses) {
      if (monthKey(e.spentAt ?? e.createdAt, tz) !== month) continue;
      if (e.kind === "pot") continue; // a card game's result isn't spending
      const mine = e.shares.find((s) => s.memberId === g.myId)?.amount ?? 0;
      const signed = e.kind === "refund" ? -mine : mine;
      if (e.kind !== "refund") count++;
      if (signed === 0) continue;
      const inCommon = g.currency === common ? signed : toCommon(Math.abs(signed), g.currency);
      if (inCommon === null) continue;
      const v = g.currency === common ? signed : Math.sign(signed) * inCommon;
      if (g.currency !== common) converted = true;
      share += v;
      byCat.set(e.category, (byCat.get(e.category) ?? 0) + v);
    }
  }
  if (count === 0) return null;
  const topId = [...byCat].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0]?.[0];
  const [y, m] = month.split("-").map(Number);
  const name = new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  return { month, name, wrapped, share: Math.max(0, share), currency: common, converted, count, top: topId ? getCategory(topId).short : null };
}

export type Season = {
  id: string;
  eyebrow: string;
  title: string;
  text: string;
  button: string;
  cover: CoverId;
  href: string;
};

// Festivals and holidays worth a group. Dates are inclusive, "YYYY-MM-DD"
// (one year) or "MM-DD" (every year). Add new ones here.
const SEASONS: (Omit<Season, "href"> & { from: string; to: string; name: string; type: string; countries?: string[] })[] = [
  {
    // Diwali game nights.
    id: "diwali-2026", from: "2026-10-05", to: "2026-11-08", eyebrow: "Diwali is on 8 Nov 🪔", title: "Diwali game night?",
    text: "Cards, board games or any game: Game night keeps the score and shows who pays whom.", button: "Start a game night", cover: "cards", name: "Diwali game night", type: "pot", countries: ["IN"],
  },
  {
    id: "thanksgiving-2026", from: "2026-11-01", to: "2026-11-26", eyebrow: "Thanksgiving is on Nov 26", title: "Friendsgiving?",
    text: "One group for the turkey, the drinks and the trip home.", button: "Start a group", cover: "dinner", name: "Friendsgiving", type: "other", countries: ["US"],
  },
  {
    id: "holi-2027", from: "2027-03-06", to: "2027-03-22", eyebrow: "Holi is on 22 Mar", title: "A Holi weekend away?",
    text: "One group for the colours, the gujiya and the trip: split as you go.", button: "Start a trip", cover: "photo-friends", name: "Holi weekend", type: "trip", countries: ["IN"],
  },
  {
    id: "summer-in", from: "04-15", to: "05-25", eyebrow: "Summer holidays", title: "Escaping the heat?",
    text: "Hills, beaches or abroad: one trip group, everyone square by the time you’re back.", button: "Plan a trip", cover: "mountain", name: "Summer trip", type: "trip", countries: ["IN"],
  },
  {
    id: "monsoon-in", from: "06-20", to: "08-20", eyebrow: "Monsoon weekends", title: "A rainy-day getaway?",
    text: "Lonavala, Coorg, a waterfall drive: split the villa, the fuel and the chai.", button: "Plan a weekend", cover: "mountain", name: "Monsoon weekend", type: "trip", countries: ["IN"],
  },
  {
    id: "diwali-2027", from: "2027-10-10", to: "2027-10-29", eyebrow: "Diwali is on 29 Oct 🪔", title: "Diwali game night?",
    text: "Cards, board games or any game: Game night keeps the score and shows who pays whom.", button: "Start a game night", cover: "cards", name: "Diwali game night", type: "pot", countries: ["IN"],
  },
  {
    id: "lunar-2027", from: "2027-01-20", to: "2027-02-06", eyebrow: "Lunar New Year is on 6 Feb", title: "Reunion dinner?",
    text: "The dinner, the hongbao run, the trip home: one group, split fairly.", button: "Start a group", cover: "dinner", name: "Reunion dinner", type: "other", countries: ["SG", "HK", "TW", "MY", "VN", "KR", "CN"],
  },
  {
    id: "eid-2027", from: "2027-02-24", to: "2027-03-10", eyebrow: "Eid is coming", title: "Eid get-together?",
    text: "The feast, the gifts, the trip to family: one group for all of it.", button: "Start a group", cover: "dinner", name: "Eid get-together", type: "other", countries: ["AE", "SA", "QA", "KW", "BH", "OM", "EG", "MY", "ID", "TR", "PK", "BD"],
  },
  {
    id: "easter-2027", from: "2027-03-10", to: "2027-03-28", eyebrow: "Easter is on 28 Mar", title: "Long weekend away?",
    text: "Four days off: one group for the cottage, the train and the chocolate.", button: "Plan a trip", cover: "mountain", name: "Easter weekend", type: "trip", countries: ["GB", "IE", "AU", "NZ", "DE", "FR", "IT", "ES", "NL", "AT", "CH"],
  },
  {
    id: "spring-break", from: "03-01", to: "03-25", eyebrow: "Spring break", title: "Spring break trip?",
    text: "Flights, the rental and the late nights: one group, no maths on the beach.", button: "Plan a trip", cover: "beach", name: "Spring break", type: "trip", countries: ["US", "CA"],
  },
  {
    id: "july4", from: "06-20", to: "07-04", eyebrow: "The Fourth is coming", title: "Fourth of July cookout?",
    text: "Burgers, fireworks and the cooler: split it before the sparklers.", button: "Start a group", cover: "dinner", name: "Fourth of July", type: "other", countries: ["US"],
  },
  {
    id: "summer-north", from: "06-01", to: "08-15", eyebrow: "Summer’s here", title: "Summer trip?",
    text: "A villa, a road trip or a festival: one group, split as you go.", button: "Plan a trip", cover: "beach", name: "Summer trip", type: "trip", countries: ["GB", "IE", "DE", "FR", "IT", "ES", "NL", "PT", "AT", "CH", "SE", "NO", "DK", "FI", "PL", "CA"],
  },
  {
    id: "summer-south", from: "01-02", to: "02-20", eyebrow: "Summer’s here", title: "Beach weekend?",
    text: "The house, the fuel and the barbecue: one group, everyone square by Monday.", button: "Plan a trip", cover: "beach", name: "Beach weekend", type: "trip", countries: ["AU", "NZ", "ZA", "AR", "CL", "BR"],
  },
  {
    id: "thanksgiving-2027", from: "2027-11-01", to: "2027-11-25", eyebrow: "Thanksgiving is on Nov 25", title: "Friendsgiving?",
    text: "One group for the turkey, the drinks and the trip home.", button: "Start a group", cover: "dinner", name: "Friendsgiving", type: "other", countries: ["US"],
  },
  {
    id: "christmas", from: "12-01", to: "12-24", eyebrow: "Christmas is coming", title: "Holiday plans?",
    text: "Secret Santa, a trip or a big dinner: one group, split fairly.", button: "Start a group", cover: "photo-snow", name: "Holidays", type: "other",
  },
  {
    id: "new-year", from: "12-26", to: "12-31", eyebrow: "New Year’s Eve", title: "New Year plans?",
    text: "A trip or a party: one group, everyone square by January.", button: "Start a group", cover: "mountain", name: "New Year trip", type: "trip",
  },
];

// `country`: where the visitor is ("IN", "US"…; null when unknown). Festivals
// tied to a country only show there. Left out (tests), every season counts.
export function seasonNow(now = new Date(), tz: string = DEFAULT_TIME_ZONE, country?: string | null): Season | null {
  const today = dayKey(now, tz);
  const md = today.slice(5);
  const s = SEASONS.find(
    (x) =>
      (country === undefined || !x.countries || (country !== null && x.countries.includes(country))) &&
      (x.from.length === 5 ? md >= x.from && md <= x.to : today >= x.from && today <= x.to),
  );
  if (!s) return null;
  const q = new URLSearchParams({ name: s.name, type: s.type, cover: s.cover });
  return { id: s.id, eyebrow: s.eyebrow, title: s.title, text: s.text, button: s.button, cover: s.cover, href: `/groups/new?${q}` };
}
