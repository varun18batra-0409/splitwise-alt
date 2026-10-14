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
