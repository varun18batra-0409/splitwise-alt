// Home's "Coming up": one boarding pass per upcoming TRIP (never a flat, couple or card night), earliest first, at most three.
// Pure. The pass says From -> To (big codes), the date, how long is left (or "Day 2 of 5" on the trip), who is going, and one fun
// line for the stage of the countdown that never repeats the countdown itself (see passQuip).
import { countdownStage, passQuip, placeOf, type CountdownStage, type TripPhase } from "../countdown";
import { shortDay, type PassField } from "./money-card";

export const COMING_UP_MAX = 3;

// ---- The code for where you're going ----
// The rule, in order:
//  1. A well-known city has its airport code: Bangkok BKK, Dubai DXB, London LHR, Phuket HKT…
//  2. A country with no city ("Thailand") has its usual three letters: THA, UAE, USA, NZL…
//  3. Anything else: the name's own letters. One word: its first three (Goa -> GOA, Wayanad -> WAY). Two words: the first
//     word's initial and the second word's first two letters (Sri Lanka -> SLA). Three or more: the first three initials
//     (Rann of Kutch -> ROK).
// Never the same as the other end ("YOU"): a clash takes the name's next letters, then a digit.
const AIRPORT: [RegExp, string][] = [
  [/^bangkok$/i, "BKK"], [/^phuket$/i, "HKT"], [/^krabi$/i, "KBV"], [/^chiang mai$/i, "CNX"], [/^dubai$/i, "DXB"], [/^abu dhabi$/i, "AUH"],
  [/^singapore$/i, "SIN"], [/^london$/i, "LHR"], [/^paris$/i, "CDG"], [/^tokyo$/i, "TYO"], [/^osaka$/i, "OSA"], [/^bali$/i, "DPS"],
  [/^new york$/i, "NYC"], [/^los angeles$/i, "LAX"], [/^las vegas$/i, "LAS"], [/^san francisco$/i, "SFO"], [/^hong kong$/i, "HKG"],
  [/^maldives$/i, "MLE"], [/^kathmandu$/i, "KTM"], [/^colombo$/i, "CMB"], [/^hanoi$/i, "HAN"], [/^rome$/i, "ROM"], [/^istanbul$/i, "IST"],
  [/^sydney$/i, "SYD"], [/^melbourne$/i, "MEL"], [/^toronto$/i, "YYZ"], [/^barcelona$/i, "BCN"], [/^amsterdam$/i, "AMS"],
  [/^delhi$/i, "DEL"], [/^mumbai$/i, "BOM"], [/^bengaluru$/i, "BLR"], [/^hyderabad$/i, "HYD"], [/^chennai$/i, "MAA"], [/^kolkata$/i, "CCU"],
];
const COUNTRY3: Record<string, string> = {
  IN: "IND", TH: "THA", ID: "IDN", AE: "UAE", SG: "SIN", MV: "MDV", MY: "MYS", VN: "VNM", LK: "LKA", NP: "NPL", BT: "BTN", JP: "JPN",
  KR: "KOR", HK: "HKG", GB: "GBR", FR: "FRA", GR: "GRC", IT: "ITA", ES: "ESP", PT: "PRT", NL: "NLD", CH: "CHE", DE: "DEU", AT: "AUT",
  TR: "TUR", IS: "ISL", US: "USA", CA: "CAN", AU: "AUS", NZ: "NZL", MU: "MUS", SC: "SYC", EG: "EGY", ZA: "ZAF", KE: "KEN", MX: "MEX",
  CZ: "CZE", AZ: "AZE", GE: "GEO", KZ: "KAZ", UZ: "UZB", PH: "PHL", KH: "KHM", LA: "LAO", CN: "CHN", TW: "TWN", TZ: "TZA", MA: "MAR",
};

// A name's own letters as a three-letter code (rule 3 above).
export function nameCode(text: string): string {
  const words = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => [...w].join("").toUpperCase())
    .filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return [...words[0]].slice(0, 3).join("");
  if (words.length === 2) return `${[...words[0]][0]}${[...words[1]].slice(0, 2).join("")}`;
  return words.slice(0, 3).map((w) => [...w][0]).join("");
}

export function destinationCode(x: { city?: string; country?: string; countryName?: string; tripName: string }, taken: string[] = ["YOU"]): string {
  const city = (x.city ?? "").trim();
  const country = (x.country ?? "").trim().toUpperCase();
  const base = city
    ? AIRPORT.find(([re]) => re.test(city))?.[1] ?? nameCode(city)
    : country
      ? COUNTRY3[country] ?? (x.countryName ? nameCode(x.countryName) : country)
      : nameCode(placeOf(x.tripName));
  const code = base || "TRP";
  if (!taken.includes(code)) return code;
  const letters = [...(city || x.countryName || placeOf(x.tripName)).normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase()];
  const next = letters.slice(1, 4).join("");
  if (next.length === 3 && !taken.includes(next)) return next;
  for (let n = 2; n < 10; n++) if (!taken.includes(`${code.slice(0, 2)}${n}`)) return `${code.slice(0, 2)}${n}`;
  return code;
}

// ---- The passes ----
export type ComingUpTrip = {
  id: string;
  type: string; // only "trip" is ever shown
  name: string; // the group's name ("Thailand trip 2026")
  start: string; // "2026-12-19"
  end?: string | null;
  phase: TripPhase | null;
  going: number; // people in the trip right now
  stop?: { city?: string; country?: string; countryName?: string }; // the first place it goes to
};

export type TripPass = {
  id: string;
  title: string; // "Thailand"
  from: string; // "YOU"
  to: string; // "BKK", "THA", "GOA"
  fields: PassField[]; // Date, then In (or Now), then Going
  quip: string; // one fun line for this stage
  stage: CountdownStage;
  days: number | null; // days to go (before), else null
  phase: TripPhase;
};

// "35 days", "1 day"
const inWords = (d: number) => `${d} ${d === 1 ? "day" : "days"}`;

export function comingUp(trips: ComingUpTrip[], thisYear: string, max = COMING_UP_MAX): TripPass[] {
  const live = trips
    .filter((t): t is ComingUpTrip & { phase: TripPhase } => t.type === "trip" && Boolean(t.start) && t.phase !== null && t.phase.kind !== "after")
    .sort((a, b) => a.start.localeCompare(b.start) || (a.end || a.start).localeCompare(b.end || b.start) || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, max));
  const seen = new Map<CountdownStage, number>();
  return live.map((t) => {
    const stage = countdownStage(t.phase)!;
    const slot = seen.get(stage) ?? 0;
    seen.set(stage, slot + 1);
    const p = t.phase;
    const fields: PassField[] = [{ key: "date", label: "Date", value: shortDay(t.start, thisYear) }];
    if (p.kind === "before") fields.push({ key: "in", label: "In", value: inWords(p.days) });
    else if (p.kind === "today") fields.push({ key: "now", label: "Now", value: "Starts today" });
    else if (p.kind === "during") fields.push({ key: "now", label: "Now", value: `Day ${p.day} of ${p.of}` });
    if (t.going > 0) fields.push({ key: "going", label: "Going", value: String(t.going) });
    return {
      id: t.id,
      title: placeOf(t.name),
      from: "YOU",
      to: destinationCode({ city: t.stop?.city, country: t.stop?.country, countryName: t.stop?.countryName, tripName: t.name }),
      fields: fields.filter((f) => f.value),
      quip: passQuip(t.name, p, slot) ?? "",
      stage,
      days: p.kind === "before" ? p.days : null,
      phase: p,
    };
  });
}
