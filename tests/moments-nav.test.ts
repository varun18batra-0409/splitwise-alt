import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The tab bar is hidden on every Our moments screen (the floating "Add your moment" button is the one bar), and stays on the group page.
const nav = readFileSync("src/components/BottomNav.tsx", "utf8");
const hide = /const HIDE = \[(.*)\];/.exec(nav)![1];
const res = hide.split(/,\s*(?=\/)/).map((r) => new RegExp(r.trim().slice(1, r.trim().lastIndexOf("/")).replace(/\\\//g, "/")));

describe("the tab bar and Our moments", () => {
  it.each(["/groups/g1/moments", "/groups/g1/moments/new", "/groups/g1/moments/m1"])("%s hides it", (path) => {
    expect(res.some((re) => re.test(path))).toBe(true);
  });
  it("the group page and its other screens keep it", () => {
    for (const path of ["/groups/g1", "/groups/g1/settle", "/groups/g1/momentsx", "/groups/g1/people"]) expect(res.some((re) => re.test(path)), path).toBe(false);
  });
});

describe("moment photos never go through next/image", () => {
  it("only plain <img> tags show a moment's photo, and the story viewer skips the image service for /api/ photos", () => {
    for (const f of [
      "src/app/groups/[id]/moments/_components/MomentBig.tsx",
      "src/app/groups/[id]/moments/page.tsx",
      "src/app/groups/[id]/moments/new/MomentForm.tsx",
      "src/app/groups/[id]/_components/MomentsStrip.tsx",
      "src/app/groups/[id]/_components/MemoriesTab.tsx",
      "src/components/MomentsFeed.tsx",
      "src/app/stats/reports/page.tsx",
    ]) expect(readFileSync(f, "utf8"), f).not.toMatch(/from "next\/image"/);
    const stories = readFileSync("src/components/Stories.tsx", "utf8");
    expect(stories).toContain('src.startsWith("/api/")');
    expect((stories.match(/unoptimized=\{isOwnApi\(/g) ?? []).length).toBe(2);
  });
});
