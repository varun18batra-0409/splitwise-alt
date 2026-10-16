import { afterAll, describe, expect, it, vi } from "vitest";

// Screens (Home's "you're owed overall", a group's second currency) must never
// wait for the internet: they show the last saved rate at once and refresh it
// in the background.
const fetchPairRate = vi.fn(async () => ({ ok: true as const, rate: "0.0125", date: "2026-10-16" }));
vi.mock("@/lib/rates", () => ({ fetchPairRate, fetchSupportedCodes: vi.fn(async () => null) }));

const { db } = await import("@/lib/db");
const { displayRate } = await import("@/lib/rate-cache");

describe("rates shown on screens", () => {
  afterAll(async () => {
    await db.exchangeRate.deleteMany({ where: { base: { in: ["XAA", "XBB"] } } });
  });

  it("an old saved rate is shown straight away; the fresh one is fetched later", async () => {
    await db.exchangeRate.create({ data: { base: "XAA", quote: "INR", rate: "80", date: "2026-10-01", fetchedAt: new Date(Date.now() - 3 * 86_400_000) } });
    const later: (() => Promise<unknown>)[] = [];
    const r = await displayRate("XAA", "INR", (job) => later.push(job));
    expect(r).toEqual({ ok: true, rate: "80", date: "2026-10-01", stale: true });
    expect(fetchPairRate).not.toHaveBeenCalled();
    expect(later.length).toBe(1);
    await later[0]();
    expect(fetchPairRate).toHaveBeenCalledTimes(1);
  });

  it("no saved rate yet: nothing to show now (the screen leaves it out), fetched later", async () => {
    fetchPairRate.mockClear();
    const later: (() => Promise<unknown>)[] = [];
    const r = await displayRate("XBB", "INR", (job) => later.push(job));
    expect(r.ok).toBe(false);
    expect(fetchPairRate).not.toHaveBeenCalled();
    expect(later.length).toBe(1);
  });

  it("a fresh saved rate needs no refresh", async () => {
    await db.exchangeRate.create({ data: { base: "XBB", quote: "INR", rate: "2", date: "2026-10-16" } });
    const later: (() => Promise<unknown>)[] = [];
    const r = await displayRate("XBB", "INR", (job) => later.push(job));
    expect(r).toMatchObject({ ok: true, rate: "2" });
    expect(later.length).toBe(0);
  });
});
