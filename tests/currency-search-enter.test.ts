import { describe, expect, it } from "vitest";
import { firstCurrencyMatch } from "@/lib/money";

// Enter in the currency search (inside Settings' one form) picks the first match; with nothing to pick it does
// nothing. The picker calls preventDefault on Enter either way, so the page is never submitted (see also the
// phone walkthrough in e2e/tests/11-groups.spec.ts).
describe("Enter in the currency search", () => {
  it("picks the first match: a name, a code, or an exact code ahead of partial ones", () => {
    expect(firstCurrencyMatch("baht")).toBe("THB");
    expect(firstCurrencyMatch("THB")).toBe("THB");
    expect(firstCurrencyMatch("  thb ")).toBe("THB");
  });
  it("nothing typed or nothing matching: nothing is picked", () => {
    expect(firstCurrencyMatch("")).toBeNull();
    expect(firstCurrencyMatch("   ")).toBeNull();
    expect(firstCurrencyMatch("qqqqzz")).toBeNull();
  });
});
