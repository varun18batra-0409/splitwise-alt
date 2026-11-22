import { rateToString } from "./conversion";

// Live exchange rates from Frankfurter (free, no key): https://frankfurter.dev
// This file only talks to the API. Caching lives in rate-cache.ts.

export const FRANKFURTER = "https://api.frankfurter.dev/v2";

export type RateLookup =
  | { ok: true; rate: string; date: string }
  | { ok: false; reason: "unsupported" | "unavailable" | "offline"; message: string };

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const TIMEOUT_MS = 6000;

// The list of currency codes the API knows about.
export async function fetchSupportedCodes(fetchImpl: FetchLike = fetch): Promise<Set<string> | null> {
  try {
    const res = await fetchImpl(`${FRANKFURTER}/currencies`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = await res.json();
    if (!Array.isArray(body)) return null;
    const codes = body
      .map((c) => (c && typeof c === "object" ? (c as { iso_code?: unknown }).iso_code : null))
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.toUpperCase());
    return codes.length > 0 ? new Set(codes) : null;
  } catch {
    return null;
  }
}

// "How many `to` for 1 `from`?" e.g. THB → INR = 2.8367.
// `supported` (optional) lets us say "not supported" without a wasted request.
export async function fetchPairRate(
  from: string,
  to: string,
  opts: { fetchImpl?: FetchLike; supported?: Set<string> | null } = {},
): Promise<RateLookup> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const unsupported = (code: string): RateLookup => ({
    ok: false,
    reason: "unsupported",
    message: `Live rates aren't available for ${code}. Enter the rate yourself.`,
  });

  if (opts.supported) {
    if (!opts.supported.has(from)) return unsupported(from);
    if (!opts.supported.has(to)) return unsupported(to);
  }

  try {
    const res = await fetchImpl(`${FRANKFURTER}/rate/${from}/${to}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404 || res.status === 422) {
      return { ok: false, reason: "unavailable", message: `No live rate for ${from} → ${to} right now. Enter the rate yourself.` };
    }
    if (!res.ok) {
      return { ok: false, reason: "offline", message: "The rate service isn't responding. Enter the rate yourself, or try again later." };
    }
    const body = (await res.json()) as { rate?: unknown; date?: unknown };
    if (typeof body.rate !== "number" || !(body.rate > 0) || typeof body.date !== "string") {
      return { ok: false, reason: "unavailable", message: "Got an unexpected answer from the rate service. Enter the rate yourself." };
    }
    return { ok: true, rate: rateToString(body.rate), date: body.date.slice(0, 10) };
  } catch {
    return { ok: false, reason: "offline", message: "Couldn't reach the rate service. Enter the rate yourself, or try again later." };
  }
}

// The rate on ONE day (the day the money was spent): Frankfurter's `?date=` form of the same address.
// When that day had no fixing (a weekend) the service answers with the last working day before it, so the answer's own date may be
// earlier than asked for, but never later and never more than 7 days earlier. Anything else is "no rate for that day": the caller
// asks the person to enter one. It never quietly uses another day's rate.
export async function fetchRateOn(
  from: string,
  to: string,
  day: string,
  opts: { fetchImpl?: FetchLike; supported?: Set<string> | null } = {},
): Promise<RateLookup> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const none = (): RateLookup => ({ ok: false, reason: "unavailable", message: `There is no exchange rate for ${day}. Enter the rate yourself.` });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return none();
  if (opts.supported && (!opts.supported.has(from) || !opts.supported.has(to))) return none();
  try {
    const res = await fetchImpl(`${FRANKFURTER}/rate/${from}/${to}?date=${day}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return res.status === 404 || res.status === 422 ? none() : { ok: false, reason: "offline", message: "The rate service isn't responding. Enter the rate yourself, or try again later." };
    const body = (await res.json()) as { rate?: unknown; date?: unknown };
    if (typeof body.rate !== "number" || !(body.rate > 0) || typeof body.date !== "string") return none();
    const got = body.date.slice(0, 10);
    const gap = (Date.parse(`${day}T12:00:00Z`) - Date.parse(`${got}T12:00:00Z`)) / 86_400_000;
    if (!(gap >= 0 && gap <= 7)) return none();
    return { ok: true, rate: rateToString(body.rate), date: got };
  } catch {
    return { ok: false, reason: "offline", message: "Couldn't reach the rate service. Enter the rate yourself, or try again later." };
  }
}
