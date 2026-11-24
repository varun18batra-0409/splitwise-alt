import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Batch 9 (L29): a bill photo is kept only if the person is still in the group when it is saved. Same stand-ins as photo-storage-e2e.test.ts
// (an in-memory shelf instead of Vercel Blob). The photo store's "put" is the gap: the person is removed while the file is being stored.
const blob = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), dels: 0, onPut: null as null | (() => Promise<void>) }));
vi.mock("@vercel/blob", () => ({
  put: async (key: string, body: Uint8Array) => {
    blob.files.set(key, new Uint8Array(body));
    await blob.onPut?.();
    return { url: `https://blob.example/${key}` };
  },
  get: async () => null,
  del: async (keys: string | string[]) => {
    blob.dels++;
    for (const k of Array.isArray(keys) ? keys : [keys]) blob.files.delete(k);
  },
}));
const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", origin: "http://loopin.test", "x-forwarded-for": `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const route = await import("@/app/api/receipt/route");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const saved = { VERCEL: process.env.VERCEL, BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN };
const accountIds: string[] = [];
const groupIds: string[] = [];
// A small complete JPEG (the metadata stripper keeps it as it is).
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 0x31, 0x00, 0xff, 0xd9]);
const upload = (gid: string, read = false) => route.POST(new Request(`http://loopin.test/api/receipt?group=${gid}${read ? "&read=1" : ""}`, { method: "POST", body: jpeg as unknown as BodyInit }));

async function world(label: string) {
  const a = await db.account.create({ data: { email: `b9r-${label}-${stamp}@example.test`, name: "Ann" } });
  accountIds.push(a.id);
  const g = await db.group.create({
    data: { name: `Receipt ${label} ${stamp}`, inviteCode: `b9r-${label}-${stamp}`, currency: "INR", members: { create: [{ name: "Ann", accountId: a.id, claimedAt: new Date() }, { name: "Bea" }] } },
    include: { members: true },
  });
  groupIds.push(g.id);
  state.cookie = await encodeSession({ m: {}, a: a.id, v: 0, t: today() });
  return { gid: g.id, ann: g.members.find((m) => m.name === "Ann")!.id };
}

beforeAll(() => {
  process.env.VERCEL = "1";
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
});
afterAll(async () => {
  blob.onPut = null;
  state.cookie = "";
  if (saved.VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = saved.VERCEL;
  if (saved.BLOB_READ_WRITE_TOKEN === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = saved.BLOB_READ_WRITE_TOKEN;
  await db.receipt.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("L29: a receipt is kept only if you are still in the group", () => {
  it("still in the group: the receipt is saved and the file stays", async () => {
    blob.files.clear();
    const w = await world("in");
    const res = await upload(w.gid);
    expect(res.status).toBe(200);
    expect(await db.receipt.count({ where: { groupId: w.gid } })).toBe(1);
    expect(blob.files.size).toBe(1);
  });

  for (const how of ["left", "removed", "group deleted"] as const) {
    it(`${how} while the photo was being stored: no receipt row, the file is taken off the shelf, the error says so, no reading by the AI`, async () => {
      blob.files.clear();
      blob.dels = 0;
      const w = await world(how.replace(" ", "-"));
      blob.onPut = async () => {
        if (how === "left") await db.member.update({ where: { id: w.ann }, data: { leftAt: new Date() } });
        else if (how === "removed") await db.member.update({ where: { id: w.ann }, data: { removedAt: new Date() } });
        else await db.group.update({ where: { id: w.gid }, data: { deletedAt: new Date() } });
        blob.onPut = null;
      };
      const res = await upload(w.gid, true); // read=1: the AI step must be skipped
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ok: false, error: "You’re no longer in this group, so the photo wasn’t kept." });
      expect(await db.receipt.count({ where: { groupId: w.gid } })).toBe(0);
      expect(blob.dels).toBeGreaterThan(0);
      expect(blob.files.size).toBe(0);
    });
  }
});
