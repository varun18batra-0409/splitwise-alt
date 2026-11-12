import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Photo files that must be deleted are written to a to-delete list (BlobTrash) and only
// forgotten once storage confirms they're gone. Also: moving an old database photo to file
// storage can never write over a photo uploaded while it was being copied.

const mocks = vi.hoisted(() => ({
  put: vi.fn(async (..._args: unknown[]) => ({ url: "https://blob.example/x" })),
  del: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock("@vercel/blob", () => ({ put: mocks.put, del: mocks.del, get: vi.fn(async () => null) }));

const { db } = await import("@/lib/db");
const { flushPhotoDeletes, movePhotosToBlob, queuePhotoDeletes, removePhotos, replaceGroupPhoto, trashDelay } = await import("@/lib/photo-store");
const { eraseGroups } = await import("@/lib/purge");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const HOUR = 3_600_000;
const saved = { VERCEL: process.env.VERCEL, BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN };
const groupIds: string[] = [];

beforeAll(() => {
  process.env.VERCEL = "1";
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
});
afterAll(async () => {
  if (saved.VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = saved.VERCEL;
  if (saved.BLOB_READ_WRITE_TOKEN === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = saved.BLOB_READ_WRITE_TOKEN;
  await db.blobTrash.deleteMany({});
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});
beforeEach(async () => {
  mocks.put.mockClear();
  mocks.del.mockReset();
  mocks.del.mockImplementation(async () => undefined);
  await db.blobTrash.deleteMany({});
});

const keysDeleted = () => mocks.del.mock.calls.flatMap((c) => (Array.isArray(c[0]) ? (c[0] as string[]) : [c[0] as string]));

async function makeGroup(tag: string) {
  const g = await db.group.create({ data: { name: `${tag} ${stamp}`, inviteCode: `bt-${tag}-${stamp}`, members: { create: [{ name: "Ann" }] } } });
  groupIds.push(g.id);
  return g;
}

describe("the to-delete list", () => {
  it("waiting time: 2 hours after the first failure, then 4, 8 … never more than 48", () => {
    expect([1, 2, 3, 5, 6, 7, 20].map((t) => trashDelay(t) / HOUR)).toEqual([2, 4, 8, 32, 48, 48, 48]);
  });

  it("a failed delete stays on the list (tries 1, tried again in 2 hours); the next try that works removes it", async () => {
    const key = `receipt/a-${stamp}`;
    await queuePhotoDeletes(db, [key, key, "", null]); // twice the same, and empty ones: one row
    expect(await db.blobTrash.count()).toBe(1);

    mocks.del.mockRejectedValueOnce(new Error("storage is down"));
    const t0 = new Date();
    expect(await flushPhotoDeletes(50, t0)).toEqual({ deleted: 0, failed: 1, kept: 0 });
    const row = (await db.blobTrash.findUnique({ where: { key } }))!;
    expect(row.tries).toBe(1);
    expect(row.lastError).toContain("storage is down");
    expect(row.nextAt.getTime()).toBe(t0.getTime() + 2 * HOUR);

    // Not due yet: storage isn't asked again.
    mocks.del.mockClear();
    expect(await flushPhotoDeletes(50, new Date(t0.getTime() + HOUR))).toEqual({ deleted: 0, failed: 0, kept: 0 });
    expect(mocks.del).not.toHaveBeenCalled();

    // Due, and storage answers: gone from the list.
    expect(await flushPhotoDeletes(50, new Date(t0.getTime() + 3 * HOUR))).toEqual({ deleted: 1, failed: 0, kept: 0 });
    expect(keysDeleted()).toEqual([key]);
    expect(await db.blobTrash.count()).toBe(0);
  });

  it("storage saying 'not found' counts as deleted", async () => {
    const key = `receipt/nf-${stamp}`;
    await queuePhotoDeletes(db, [key]);
    const err = Object.assign(new Error("The requested blob does not exist"), { name: "BlobNotFoundError" });
    mocks.del.mockRejectedValueOnce(err);
    expect((await flushPhotoDeletes()).deleted).toBe(1);
    expect(await db.blobTrash.count()).toBe(0);
  });

  it("with file storage not connected the keys just wait", async () => {
    const key = `receipt/off-${stamp}`;
    await queuePhotoDeletes(db, [key]);
    const was = process.env.VERCEL;
    delete process.env.VERCEL;
    try {
      expect(await flushPhotoDeletes()).toEqual({ deleted: 0, failed: 0, kept: 0 });
      expect(mocks.del).not.toHaveBeenCalled();
      expect(await db.blobTrash.count()).toBe(1);
    } finally {
      process.env.VERCEL = was;
    }
  });

  it("removePhotos queues first: if the delete fails the key is still there", async () => {
    const key = `group/rp-${stamp}`;
    mocks.del.mockRejectedValueOnce(new Error("nope"));
    await removePhotos([key, undefined]);
    expect((await db.blobTrash.findUnique({ where: { key } }))?.tries).toBe(1);
  });

  it("a key some photo row still uses is never passed to storage, and is dropped from the list", async () => {
    const g = await makeGroup("used");
    const usedKey = `group/used-${stamp}`;
    const receiptKey = `receipt/used-${stamp}`;
    const freeKey = `receipt/free-${stamp}`;
    await db.groupPhoto.create({ data: { groupId: g.id, data: new Uint8Array(), blobKey: usedKey } });
    await db.receipt.create({ data: { groupId: g.id, data: new Uint8Array(), blobKey: receiptKey } });
    await queuePhotoDeletes(db, [usedKey, receiptKey, freeKey]);

    expect(await flushPhotoDeletes()).toEqual({ deleted: 1, failed: 0, kept: 2 });
    expect(keysDeleted()).toEqual([freeKey]);
    expect(await db.blobTrash.count()).toBe(0);
  });
});

describe("erasing a group", () => {
  it("with storage failing, the list holds exactly that group's photo and bill photo keys", async () => {
    const g = await makeGroup("erase");
    const other = await makeGroup("keep");
    const keys = { photo: `group/e-${stamp}`, receipt: `receipt/e-${stamp}`, other: `group/other-${stamp}` };
    await db.groupPhoto.create({ data: { groupId: g.id, data: new Uint8Array(), blobKey: keys.photo } });
    await db.receipt.create({ data: { groupId: g.id, data: new Uint8Array(), blobKey: keys.receipt } });
    await db.receipt.create({ data: { groupId: g.id, data: new Uint8Array([1, 2, 3]), blobKey: "" } }); // kept in the database: no file
    await db.groupPhoto.create({ data: { groupId: other.id, data: new Uint8Array(), blobKey: keys.other } });

    mocks.del.mockRejectedValue(new Error("storage is down"));
    await eraseGroups([g.id]);

    expect(await db.group.findUnique({ where: { id: g.id } })).toBeNull();
    const rows = await db.blobTrash.findMany({ orderBy: { key: "asc" } });
    expect(rows.map((r) => r.key)).toEqual([keys.photo, keys.receipt].sort());
    expect(rows.every((r) => r.tries === 1)).toBe(true);
    // The other group's file is untouched.
    expect(await db.groupPhoto.count({ where: { blobKey: keys.other } })).toBe(1);

    // Storage comes back: the next run clears the list.
    mocks.del.mockReset();
    mocks.del.mockImplementation(async () => undefined);
    await flushPhotoDeletes(50, new Date(Date.now() + 3 * HOUR));
    expect(await db.blobTrash.count()).toBe(0);
  });
});

describe("moving an old photo to file storage", () => {
  // The photo's bytes are unique to each test, so the fake `put` can tell which one it is copying.
  const same = (body: unknown, bytes: Uint8Array) => Buffer.isBuffer(body) && body.equals(Buffer.from(bytes));
  const putKeyFor = (bytes: Uint8Array) => {
    const call = mocks.put.mock.calls.find((c) => same(c[1], bytes));
    return call ? String(call[0]) : "";
  };

  it("a group photo uploaded while the old one was being copied is not written over; the copy goes on the list", async () => {
    const g = await makeGroup("move-group");
    const mine = new Uint8Array([9, 8, 7, 6, 5, Date.now() % 251, Math.floor(Math.random() * 251)]);
    const t0 = new Date("2026-11-01T10:00:00Z");
    const t1 = new Date("2026-11-01T10:01:00Z");
    await db.groupPhoto.create({ data: { groupId: g.id, data: mine, blobKey: "", updatedAt: t0 } });
    mocks.put.mockImplementation(async (...args: unknown[]) => {
      if (same(args[1], mine)) {
        // Someone uploads a newer photo right now.
        await db.groupPhoto.update({ where: { groupId: g.id }, data: { data: new Uint8Array(), blobKey: "group/new", updatedAt: t1 } });
      }
      return { url: "https://blob.example/x" };
    });
    try {
      await movePhotosToBlob(500);
    } finally {
      mocks.put.mockImplementation(async () => ({ url: "https://blob.example/x" }));
    }
    const row = (await db.groupPhoto.findUnique({ where: { groupId: g.id } }))!;
    expect(row.blobKey).toBe("group/new");
    expect(row.updatedAt.getTime()).toBe(t1.getTime());
    expect(row.data.length).toBe(0);
    const movedKey = putKeyFor(mine);
    expect(movedKey).toMatch(/^group\//);
    expect((await db.blobTrash.findMany()).map((r) => r.key)).toContain(movedKey);
    expect(await db.blobTrash.findUnique({ where: { key: "group/new" } })).toBeNull();
  });

  it("when nothing changed meanwhile the photo moves and nothing is queued for deleting", async () => {
    const g = await makeGroup("move-plain");
    const mine = new Uint8Array([1, 1, 2, 3, 5, 8, Date.now() % 251, Math.floor(Math.random() * 251)]);
    await db.groupPhoto.create({ data: { groupId: g.id, data: mine, blobKey: "", updatedAt: new Date("2026-11-01T10:00:00Z") } });
    await movePhotosToBlob(500);
    const row = (await db.groupPhoto.findUnique({ where: { groupId: g.id } }))!;
    const key = putKeyFor(mine);
    expect(key).not.toBe("");
    expect(row.blobKey).toBe(key);
    expect(row.data.length).toBe(0);
    expect(await db.blobTrash.findUnique({ where: { key } })).toBeNull();
  });

  it("a bill photo that was removed while being copied: the copy goes on the list", async () => {
    const g = await makeGroup("move-receipt");
    const mine = new Uint8Array([4, 4, 4, 2, Date.now() % 251, Math.floor(Math.random() * 251)]);
    const r = await db.receipt.create({ data: { groupId: g.id, data: mine, blobKey: "" } });
    mocks.put.mockImplementation(async (...args: unknown[]) => {
      if (same(args[1], mine)) await db.receipt.delete({ where: { id: r.id } });
      return { url: "https://blob.example/x" };
    });
    try {
      await movePhotosToBlob(500);
    } finally {
      mocks.put.mockImplementation(async () => ({ url: "https://blob.example/x" }));
    }
    expect(await db.receipt.findUnique({ where: { id: r.id } })).toBeNull();
    expect((await db.blobTrash.findMany()).map((x) => x.key)).toContain(putKeyFor(mine));
  });
});

describe("replacing the group photo while the old one is moved to file storage", () => {
  const annOf = async (groupId: string) => (await db.member.findFirstOrThrow({ where: { groupId, name: "Ann" } })).id;
  const newPhoto = (createdById: string, key: string) => ({ data: new Uint8Array(new ArrayBuffer(0)), blobKey: key, type: "image/webp", createdById, updatedAt: new Date("2026-11-02T10:00:00Z") });

  it("the old photo was moved after we looked (its key was empty then): the moved file is the one queued, so nothing is left behind", async () => {
    const g = await makeGroup("replace-moved");
    const t0 = new Date("2026-11-01T10:00:00Z");
    await db.groupPhoto.create({ data: { groupId: g.id, data: new Uint8Array([1, 2, 3]), blobKey: "", updatedAt: t0 } });
    // We looked (key empty, version t0); then the daily move copied it to file storage without changing its version.
    await db.groupPhoto.update({ where: { groupId: g.id }, data: { data: new Uint8Array(), blobKey: `group/moved-${stamp}` } });
    const ok = await replaceGroupPhoto(g.id, { updatedAt: t0 }, newPhoto(await annOf(g.id), `group/new-${stamp}`), new Date("2026-11-02T10:00:00Z"));
    expect(ok).toBe(true);
    const row = (await db.groupPhoto.findUnique({ where: { groupId: g.id } }))!;
    expect(row.blobKey).toBe(`group/new-${stamp}`);
    expect((await db.blobTrash.findMany()).map((r) => r.key)).toEqual([`group/moved-${stamp}`]);
  });

  it("someone else's photo got there first: ours is refused, theirs is untouched and nothing is queued", async () => {
    const g = await makeGroup("replace-lost");
    const t0 = new Date("2026-11-01T10:00:00Z");
    await db.groupPhoto.create({ data: { groupId: g.id, data: new Uint8Array(), blobKey: `group/theirs-${stamp}`, updatedAt: new Date("2026-11-01T10:05:00Z") } });
    const ok = await replaceGroupPhoto(g.id, { updatedAt: t0 }, newPhoto(await annOf(g.id), `group/ours-${stamp}`), new Date());
    expect(ok).toBe(false);
    expect((await db.groupPhoto.findUnique({ where: { groupId: g.id } }))!.blobKey).toBe(`group/theirs-${stamp}`);
    expect(await db.blobTrash.count()).toBe(0);
  });

  it("a group with no photo yet gets ours and nothing is queued", async () => {
    const g = await makeGroup("replace-first");
    expect(await replaceGroupPhoto(g.id, null, newPhoto(await annOf(g.id), `group/first-${stamp}`), new Date())).toBe(true);
    expect((await db.groupPhoto.findUnique({ where: { groupId: g.id } }))!.blobKey).toBe(`group/first-${stamp}`);
    expect(await db.blobTrash.count()).toBe(0);
  });

  it("INV-08: refused inside the save if the group was deleted, or the person left, was removed or isn't a member", async () => {
    const g = await makeGroup("replace-gone");
    const ann = await annOf(g.id);
    const now = new Date("2026-11-02T10:00:00Z");
    const stillNone = async () => expect(await db.groupPhoto.findUnique({ where: { groupId: g.id } })).toBeNull();

    expect(await replaceGroupPhoto(g.id, null, newPhoto("not-a-member", `group/x1-${stamp}`), now)).toBe(false);
    await stillNone();

    await db.member.update({ where: { id: ann }, data: { leftAt: new Date() } });
    expect(await replaceGroupPhoto(g.id, null, newPhoto(ann, `group/x2-${stamp}`), now)).toBe(false);
    await db.member.update({ where: { id: ann }, data: { leftAt: null, removedAt: new Date() } });
    expect(await replaceGroupPhoto(g.id, null, newPhoto(ann, `group/x3-${stamp}`), now)).toBe(false);
    await db.member.update({ where: { id: ann }, data: { removedAt: null } });

    await db.group.update({ where: { id: g.id }, data: { deletedAt: new Date() } });
    expect(await replaceGroupPhoto(g.id, null, newPhoto(ann, `group/x4-${stamp}`), now)).toBe(false);
    await stillNone();
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).cover).not.toBe("own");

    await db.group.update({ where: { id: g.id }, data: { deletedAt: null } });
    expect(await replaceGroupPhoto(g.id, null, newPhoto(ann, `group/ok-${stamp}`), now)).toBe(true);
  });
});
