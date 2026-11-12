import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Small review follow-ups that can only be checked in the source (routes need a signed-in phone).
describe("review follow-ups", () => {
  it("N10: the square picture counts people from the scoped list, as Wrapped does", () => {
    const src = readFileSync("src/app/groups/[id]/square-image/route.tsx", "utf8");
    expect(src).toContain("const people = data.people.filter((m) => !m.leftAt)");
    expect(src).not.toContain("const people = group.members.filter");
  });

  it("the data-upgrade header no longer says it deletes old groups", () => {
    const head = readFileSync("prisma/upgrade-data.mjs", "utf8").split("\n").slice(0, 8).join("\n");
    expect(head).toContain("never deletes groups");
    expect(head).not.toMatch(/The only things it deletes: groups/);
  });
});
