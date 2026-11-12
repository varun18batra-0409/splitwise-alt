import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { countMyCollections, myCollections } from "@/lib/collect";

// N8: Home loads only the newest 20 collections, but "See all N collections" must say the real total.
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let accountId = "";
afterAll(async () => {
  await db.collection.deleteMany({ where: { accountId } });
  if (accountId) await db.account.deleteMany({ where: { id: accountId } });
});

describe("collection totals", () => {
  it("counts all 25 (not the 20 Home loads), and leaves out deleted ones", async () => {
    const a = await db.account.create({ data: { email: `ct-${stamp}@example.test`, name: "Org" } });
    accountId = a.id;
    await db.collection.createMany({ data: Array.from({ length: 26 }, (_, i) => ({ code: `ct-${i}-${stamp}`, title: `C${i}`, accountId: a.id, organiser: "Org", deletedAt: i === 0 ? new Date() : null })) });
    expect((await myCollections(a.id)).length).toBe(20);
    expect(await countMyCollections(a.id)).toBe(25);
  });

  it("the list shows the real total and Home passes it", () => {
    expect(readFileSync("src/components/CollectionsList.tsx", "utf8")).toContain("See all ${all} collections");
    expect(readFileSync("src/app/(home)/page.tsx", "utf8").match(/total=\{collectionsTotal\}/g)).toHaveLength(2);
  });
});
