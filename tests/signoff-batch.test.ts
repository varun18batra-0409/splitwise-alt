import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORIES, getCategory } from "@/lib/categories";

// Founder-approved mockups s1 to s6 (CB-3, VA2-3 / VD2-4 / VI2-36, VA1-48, CB-17 / VA2-37 / VD1-34).
const src = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

describe("VA1-48: a plain word under each playful category name", () => {
  it("every category has one, in plain words", () => {
    expect(Object.fromEntries(CATEGORIES.map((c) => [c.label, c.plain]))).toEqual({
      "Bites & Sips": "Food",
      "Wheels & Wings": "Travel",
      "Beds & Bunks": "Stay",
      "Bags & Bling": "Shopping",
      "Pantry Run": "Groceries",
      "Thrills & Tickets": "Activities",
      "Bills & Bits": "Bills",
      "Odds & Ends": "Other",
    });
    expect(getCategory("accommodation").plain).toBe("Stay"); // an old id still finds its word
    expect(getCategory("travel").plain).toBe("Travel");
  });
  it("the trip report shows it under the name, wrapped, never cut off", () => {
    const r = src("src/app/groups/[id]/report/page.tsx");
    expect(r).toContain("getCategory(c.id).plain");
    expect(r).toContain("data-category-plain");
    expect(r).toContain("break-words");
  });
});

describe("CB-3: a friend who sees the whole list shows as a locked tick", () => {
  const s = src("src/components/want/WishShareSheet.tsx");
  it("says 'Sees your whole list', disables the tick, and sends nothing for that friend", () => {
    expect(s).toContain("Sees your whole list");
    expect(s).toContain("checked disabled");
    expect(s).toContain("scope !== SHARE_ALL && wholeList.has(id)");
    expect(s).toContain("ticked.filter((id) => !lockedFor(id))");
    expect(s).toContain("A locked tick means");
  });
});

describe("VI2-36: sign-up heading and link", () => {
  const s = src("src/app/signin/page.tsx");
  it("has a Create an account link to sign-up mode, and the heading 'Create your account' only in that mode", () => {
    expect(s).toContain("Create an account");
    expect(s).toContain('mode: "signup"');
    expect(s).toContain("Create your account");
    expect(s).toContain('sp.mode === "signup"');
    expect(s).toContain("Continue to Loopin"); // sign-in keeps its own heading
  });
});

describe("VD2-4 / VI2-36: Terms and Privacy once, in the footer", () => {
  it("the start screen no longer has its own pair; the footer has FAQ, Privacy and Terms", () => {
    const home = src("src/app/(home)/page.tsx");
    expect(home).not.toContain('href="/terms"');
    expect(home).not.toContain('href="/privacy"');
    expect(home).toContain("<FooterLinks links={HOME_FOOTER_LINKS}");
    expect(src("src/components/FooterLinks.tsx")).toContain('href: "/terms"');
  });
});

describe("CB-17 / VA2-37 / VD1-34: taps are 44 px and small text is larger", () => {
  it("the collection page: no 32 px buttons, no 12 px grey-400 lines", () => {
    const c = src("src/app/c/[code]/page.tsx");
    expect(c).not.toContain("h-8 w-8");
    expect(c).not.toContain("text-xs text-gray-400");
    expect(c).toContain("inline-flex min-h-11 items-center rounded-full border border-fg/25 px-4 text-sm"); // Paid cash chip
    expect(c).toContain("h-11 w-11"); // reminder bubble and the cross
  });
  it("Everyone / Clear, the avatar initial, the passport tabs, badge captions and 'Show as table'", () => {
    expect(src("src/components/PotBuyIn.tsx").match(/min-h-11/g)?.length).toBe(2);
    expect(src("src/components/ui.tsx")).toContain("<span aria-hidden className={`flex h-9 w-9");
    const pc = src("src/components/PassportCompare.tsx");
    expect(pc).toContain("aria-pressed");
    expect(pc).not.toContain('role="tab"');
    expect(pc).toContain("min-h-11");
    const book = src("src/components/PassportBook.tsx");
    expect(book).not.toContain("text-[9px]");
    expect(book).not.toContain("block truncate text-[11px]"); // the badge line wraps, it is never cut off
    expect(src("src/components/Charts.tsx")).toContain("min-h-11");
  });
});
