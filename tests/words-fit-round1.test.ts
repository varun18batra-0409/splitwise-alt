import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compactName, keepAmp } from "../src/lib/format";
import { glueAmounts } from "../src/lib/money";

const src = (p: string) => readFileSync(p, "utf8");

describe("words fit: small display helpers", () => {
  it("compactName: first name in tight places, full name when two members share a first name", () => {
    expect(compactName("Bhagyalakshmi Venkataraman", ["Varun", "Bhagyalakshmi Venkataraman", "Asha"])).toBe("Bhagyalakshmi");
    expect(compactName("Priya Shah", ["Priya Shah", "Priya Kapoor", "Asha"])).toBe("Priya Shah");
    expect(compactName("priya", ["Priya Shah", "priya"])).toBe("priya"); // same first name, any case: told apart by the full name
    expect(compactName("Asha", ["Asha"])).toBe("Asha");
  });
  it("glueAmounts: a currency code stays with its number (non-breaking space), nothing else changes", () => {
    expect(glueAmounts("Thai baht part: you owe THB 5,099.17")).toBe("Thai baht part: you owe THB 5,099.17");
    expect(glueAmounts("you’re owed USD 12.50 and EUR 3")).toBe("you’re owed USD 12.50 and EUR 3");
    expect(glueAmounts("owes ₹10,895.79")).toBe("owes ₹10,895.79");
    expect(glueAmounts("THB expenses")).toBe("THB expenses"); // a code with no number after it
  });
  it("keepAmp: '&' stays with the next word; the stored name is untouched", () => {
    expect(keepAmp("Bills & Bits")).toBe("Bills & Bits");
    expect(keepAmp("Thrills & Tickets")).toBe("Thrills & Tickets");
    expect(keepAmp("Pantry Run")).toBe("Pantry Run");
  });
});

describe("words fit: narrow-phone rules are in place and 390+ is untouched", () => {
  it("flat Bills: amount and pill go on their own line under the name below 390px", () => {
    const b = src("src/app/groups/[id]/_components/BillsTab.tsx");
    expect(b).toContain("max-[389px]:flex-wrap");
    expect(b).toContain("max-[389px]:basis-full");
    expect(b).toContain("max-[389px]:min-w-[120px]");
    expect(b).not.toContain("break-words font-display"); // never breaks inside a word
  });
  it("balances: amount under the name on narrow phones, name wraps instead of being cut", () => {
    const b = src("src/app/groups/[id]/_components/BalancesTab.tsx");
    expect(b).toContain("max-[389px]:basis-full");
    expect(b).not.toContain("block truncate font-medium");
    expect(b).toContain("glueAmounts");
  });
  it("the big story headline never breaks inside a word and shrinks on narrow phones", () => {
    const s = src("src/components/Stories.tsx");
    expect(s).toContain("[overflow-wrap:normal]");
    expect(s).toContain("max-[389px]:text-[length:var(--fsn)]");
  });
  it("postcard editor: narrow top bar and panels that grow", () => {
    expect(src("src/app/postcards/new/editor/TopBar.tsx")).toContain("max-[359px]:px-2");
    expect(src("src/app/postcards/new/editor/shared.tsx")).toContain("max-[359px]:max-h-none");
  });
  it("text balancing uses text-wrap-style only (it must not undo nowrap or truncate)", () => {
    const css = src("src/app/globals.css");
    expect(css).toContain("text-wrap-style: balance");
    expect(css).not.toMatch(/^\s*text-wrap:/m);
  });
  it("the screenshot script signs back in and saves 4000px review parts", () => {
    const s = src("scripts/screenshots.ts");
    expect(s).toContain("async function signBackIn()");
    expect(s).toContain("REVIEW_PART_PX = 4000");
    expect(s).toContain("REVIEW_OVER_PX = 8000");
  });
});
