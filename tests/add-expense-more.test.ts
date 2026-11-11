import { describe, expect, it } from "vitest";
import { shouldOpenMore } from "@/lib/add-expense-more";

describe("Add expense: “More” opens by itself when editing something that uses it", () => {
  it("closed for a new expense", () => expect(shouldOpenMore(undefined)).toBe(false));
  it("closed when there are no notes and one payer", () => expect(shouldOpenMore({ notes: "", multiPay: false })).toBe(false));
  it("closed for notes that are only spaces", () => expect(shouldOpenMore({ notes: "   ", multiPay: false })).toBe(false));
  it("open when there are notes", () => expect(shouldOpenMore({ notes: "Sunset table", multiPay: false })).toBe(true));
  it("open when several people paid", () => expect(shouldOpenMore({ notes: "", multiPay: true })).toBe(true));
});
