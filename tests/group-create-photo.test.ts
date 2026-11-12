import { afterAll, describe, expect, it, vi } from "vitest";

// SEQ-ROOT-01: making a group with your own photo is ONE create (the group and its photo together). If the photo's write fails
// there is no group at all, the stored file is queued for deletion, and trying again gives exactly one group.
const fake = vi.hoisted(() => ({ failNext: false }));
vi.mock("@/lib/photo-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/photo-store")>();
  return {
    ...real,
    storePhoto: async (...args: Parameters<typeof real.storePhoto>) => {
      if (fake.failNext) {
        fake.failNext = false;
        // A photo the database refuses (not bytes): the create fails after the "file" was stored.
        return { blobKey: `group/fail-${stamp}`, data: "not-bytes" as unknown as Uint8Array<ArrayBuffer> };
      }
      return real.storePhoto(...args);
    },
  };
});

const { db } = await import("@/lib/db");
const { createGroupFor } = await import("@/lib/group-setup");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xda, 0x00, 0x04, 0x01, 0x02, ...new Array(200).fill(7), 0xff, 0xd9]);
const name = `Photo trip ${stamp}`;
let accountId = "";

afterAll(async () => {
  await db.blobTrash.deleteMany({ where: { key: { contains: stamp } } });
  await db.group.deleteMany({ where: { name } });
  if (accountId) await db.account.deleteMany({ where: { id: accountId } });
});

describe("making a group with a photo", () => {
  it("a failed photo write leaves no group and queues the file; the retry gives one group with its photo", async () => {
    const me = await db.account.create({ data: { email: `gcp-${stamp}@example.test`, name: "Maker" } });
    accountId = me.id;
    const input = { type: "trip", name, yourName: "Maker", currency: "INR", cover: "own", photo: jpeg };

    fake.failNext = true;
    await expect(createGroupFor(me, input)).rejects.toBeDefined();
    expect(await db.group.count({ where: { name } })).toBe(0);
    expect(await db.member.count({ where: { accountId: me.id } })).toBe(0);
    expect(await db.blobTrash.count({ where: { key: `group/fail-${stamp}` } })).toBe(1);

    const g = await createGroupFor(me, input);
    expect(await db.group.count({ where: { name } })).toBe(1);
    const photo = await db.groupPhoto.findUniqueOrThrow({ where: { groupId: g.id } });
    expect(photo.createdById).toBe(g.members[0].id); // the photo names the creator's own member row
    const row = await db.group.findUniqueOrThrow({ where: { id: g.id } });
    expect(row.cover).toBe("own");
    expect(row.coverAt).not.toBeNull();
  });
});
