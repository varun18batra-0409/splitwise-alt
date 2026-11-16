import { describe, expect, it } from "vitest";
// @ts-expect-error plain script (no types); its pure part is tested here
import { buildReport } from "../scripts/unknown-places.mjs";

// The export is only a pure function here (fake rows): the repo is PUBLIC, so names must never leave without a private repo.
const rows = [
  { place: "lisbon", groups: 5 },
  { place: "porto", groups: 3 },
  { place: "faro", groups: 2 }, // only 2 accounts: never listed
  { place: "room 12", groups: 9 }, // not a clean place name: never listed
  { place: "azores", groups: 3 },
];

describe("unknown places report", () => {
  it("without REPORTS_REPO or REPORTS_TOKEN it writes only a count, no names, no file", () => {
    for (const env of [{}, { REPORTS_REPO: "me/reports" }, { REPORTS_TOKEN: "t" }, { REPORTS_REPO: "", REPORTS_TOKEN: "" }]) {
      const r = buildReport(rows, env, "2026-11-16");
      expect(r.json).toBeNull();
      expect(r.count).toBe(3);
      expect(r.summary).toContain("3 places waiting, report repo not set up");
      for (const name of ["lisbon", "porto", "azores", "faro", "room"]) expect(r.summary.toLowerCase()).not.toContain(name);
    }
  });
  it("with both set, the list is for the private repo only; the summary still has no names", () => {
    const r = buildReport(rows, { REPORTS_REPO: "me/reports", REPORTS_TOKEN: "t" }, "2026-11-16");
    expect(JSON.parse(r.json!)).toEqual({ updated: "2026-11-16", places: [{ place: "lisbon", accounts: 5 }, { place: "azores", accounts: 3 }, { place: "porto", accounts: 3 }] });
    expect(r.summary).toContain("3 places waiting");
    for (const name of ["lisbon", "porto", "azores"]) expect(r.summary.toLowerCase()).not.toContain(name);
    expect(r.json).not.toContain("faro");
  });
  it("lists at most 200", () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ place: `place${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`.replace(/\d/g, ""), groups: 3 }));
    expect(buildReport(many, { REPORTS_REPO: "a/b", REPORTS_TOKEN: "t" }).count).toBe(200);
  });
});
