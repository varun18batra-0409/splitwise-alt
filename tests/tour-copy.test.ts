import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The intro tour is six slides, with the approved words. (Read as text: the tour is a screen, not a function.)
const src = readFileSync(path.resolve(__dirname, "..", "src", "components", "IntroTour.tsx"), "utf8");
const how = readFileSync(path.resolve(__dirname, "..", "src", "app", "how-it-works", "page.tsx"), "utf8");

describe("the 1-minute tour", () => {
  it("has exactly six slides, in order", () => {
    const ids = [...src.matchAll(/^\s{6}id: "([a-z]+)",$/gm)].map((m) => m[1]);
    expect(ids).toEqual(["group", "add", "settle", "story", "postcard", "passport"]);
  });
  it("uses the approved titles and wording that works outside India", () => {
    for (const t of ["Make a group.", "Add what you paid.", "See who owes. Then settle.", "Every trip becomes a story."]) expect(src).toContain(`title: "${t}"`);
    expect(src).toContain("to the last paisa or cent");
    expect(src).toContain("Pay each other however you like.");
    expect(src).not.toMatch(/no sign-up|splitwise/i);
  });
  it("keeps the App button, Skip, Back / Next and the sign-up line", () => {
    for (const hook of ["GetAppButton", "Skip", "data-tour-back", "data-tour-next", "signInHref", "Create your first group"]) expect(src).toContain(hook);
  });
  it("How Loopin works still links to it", () => {
    expect(how).toContain('href="/welcome"');
    expect(how).toContain("1-minute tour");
  });
});
