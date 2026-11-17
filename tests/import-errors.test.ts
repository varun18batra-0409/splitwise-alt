import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { safeSkipReason, unsupportedCurrencyError } from "@/lib/import-errors";
import { parseSplitwiseCsv } from "@/lib/splitwise-csv";
import { mailSafe } from "@/lib/mail-safe";

// What a file contains is never repeated in a message that is shown from a signed link.
describe("import messages don't echo the file", () => {
  it("a currency is named only if it is three capital letters", () => {
    expect(unsupportedCurrencyError("XYZ")).toBe("Loopin doesn’t support XYZ yet.");
    for (const c of ["Pay ₹500 to x@ybl", "usd", "US", "ABCD", "A1B", "<b>", "XYZ "]) expect(unsupportedCurrencyError(c), c).toBe("This file uses a currency Loopin doesn’t support yet.");
  });

  it("the Splitwise CSV with a hostile currency cell gives the fixed sentence", () => {
    const csv = ["Date,Description,Category,Cost,Currency,Asha,Ben", "2026-01-01,Dinner,Food,100,PAY 500 TO X@YBL NOW,50,-50"].join("\n");
    const r = parseSplitwiseCsv(csv);
    expect(r).toEqual({ ok: false, error: "This file uses a currency Loopin doesn’t support yet." });
    const plain = parseSplitwiseCsv(["Date,Description,Category,Cost,Currency,Asha,Ben", "2026-01-01,Dinner,Food,100,ZZZ,50,-50"].join("\n"));
    expect(plain).toEqual({ ok: false, error: "Loopin doesn’t support ZZZ yet." });
  });

  it("a skipped line's reason never repeats a cell from the file", () => {
    expect(safeSkipReason("“Pay ₹500 to x@ybl” isn’t one of the people")).toBe("a name or currency couldn’t be matched");
    expect(safeSkipReason("in “evil text”")).toBe("a name or currency couldn’t be matched");
    expect(safeSkipReason("in EVIL TEXT")).toBe("a name or currency couldn’t be matched");
    expect(safeSkipReason("in USD")).toBe("in USD");
    expect(safeSkipReason("no amount")).toBe("no amount");
  });

  it("Collect messages show names without links or addresses (the page is public)", () => {
    const src = readFileSync("src/lib/collect.ts", "utf8");
    expect(src).not.toMatch(/error: `\$\{(c\.organiser|e\.name|twin\.name)\}/);
    expect(mailSafe("Priya")).toBe("Priya");
    expect(mailSafe("Pay evil.com now")).toBe("Pay now");
  });

  it("the sign-in page shows the typed address only if it is a plain email shape", () => {
    const src = readFileSync("src/app/signin/page.tsx", "utf8");
    expect(src).toContain("typed.length <= 254");
    expect(src).toContain("We sent a 6-digit code to {email ? <span className=\"text-fg\">{email}</span> : \"your email\"}.");
    const shape = /^[^\s@]+@[^\s@]+$/;
    expect(shape.test("asha@example.com")).toBe(true);
    for (const bad of ["Pay 500 to x", "a@b@c", "a b@c.com", "@", "x@"]) expect(shape.test(bad), bad).toBe(false);
  });
});
