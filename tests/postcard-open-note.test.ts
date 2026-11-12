import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { noteOpenedPostcards } from "@/lib/postcards/open-db";

// SEQ-FEAT-06: a sealed postcard is claimed (openNoted false -> true, only if still false) and its Alerts note is written in the
// same transaction. So there is never a postcard marked as told without its note, and a second run tells nobody twice.
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const accountIds: string[] = [];

async function account(name: string) {
  const a = await db.account.create({ data: { email: `po-${name}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}
const card = (fromId: string, toId: string, extra: { openNoted?: boolean; opensAt?: Date } = {}) =>
  db.postcard.create({ data: { fromId, toId, front: "print:beach", message: "See you soon", opensAt: new Date(Date.now() - 60_000), ...extra } });

afterAll(async () => {
  await db.postcard.deleteMany({ where: { OR: [{ fromId: { in: accountIds } }, { toId: { in: accountIds } }] } });
  await db.block.deleteMany({ where: { OR: [{ blockerId: { in: accountIds } }, { blockedId: { in: accountIds } }] } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("noteOpenedPostcards", () => {
  it("claims the postcard and writes one note together; running again tells nobody twice", async () => {
    const from = await account("Sender");
    const to = await account("Reader");
    const p = await card(from.id, to.id);
    const first = await noteOpenedPostcards();
    expect(first.sent).toBeGreaterThanOrEqual(1);
    expect((await db.postcard.findUniqueOrThrow({ where: { id: p.id } })).openNoted).toBe(true);
    const notes = await db.accountNote.findMany({ where: { accountId: to.id, kind: "postcard" } });
    expect(notes).toHaveLength(1);
    expect(notes[0].url).toBe(`/postcards/${p.id}`);
    expect(notes[0].body).toBe("Sender wrote it for today.");
    await noteOpenedPostcards();
    expect(await db.accountNote.count({ where: { accountId: to.id, kind: "postcard" } })).toBe(1);
  });

  it("one already told (or still sealed) is left alone", async () => {
    const from = await account("Sender2");
    const to = await account("Reader2");
    await card(from.id, to.id, { openNoted: true });
    await card(from.id, to.id, { opensAt: new Date(Date.now() + 86_400_000) });
    await noteOpenedPostcards();
    expect(await db.accountNote.count({ where: { accountId: to.id } })).toBe(0);
  });

  it("someone who blocked the sender is marked as done but gets no note", async () => {
    const from = await account("Sender3");
    const to = await account("Reader3");
    await db.block.create({ data: { blockerId: to.id, blockedId: from.id } });
    const p = await card(from.id, to.id);
    await noteOpenedPostcards();
    expect((await db.postcard.findUniqueOrThrow({ where: { id: p.id } })).openNoted).toBe(true);
    expect(await db.accountNote.count({ where: { accountId: to.id } })).toBe(0);
  });

  it("more than 100 due cards are all handled (in batches of 100), each with its note", async () => {
    const from = await account("Sender4");
    const to = await account("Reader4");
    await db.postcard.createMany({ data: Array.from({ length: 120 }, (_, i) => ({ fromId: from.id, toId: to.id, front: "print:beach", message: `card ${i}`, opensAt: new Date(Date.now() - 60_000) })) });
    const r = await noteOpenedPostcards();
    expect(r.sent).toBeGreaterThanOrEqual(120);
    expect(await db.postcard.count({ where: { fromId: from.id, openNoted: false } })).toBe(0);
    expect(await db.accountNote.count({ where: { accountId: to.id, kind: "postcard" } })).toBe(120);
  });
});
