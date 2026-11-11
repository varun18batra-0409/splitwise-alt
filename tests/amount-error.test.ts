import { describe, expect, it } from "vitest";
import { amountError, parseAmount } from "@/lib/money";

// Every refused amount gets a message that names the real reason.
describe("amountError explains why parseAmount refused", () => {
  it("a decimal comma in yen says 'no decimals' (100,5 is 100.5)", () => {
    expect(parseAmount("100,5", "JPY")).toBeNull();
    expect(amountError("100,5", "JPY")).toBe("JPY amounts are whole numbers: no decimals.");
  });
  it("a thousands comma in yen is fine", () => {
    expect(parseAmount("1,500", "JPY")).toBe(1500);
  });
  it("three decimals in rupees", () => {
    expect(parseAmount("10,505", "INR")).toBe(1050500); // thousands comma
    expect(parseAmount("10.505", "INR")).toBeNull();
    expect(amountError("10.505", "INR")).toBe("Use no more than 2 decimal places.");
  });
  it("zero and words", () => {
    expect(amountError("0", "INR")).toBe("The amount has to be more than zero.");
    expect(amountError("abc", "INR")).toMatch(/Enter the amount as a number/);
  });
  it("12,50 in euros is accepted as 12.50", () => {
    expect(parseAmount("12,50", "EUR")).toBe(1250);
  });
});
