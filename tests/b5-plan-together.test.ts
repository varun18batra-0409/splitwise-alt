import { describe, expect, it } from "vitest";
import { planCurrency } from "@/lib/region";

const hdr = (o: Record<string, string> = {}) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

// D3-7 and SB-13: "Plan together" uses the planner's own currency, not always rupees.
describe("B5 plan together currency", () => {
  it("home country GB gives GBP, even from a US phone", () => {
    expect(planCurrency("GB", hdr({ "x-vercel-ip-country": "US" }))).toBe("GBP");
  });
  it("no home country, IP country US gives USD", () => {
    expect(planCurrency("", hdr({ "x-vercel-ip-country": "US" }))).toBe("USD");
  });
  it("nothing known gives INR", () => {
    expect(planCurrency(null, hdr())).toBe("INR");
  });
});

// The group itself is made in wishes-db.ts planTogether: a supported code is used, anything else becomes INR.
describe("B5 plan together group", () => {
  it("source: an unsupported currency falls back to INR", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/wishes-db.ts", "utf8");
    expect(src).toContain('opts.currency && isSupportedCurrency(opts.currency) ? opts.currency : "INR"');
  });
});
