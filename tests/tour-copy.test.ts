import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The intro tour is seven slides, with the approved words. (Read as text: the tour is a screen, not a function.)
const src = readFileSync(path.resolve(__dirname, "..", "src", "components", "IntroTour.tsx"), "utf8");
const how = readFileSync(path.resolve(__dirname, "..", "src", "app", "how-it-works", "page.tsx"), "utf8");

describe("the 1-minute tour", () => {
  it("has exactly seven slides, in order", () => {
    const ids = [...src.matchAll(/^\s{6}id: "([a-z]+)",$/gm)].map((m) => m[1]);
    expect(ids).toEqual(["group", "add", "settle", "story", "postcard", "moment", "passport"]);
  });
  it("uses the approved titles and wording that works outside India", () => {
    for (const t of ["Make a group.", "Add what you paid.", "See who owes. Then settle.", "Every trip becomes a story."]) expect(src).toContain(`title: "${t}"`);
    expect(src).toContain("to the last paisa or cent");
    expect(src).toContain("Pay each other however you like, then record it. It counts straight away, and the other person is told. Loopin never moves money; it just keeps the score straight.");
    expect(src).not.toMatch(/no sign-up|splitwise/i);
  });
  it("has the Moments slide, in plain words with no emoji in its own words", () => {
    expect(src).toContain('title: "Keep the little moments."');
    expect(src).toContain("Only the people in it see them.");
  });
  it("keeps Skip, Back / Next and the sign-up line; the App and Home buttons are gone from the top bar", () => {
    for (const hook of ["Skip", "data-tour-back", "data-tour-next", "signInHref", "Create your first group"]) expect(src).toContain(hook);
    expect(src).not.toContain("GetAppButton");
    expect(src).not.toContain("HomeIcon");
  });
  it("How Loopin works still links to it", () => {
    expect(how).toContain('href="/welcome"');
    expect(how).toContain("1-minute tour");
  });
});
