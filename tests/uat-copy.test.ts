import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { INVITE_EMAIL_HINT, invitedNotice } from "@/lib/invite-label";

// The walk-throughs (scripts/uat.ts and the e2e specs) look for words on screen. When the app's wording changes, an old
// expectation makes a step fail on every device. This keeps retired wording out, and ties the invite wording to its source.
const root = process.cwd();
const uat = readFileSync(join(root, "scripts", "uat.ts"), "utf8");
const specs = readdirSync(join(root, "e2e", "tests")).filter((f) => f.endsWith(".spec.ts")).map((f) => [f, readFileSync(join(root, "e2e", "tests", f), "utf8")] as const);

// Wording the app no longer shows. Only text people see; code comments about history are not in this list.
const RETIRED = ["emailed an invitation", "We’ve sent an invitation", "Sign up to join", "No take-backs", "As few payments as it takes", "Sign up to keep your groups", "sign up to join"];

describe("walk-throughs don't look for retired wording", () => {
  for (const s of RETIRED) {
    it(`uat.ts has no "${s}"`, () => {
      expect(uat).not.toContain(s);
    });
    it(`e2e specs have no "${s}"`, () => {
      expect(specs.filter(([, text]) => text.includes(s)).map(([f]) => f)).toEqual([]);
    });
  }

  it("old collection counts ('1 of 2 paid') are gone from the e2e specs", () => {
    expect(specs.filter(([, text]) => /\d of \d paid"/.test(text)).map(([f]) => f)).toEqual([]);
  });

  it("the invite steps use the current wording from src/lib/invite-label.ts", () => {
    // INVITE_EMAIL_HINT = "In the group now. We’ll email an invitation": the step looks for it with the full stop escaped.
    expect(uat).toContain(INVITE_EMAIL_HINT.replace(".", "\\."));
    const lead = invitedNotice("x@y.test").split(" to ")[0]; // "We’re emailing an invitation"
    expect(uat).toContain(`${lead} to`);
  });
});

describe("collection counts in the walk-through", () => {
  it("scripts/uat.ts never expects the old \"N of M paid\" wording", async () => {
    const { readFileSync } = await import("node:fs");
    const uat = readFileSync(new URL("../scripts/uat.ts", import.meta.url), "utf8");
    expect(uat).not.toMatch(/\d of \d paid\b/);
  });
});
