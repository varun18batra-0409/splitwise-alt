import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The rate for an expense's own day (an expense added offline is sent days later) must never become "today's rate" for anything else, and
// a rate service that is down must never be answered with an older day's rate. Every number below is chosen by hand.
//   10 Nov 2026 rate: 2.5.   Today's rate: 2.8.   (1 THB = 2.5 INR on the 10th, 2.8 INR today.)
const today = new Date().toISOString().slice(0, 10);
type Lookup = import("@/lib/rates").RateLookup;
const fetchPairRate = vi.fn(async (..._a: unknown[]): Promise<Lookup> => ({ ok: true, rate: "2.8", date: today }));
const fetchRateOn = vi.fn(async (_f: string, _t: string, day: string, ..._o: unknown[]): Promise<Lookup> => ({ ok: true, rate: "2.5", date: day }));
vi.mock("@/lib/rates", async (orig) => ({ ...(await orig<typeof import("@/lib/rates")>()), fetchPairRate, fetchRateOn, fetchSupportedCodes: vi.fn(async () => null) }));

const { db } = await import("@/lib/db");
const { getRate, getRateOn, displayRate } = await import("@/lib/rate-cache");
const actual = await vi.importActual<typeof import("@/lib/rates")>("@/lib/rates");

const BASES = ["XRA", "XRB", "XRC", "XRD", "XRE", "XRF"];
afterAll(async () => {
  await db.exchangeRate.deleteMany({ where: { base: { in: BASES } } });
});
beforeEach(() => {
  fetchPairRate.mockClear();
  fetchRateOn.mockClear();
});

describe("a past day's rate is not today's rate", () => {
  it("getRateOn for 10 Nov gives 2.5; then getRate still gives TODAY's 2.8, fetched fresh", async () => {
    const past = await getRateOn("XRA", "INR", "2026-11-10", today);
    expect(past).toEqual({ ok: true, rate: "2.5", date: "2026-11-10" });
    const now = await getRate("XRA", "INR");
    expect(now).toEqual({ ok: true, rate: "2.8", date: today });
    expect(fetchPairRate).toHaveBeenCalledTimes(1); // the 10 Nov row was not trusted as "fresh"
  });

  it("the saved 10 Nov row is kept for 10 Nov (asking again does not call the service) but is never the newest rate", async () => {
    await getRateOn("XRB", "INR", "2026-11-10", today);
    fetchRateOn.mockClear();
    expect(await getRateOn("XRB", "INR", "2026-11-10", today)).toEqual({ ok: true, rate: "2.5", date: "2026-11-10" });
    expect(fetchRateOn).not.toHaveBeenCalled();
    const row = await db.exchangeRate.findFirstOrThrow({ where: { base: "XRB", date: "2026-11-10" } });
    expect(row.fetchedAt.toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });

  it("Home's rate (displayRate) picks the newest FIXING even when an older day's row was fetched later", async () => {
    await db.exchangeRate.create({ data: { base: "XRC", quote: "INR", rate: "2.8", date: today, fetchedAt: new Date(Date.now() - 3_600_000) } });
    await db.exchangeRate.create({ data: { base: "XRC", quote: "INR", rate: "2.5", date: "2026-11-10", fetchedAt: new Date() } }); // how it used to be saved
    const r = await displayRate("XRC", "INR", () => undefined);
    expect(r).toEqual({ ok: true, rate: "2.8", date: today });
  });
});

describe("a rate service that is down is not a rate for today", () => {
  it("an expense dated today, service down, only an old saved rate: no rate (offline), never the old one", async () => {
    await db.exchangeRate.create({ data: { base: "XRD", quote: "INR", rate: "2.1", date: "2026-11-01", fetchedAt: new Date(Date.now() - 20 * 86_400_000) } });
    fetchPairRate.mockResolvedValueOnce({ ok: false, reason: "offline", message: "down" });
    const r = await getRateOn("XRD", "INR", today, today);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ ok: false, reason: "offline" });
  });
});

describe("the rate for a day with no fixing may come from at most 4 days before", () => {
  const say = (date: string) => async () => new Response(JSON.stringify({ rate: 2.5, date }), { status: 200 });
  it("22 Nov asked, 18 Nov answered (4 days: a long weekend) is used; 17 Nov (5 days) is not", async () => {
    const ok = await actual.fetchRateOn("THB", "INR", "2026-11-22", { fetchImpl: say("2026-11-18") as never });
    expect(ok).toEqual({ ok: true, rate: "2.5", date: "2026-11-18" });
    const no = await actual.fetchRateOn("THB", "INR", "2026-11-22", { fetchImpl: say("2026-11-17") as never });
    expect(no).toMatchObject({ ok: false, reason: "unavailable" });
  });
  it("an answer dated AFTER the day asked is never used", async () => {
    const no = await actual.fetchRateOn("THB", "INR", "2026-11-22", { fetchImpl: say("2026-11-23") as never });
    expect(no.ok).toBe(false);
  });
});

describe("a weekend or holiday is asked about once", () => {
  it("Sunday 15 Nov asked, Friday 13 Nov answered: the second ask is served from what is kept (the service is called once), the rate is the same 2.5", async () => {
    fetchRateOn.mockResolvedValue({ ok: true, rate: "2.5", date: "2026-11-13" });
    const first = await getRateOn("XRE", "INR", "2026-11-15", today);
    expect(first).toEqual({ ok: true, rate: "2.5", date: "2026-11-13" });
    fetchRateOn.mockClear();
    const second = await getRateOn("XRE", "INR", "2026-11-15", today);
    expect(second).toMatchObject({ ok: true, rate: "2.5" });
    expect(fetchRateOn).not.toHaveBeenCalled();
    fetchRateOn.mockImplementation(async (_f, _t, day) => ({ ok: true, rate: "2.5", date: day }));
  });
});

describe("online: a service that is down still falls back to the last saved rate, marked old", () => {
  it("saved 2.1 from 3 days ago, service offline: getRate gives 2.1 with stale: true (it is only getRateOn for TODAY's draft that refuses)", async () => {
    await db.exchangeRate.create({ data: { base: "XRF", quote: "INR", rate: "2.1", date: "2026-11-19", fetchedAt: new Date(Date.now() - 3 * 86_400_000) } });
    fetchPairRate.mockResolvedValueOnce({ ok: false, reason: "offline", message: "down" });
    const r = await getRate("XRF", "INR");
    expect(r).toEqual({ ok: true, rate: "2.1", date: "2026-11-19", stale: true });
  });
});
