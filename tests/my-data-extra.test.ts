import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { myDataCsv } from "@/lib/csv";
import { loadMyDataExtra } from "@/lib/my-data-extra";

// UISEQ-11: "Download all my data" also holds postcards, passport, collections and notification settings, text only,
// and the privacy page says exactly that.
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
const now = new Date("2026-11-12T10:00:00Z");

async function account(name: string, extra: Record<string, unknown> = {}) {
  const a = await db.account.create({ data: { email: `md-${name}-${stamp}@example.test`, name, ...extra } });
  accountIds.push(a.id);
  return a;
}

afterAll(async () => {
  await db.postcard.deleteMany({ where: { OR: [{ fromId: { in: accountIds } }, { toId: { in: accountIds } }] } });
  await db.block.deleteMany({ where: { OR: [{ blockerId: { in: accountIds } }, { blockedId: { in: accountIds } }] } });
  await db.collection.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("download my data: the extra parts", () => {
  it("has postcards, passport, collections and settings, and nothing private from other people", async () => {
    const me = await account("Mia", { homeCountry: "IN", places: JSON.stringify([{ c: "FR", city: "Paris" }]), passportChoiceAt: new Date(), notifyPrefs: '{"push":{"payments":false}}', collectPush: false });
    const friend = await account("Fran");
    const blocked = await account("Blocky");
    const organiser = await account("Olly");
    await db.block.create({ data: { blockerId: me.id, blockedId: blocked.id } });

    const card = (fromId: string, toId: string, message: string, opensAt: Date | null = null) =>
      db.postcard.create({ data: { fromId, toId, front: "print:beach", words: "Hello", message, place: "Goa", opensAt } });
    await card(me.id, friend.id, "sent one");
    await card(friend.id, me.id, "received open");
    await card(friend.id, me.id, "received sealed", new Date("2027-01-01T00:00:00Z"));
    await card(blocked.id, me.id, "from blocked");

    const trip = await db.group.create({
      data: { name: `MD trip ${stamp}`, type: "trip", inviteCode: `md-${stamp}`, tripStart: "2024-03-01", tripEnd: "2024-03-05", tripPlace: "Bangkok", tripCountry: "TH", members: { create: [{ name: "Mia", accountId: me.id, claimedAt: new Date(), notify: '{"off":true}' }] } },
      include: { members: true },
    });
    groupIds.push(trip.id);

    const own = await db.collection.create({ data: { code: `md-own-${stamp}`, title: "Farewell gift", accountId: me.id, organiser: "Mia", amount: 30000, entries: { create: [{ name: "A", status: "confirmed", phone: "+919999999999" }, { name: "B", status: "paid" }, { name: "C" }] } } });
    const other = await db.collection.create({ data: { code: `md-other-${stamp}`, title: "Class party", accountId: organiser.id, organiser: "Olly", entries: { create: [{ name: "Mia", accountId: me.id, status: "paid" }, { name: "Secret Person", phone: "+911111111111" }] } } });
    expect(own.id).not.toBe(other.id);

    const extra = await loadMyDataExtra(me, { [trip.id]: trip.members[0].id }, { [trip.id]: trip.name }, now, "UTC");

    expect(extra.postcards.map((c) => [c.sent, c.other, c.message]).sort()).toEqual([[false, "Fran", "received open"], [true, "Fran", "sent one"]]);
    expect(extra.passport.home).toBe("India");
    expect(extra.passport.countries.map((c) => c.name)).toEqual(expect.arrayContaining(["Thailand", "France"]));
    expect(extra.collections.find((c) => c.organiser)).toMatchObject({ title: "Farewell gift", people: 3, paid: 2, checked: 1 });
    expect(extra.collections.find((c) => !c.organiser)).toMatchObject({ title: "Class party", yours: "You said you paid" });
    expect(extra.settings.find((s) => s.setting === "Collection notifications")?.status).toBe("Off");
    expect(extra.settings.find((s) => s.setting === "Someone says they paid you")?.status).toBe("Off");
    expect(extra.settings.find((s) => s.setting === "Someone adds an expense")?.status).toBe("On");
    expect(extra.settings.find((s) => s.setting.startsWith("Phone notifications in MD trip"))?.status).toBe("Off");

    const csv = myDataCsv({ email: me.email, name: "Mia", createdAt: now }, [], now, "UTC", [], extra);
    expect(csv).toContain("Your postcards");
    expect(csv).toContain("Your passport");
    expect(csv).toContain("Collections you organise or are on");
    expect(csv).toContain("Your notification settings");
    // Not in the file: a sealed card, a card from someone you blocked, other people's emails, phone numbers and names on a list.
    for (const secret of ["received sealed", "from blocked", friend.email, organiser.email, "+919999999999", "+911111111111", "Secret Person"]) expect(csv).not.toContain(secret);
  });

  it("the privacy page names every part of the file", () => {
    const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");
    for (const word of ["postcards", "passport", "collections", "notification settings", "Anyone signed in", "current Loopin name", "the date", "postmark place"]) expect(privacy).toContain(word);
  });

  it("the account page shows the download to any signed-in user", () => {
    const page = readFileSync("src/app/account/page.tsx", "utf8");
    expect(page).toMatch(/\(account \|\| groups\.length > 0\) && \(\s*<a href="\/api\/my-data"/);
  });
});
