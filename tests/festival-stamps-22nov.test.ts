import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { openRareStamps, rareOpen, stampOrder } from "@/lib/postcards/catalog";

// Founder, 22 Nov: "Diwali stamp is not related anymore, it can come and go when relevant."
const at = (d: string) => new Date(`${d}T06:00:00Z`);

describe("festival stamps show only while they are on issue", () => {
  it("in late November (India) the Diwali stamp is not on issue and not in the stamp row", () => {
    expect(rareOpen("r:diwali", at("2026-11-22"))).toBe(false);
    const onIssue = openRareStamps(at("2026-11-22"), "IN");
    expect(onIssue).not.toContain("r:diwali");
    expect(stampOrder("t:love", "", "IN", onIssue)).not.toContain("r:diwali");
  });
  it("it comes back for Diwali week, for people in India", () => {
    expect(openRareStamps(at("2026-11-01"), "IN")).toContain("r:diwali");
    expect(openRareStamps(at("2026-11-01"), "US")).not.toContain("r:diwali");
  });
  it("sending an old Diwali card again starts with the usual stamp, and the server never sends a festival stamp out of season", () => {
    const page = readFileSync("src/app/postcards/new/page.tsx", "utf8");
    expect(page).toContain('again.stamp.startsWith("r:") && !(rareOpen(again.stamp, now) && rareFor(again.stamp, home)) ? stamp : again.stamp');
    const act = readFileSync("src/app/postcard-actions.ts", "utf8");
    expect(act).toContain('if (stamp.startsWith("r:") && !(rareOpen(stamp) && rareFor(stamp, home))) stamp = "t:airmail";');
    expect(act).not.toContain("keeps it if the original had it");
  });
});
