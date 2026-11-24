import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { myDataCsv } from "@/lib/csv";
import { loadMyDataExtra } from "@/lib/my-data-extra";
import { MY_DATA_CEILING, pageAll } from "@/lib/page-all";

// Batch 9 (L28): "Download my data" is complete (paged to the end, a ceiling of 20,000 per section that says so) and shows what you said you paid.
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const accountIds: string[] = [];
const now = new Date("2026-11-12T10:00:00Z");

async function account(name: string) {
  const a = await db.account.create({ data: { email: `b9d-${name}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}
afterAll(async () => {
  await db.postcard.deleteMany({ where: { OR: [{ fromId: { in: accountIds } }, { toId: { in: accountIds } }] } });
  await db.collection.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

const cards = (fromId: string, toId: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ fromId, toId, front: "print:beach", words: "Hi", message: `card ${i}`, place: "Goa", createdAt: new Date("2026-10-01T00:00:00Z") })); // all the same moment: the id decides the order

async function addCards(fromId: string, toId: string, n: number) {
  const all = cards(fromId, toId, n);
  for (let i = 0; i < all.length; i += 250) await db.postcard.createMany({ data: all.slice(i, i + 250) });
}

describe("page-all: reading to the end", () => {
  it("pages through every row, even when many share one createdAt, and says so only when the ceiling cut it", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `r${String(i).padStart(5, "0")}`, createdAt: new Date(i < 1200 ? 1000 : 2000) }));
    const fetchPage = async (after: { createdAt: Date; id: string } | null, take: number) =>
      rows.filter((r) => !after || r.createdAt > after.createdAt || (r.createdAt.getTime() === after.createdAt.getTime() && r.id > after.id)).slice(0, take);
    const all = await pageAll(fetchPage);
    expect(all.rows).toHaveLength(2500);
    expect(all.capped).toBe(false);
    expect(new Set(all.rows.map((r) => r.id)).size).toBe(2500); // none twice, none missed
    const cut = await pageAll(fetchPage, 2000);
    expect([cut.rows.length, cut.capped]).toEqual([2000, true]);
    const exact = await pageAll(fetchPage, 2500);
    expect([exact.rows.length, exact.capped]).toEqual([2500, false]); // exactly the ceiling is not "cut"
    expect(MY_DATA_CEILING).toBe(20000);
  });
});

describe("download my data: complete, and what you said you paid", () => {
  it("1,001 postcards are 1,001 rows (no silent cap at 1,000)", async () => {
    const me = await account("Mia");
    const friend = await account("Fran");
    await addCards(me.id, friend.id, 1001);
    const extra = await loadMyDataExtra(me, {}, {}, now, "UTC");
    expect(extra.postcards).toHaveLength(1001);
    expect(new Set(extra.postcards.map((c) => c.message)).size).toBe(1001);
    expect(extra.capped).toEqual([]);
    const csv = myDataCsv({ email: me.email, name: "Mia", createdAt: now }, [], now, "UTC", [], extra);
    expect(csv.split("\r\n").filter((l) => /^2026-10-01,Sent,Fran,/.test(l))).toHaveLength(1001);
    expect(csv).not.toContain("are in this file");
  });

  it("past the ceiling the section stops and ends with the line saying so (ceiling 3 here, 7 cards)", async () => {
    const me = await account("Cap");
    const friend = await account("Capfriend");
    await addCards(me.id, friend.id, 7);
    const extra = await loadMyDataExtra(me, {}, {}, now, "UTC", 3);
    expect(extra.postcards).toHaveLength(3);
    expect(extra.capped).toEqual([{ kind: "postcards", limit: 3 }]);
    const csv = myDataCsv({ email: me.email, name: "Cap", createdAt: now }, [], now, "UTC", [], extra);
    expect(csv).toContain("Only the first 3 postcards are in this file. Use Contact support for the rest.");
    // At the real ceiling the wording is "20,000".
    expect(myDataCsv(null, [], now, "UTC", [], { postcards: [], capped: [{ kind: "postcards", limit: MY_DATA_CEILING }] })).toContain("Only the first 20,000 postcards are in this file. Use Contact support for the rest.");
  });

  it("a variable-amount entry of 45000 (INR 450.00) shows in 'You said you paid'; a not-yet-paid one and the organiser's own rows are blank", async () => {
    const me = await account("Payer");
    const org = await account("Olly");
    await db.collection.create({ data: { code: `b9d-${stamp}`, title: "Any amount", accountId: org.id, organiser: "Olly", currency: "INR", amount: 0, entries: { create: [{ name: "Payer", accountId: me.id, status: "paid", amount: 45000 }] } } });
    await db.collection.create({ data: { code: `b9d2-${stamp}`, title: "Not yet", accountId: org.id, organiser: "Olly", currency: "INR", amount: 30000, entries: { create: [{ name: "Payer", accountId: me.id }] } } });
    await db.collection.create({ data: { code: `b9d3-${stamp}`, title: "Mine", accountId: me.id, organiser: "Payer", currency: "INR", amount: 30000, entries: { create: [{ name: "A", status: "confirmed", amount: 30000 }] } } });
    const extra = await loadMyDataExtra(me, {}, {}, now, "UTC");
    expect(extra.collections.find((c) => c.title === "Any amount")).toMatchObject({ yours: "You said you paid", yourAmount: 45000 });
    const csv = myDataCsv({ email: me.email, name: "Payer", createdAt: now }, [], now, "UTC", [], extra);
    const lines = csv.split("\r\n");
    expect(lines).toContain("Your part,Title,Currency,Per person,Pay by,Status,People listed,Say they've paid,Checked,Your own entry,You said you paid");
    expect(lines).toContain("On the list,Any amount,INR,,,Open,,,,You said you paid,450.00");
    expect(lines).toContain("On the list,Not yet,INR,300.00,,Open,,,,Not paid yet,");
    expect(lines).toContain("Organiser,Mine,INR,300.00,,Open,1,1,1,,");
  });

  it("L7: one ceiling across the collections you organise and the ones you are on (ceiling 3: 2 organised + 1 of 3 on-list), and the cap line says so", async () => {
    const me = await account("Both");
    const org = await account("Orgo");
    for (let i = 0; i < 2; i++) await db.collection.create({ data: { code: `b9d-own${i}-${stamp}`, title: `Own ${i}`, accountId: me.id, organiser: "Both", currency: "INR", amount: 30000, createdAt: new Date(2026, 0, 1 + i) } });
    for (let i = 0; i < 3; i++) await db.collection.create({ data: { code: `b9d-on${i}-${stamp}`, title: `On ${i}`, accountId: org.id, organiser: "Orgo", currency: "INR", amount: 30000, createdAt: new Date(2026, 1, 1 + i), entries: { create: [{ name: "Both", accountId: me.id, createdAt: new Date(2026, 1, 1 + i) }] } } });
    const extra = await loadMyDataExtra(me, {}, {}, now, "UTC", 3);
    expect(extra.collections.map((c) => c.title)).toEqual(["Own 0", "Own 1", "On 0"]);
    expect(extra.capped).toEqual([{ kind: "collections", limit: 3 }]);
    expect(myDataCsv(null, [], now, "UTC", [], extra)).toContain("Only the first 3 collections are in this file. Use Contact support for the rest.");
    // Exactly 5 fit exactly in a ceiling of 5: nothing cut, no line.
    const all = await loadMyDataExtra(me, {}, {}, now, "UTC", 5);
    expect(all.collections).toHaveLength(5);
    expect(all.capped).toEqual([]);
  });

  it("L8: cash the organiser recorded is not 'You said you paid' (blank), though a payer's own amount is", async () => {
    const me = await account("Cash");
    const org = await account("Orgi");
    await db.collection.create({
      data: {
        code: `b9d-cash-${stamp}`, title: "Cash one", accountId: org.id, organiser: "Orgi", currency: "INR", amount: 30000,
        entries: { create: [{ name: "Cash", accountId: me.id, status: "confirmed", amount: 30000, method: "cash", payerKey: "" }] },
      },
    });
    await db.collection.create({
      data: {
        code: `b9d-upi-${stamp}`, title: "Upi one", accountId: org.id, organiser: "Orgi", currency: "INR", amount: 30000,
        entries: { create: [{ name: "Cash", accountId: me.id, status: "confirmed", amount: 30000, method: "upi", payerKey: "phone-1" }] },
      },
    });
    const extra = await loadMyDataExtra(me, {}, {}, now, "UTC");
    expect(extra.collections.find((c) => c.title === "Cash one")).toMatchObject({ yours: "Paid and checked", yourAmount: 0 });
    expect(extra.collections.find((c) => c.title === "Upi one")).toMatchObject({ yourAmount: 30000 });
    const lines = myDataCsv({ email: me.email, name: "Cash", createdAt: now }, [], now, "UTC", [], extra).split("\r\n");
    expect(lines).toContain("On the list,Cash one,INR,300.00,,Open,,,,Paid and checked,");
    expect(lines).toContain("On the list,Upi one,INR,300.00,,Open,,,,Paid and checked,300.00");
  });
});

