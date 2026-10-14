import { describe, expect, it } from "vitest";
import { fetchPairRate, fetchSupportedCodes } from "@/lib/rates";

// A pretend rate service, so tests don't depend on the internet.
function fakeFetch(status: number, body: unknown, calls: string[] = []) {
  return async (url: string) => {
    calls.push(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

describe("fetchPairRate", () => {
  it("reads a rate and its date (real response shape)", async () => {
    const calls: string[] = [];
    const r = await fetchPairRate("THB", "INR", {
      fetchImpl: fakeFetch(200, { date: "2026-10-14", base: "THB", quote: "INR", rate: 2.8367 }, calls),
    });
    expect(r).toEqual({ ok: true, rate: "2.8367", date: "2026-10-14" });
    expect(calls).toEqual(["https://api.frankfurter.dev/v2/rate/THB/INR"]);
  });

  it("says 'unsupported' without calling the service when a code isn't listed", async () => {
    const calls: string[] = [];
    const r = await fetchPairRate("AED", "INR", { fetchImpl: fakeFetch(200, {}, calls), supported: new Set(["INR", "THB"]) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported");
    expect(calls).toEqual([]);
  });

  it("handles 'no rate found' (404) by asking for a manual rate", async () => {
    const r = await fetchPairRate("VND", "INR", { fetchImpl: fakeFetch(404, { message: "No data found" }) });
    expect(r.ok === false && r.reason).toBe("unavailable");
  });

  it("handles the service being down", async () => {
    const r = await fetchPairRate("THB", "INR", { fetchImpl: fakeFetch(503, { message: "busy" }) });
    expect(r.ok === false && r.reason).toBe("offline");
  });

  it("handles no internet", async () => {
    const r = await fetchPairRate("THB", "INR", {
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    expect(r.ok === false && r.reason).toBe("offline");
  });

  it("rejects nonsense answers", async () => {
    const r = await fetchPairRate("THB", "INR", { fetchImpl: fakeFetch(200, { rate: -1, date: "x" }) });
    expect(r.ok).toBe(false);
  });
});

describe("fetchSupportedCodes", () => {
  it("reads the currency list", async () => {
    const codes = await fetchSupportedCodes(
      fakeFetch(200, [{ iso_code: "EUR", name: "Euro" }, { iso_code: "thb", name: "Thai Baht" }]),
    );
    expect(codes && [...codes]).toEqual(["EUR", "THB"]);
  });
  it("returns null when the list can't be fetched", async () => {
    expect(await fetchSupportedCodes(fakeFetch(500, {}))).toBeNull();
  });
});
