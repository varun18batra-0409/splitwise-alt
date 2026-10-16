import { describe, expect, it } from "vitest";
import { cleanEntries, routeShape } from "@/lib/speed";

describe("speed numbers keep no ids or personal data", () => {
  it("replaces ids, emails and numbers in the path", () => {
    expect(routeShape("/groups/cmh1abcdefghijklmnopqrst/expenses/cmh2abcdefghijklmnopqrst/edit?x=1")).toBe("/groups/:id/expenses/:id/edit");
    expect(routeShape("/join/abc123?e=asha@example.com")).toBe("/join/:id"); // invite codes aren't kept either
    expect(routeShape("/u/asha@example.com")).toBe("/u/:id");
    expect(routeShape("/")).toBe("/");
  });
  it("drops anything that isn't a sensible timing", () => {
    expect(cleanEntries([{ k: "nav", r: "/", ms: 120.4 }, { k: "hack", r: "/", ms: 1 }, { k: "nav", r: "/", ms: -1 }, { k: "nav", r: "/", ms: 99_999 }])).toEqual([{ k: "nav", r: "/", ms: 120 }]);
    expect(cleanEntries("nope")).toEqual([]);
  });
});
