import { db } from "./db";
import { fetchPairRate, fetchRateOn, fetchSupportedCodes, type RateLookup } from "./rates";

// Keeps the number of calls to the rate service small:
// - a rate fetched in the last 6 hours is reused (memory first, then the database)
// - the list of supported currencies is fetched at most once a day
// - failures are remembered for 5 minutes so we don't retry on every screen open
// - if the service is down, the most recent saved rate is used and its date shown

export type RateAnswer = (RateLookup & { ok: true; stale?: boolean }) | (RateLookup & { ok: false });

const FRESH_MS = 6 * 60 * 60 * 1000;
const FAIL_MS = 5 * 60 * 1000;
const CODES_MS = 24 * 60 * 60 * 1000;

// An old day's answers (an old day's rate never changes), by `from-to-day`.
const pastDays = new Map<string, RateAnswer>();
const memory = new Map<string, { at: number; answer: RateAnswer }>();
let codesCache: { at: number; codes: Set<string> | null } | null = null;

async function supportedCodes(): Promise<Set<string> | null> {
  const now = Date.now();
  if (codesCache && now - codesCache.at < (codesCache.codes ? CODES_MS : FAIL_MS)) return codesCache.codes;
  const codes = await fetchSupportedCodes();
  codesCache = { at: now, codes };
  return codes;
}

export async function getRate(from: string, to: string): Promise<RateAnswer> {
  if (from === to) return { ok: true, rate: "1", date: new Date().toISOString().slice(0, 10) };

  const key = `${from}-${to}`;
  const now = Date.now();
  const hit = memory.get(key);
  if (hit && now - hit.at < (hit.answer.ok ? FRESH_MS : FAIL_MS)) return hit.answer;

  const saved = await db.exchangeRate.findFirst({
    where: { base: from, quote: to },
    orderBy: { fetchedAt: "desc" },
  });
  if (saved && now - saved.fetchedAt.getTime() < FRESH_MS) {
    const answer: RateAnswer = { ok: true, rate: saved.rate, date: saved.date };
    memory.set(key, { at: saved.fetchedAt.getTime(), answer });
    return answer;
  }

  const live = await fetchPairRate(from, to, { supported: await supportedCodes() });
  if (live.ok) {
    await db.exchangeRate.create({ data: { base: from, quote: to, rate: live.rate, date: live.date } });
    memory.set(key, { at: now, answer: live });
    return live;
  }

  // Service down? Fall back to the last rate we saved, and say how old it is.
  if (saved && live.reason === "offline") {
    const answer: RateAnswer = { ok: true, rate: saved.rate, date: saved.date, stale: true };
    memory.set(key, { at: now - FRESH_MS + FAIL_MS, answer }); // retry the live service in 5 minutes
    return answer;
  }

  memory.set(key, { at: now, answer: live });
  return live;
}

// The rate on the day an expense was spent (an expense added offline is sent days later). Today: the usual rate. Another day: a rate
// already saved for exactly that day, or one fetched for it. It NEVER falls back to today's or the latest rate: with none for
// that day the answer is "not ok" and the person is asked to enter one.
export async function getRateOn(from: string, to: string, day: string, todayKey = new Date().toISOString().slice(0, 10)): Promise<RateAnswer> {
  if (from === to) return { ok: true, rate: "1", date: day };
  if (day >= todayKey) {
    const r = await getRate(from, to);
    // A rate service that is down gives back the last saved rate from some earlier day (stale): that is no rate for today. Not ok, "offline":
    // the expense keeps waiting and is tried again later; it is never added at an older day's rate.
    if (r.ok && r.stale) return { ok: false, reason: "offline", message: "Couldn't reach the rate service. Enter the rate yourself, or try again later." };
    return r;
  }
  const memKey = `${from}-${to}-${day}`;
  const remembered = pastDays.get(memKey);
  if (remembered) return remembered;
  const saved = await db.exchangeRate.findFirst({ where: { base: from, quote: to, date: day }, orderBy: { fetchedAt: "desc" } });
  if (saved) return { ok: true, rate: saved.rate, date: saved.date };
  const live = await fetchRateOn(from, to, day, { supported: await supportedCodes() });
  if (live.ok) {
    // Kept in memory only, under the day that was asked about (a weekend or holiday answers with the working day before it, and the answer
    // keeps its real fixing date). Offline code NEVER writes to ExchangeRate: only getRate does, exactly as on the live app.
    if (pastDays.size > 500) pastDays.clear();
    pastDays.set(memKey, live);
  }
  return live;
}

// For screens (Home's overall balance, a group's second currency): never waits
// for the internet. Shows the last saved rate straight away — marked stale if
// it's old — and asks for a fresh one in the background (`later`, usually
// Next.js's after()). With nothing saved yet, the screen simply leaves the
// converted amount out this once.
export async function displayRate(from: string, to: string, later: (job: () => Promise<unknown>) => void): Promise<RateAnswer> {
  if (from === to) return { ok: true, rate: "1", date: new Date().toISOString().slice(0, 10) };
  const key = `${from}-${to}`;
  const now = Date.now();
  const hit = memory.get(key);
  if (hit && hit.answer.ok && now - hit.at < FRESH_MS) return hit.answer;
  const saved = await db.exchangeRate.findFirst({ where: { base: from, quote: to }, orderBy: { fetchedAt: "desc" } });
  const fresh = Boolean(saved && now - saved.fetchedAt.getTime() < FRESH_MS);
  if (!fresh) later(() => getRate(from, to).catch(() => null));
  if (!saved) return { ok: false, reason: "unavailable", message: "The rate isn’t loaded yet." };
  const answer: RateAnswer = fresh ? { ok: true, rate: saved.rate, date: saved.date } : { ok: true, rate: saved.rate, date: saved.date, stale: true };
  if (fresh) memory.set(key, { at: saved.fetchedAt.getTime(), answer });
  return answer;
}
