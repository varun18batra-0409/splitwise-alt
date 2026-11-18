import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// SA-5: a request with `Origin: null` (what some browsers send from a sandboxed page) is refused cleanly (403), not with an error.
// SA-6: the upload limit counts each person (30 an hour), with a looser cap per network address (300 an hour), so friends
// sharing one mobile network don't block each other.
const state = vi.hoisted(() => ({ cookie: "", origin: "http://loopin.test" as string | null, ip: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => {
    const h = new Headers({ host: "loopin.test", "x-forwarded-for": state.ip });
    if (state.origin !== null) h.set("origin", state.origin);
    return h;
  },
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
const route = await import("@/app/api/group-photo/[id]/route");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ip = `10.55.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
// A small but complete JPEG.
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 0x05, 0x00, 0xff, 0xd9]);
const post = (gid: string) => route.POST(new Request("http://loopin.test/g", { method: "POST", body: jpeg as unknown as BodyInit }), ctx(gid));

let gid = "";
const accounts: { id: string; member: string }[] = [];
const rateKeys: string[] = [];
const as = async (i: number) => {
  state.cookie = await encodeSession({ m: {}, a: accounts[i].id, v: 0, t: today() });
};
const seed = async (key: string, count: number) => {
  rateKeys.push(key);
  await db.rateLimit.create({ data: { key, count, resetAt: new Date(Date.now() + 3_600_000) } });
};

beforeAll(async () => {
  state.ip = ip;
  for (const n of ["X", "Y"]) accounts.push({ id: (await db.account.create({ data: { email: `gp-${n}-${stamp}@example.test`, name: n } })).id, member: "" });
  const g = await db.group.create({
    data: { name: `GP ${stamp}`, inviteCode: `gp-${stamp}`, members: { create: accounts.map((a, i) => ({ name: i ? "Y" : "X", accountId: a.id, claimedAt: new Date(2026, 0, 1) })) } },
    include: { members: true },
  });
  gid = g.id;
  accounts.forEach((a, i) => (a.member = g.members.find((m) => m.name === (i ? "Y" : "X"))!.id));
});
afterAll(async () => {
  await db.rateLimit.deleteMany({ where: { key: { in: rateKeys } } });
  await db.groupPhoto.deleteMany({ where: { groupId: gid } });
  await db.group.deleteMany({ where: { id: gid } });
  await db.account.deleteMany({ where: { id: { in: accounts.map((a) => a.id) } } });
});

describe("SA-5: a bad Origin is refused cleanly", () => {
  it("Origin: null gets 403 {ok:false,error:'Not allowed.'}; so does another site, and no Origin at all", async () => {
    await as(0);
    for (const origin of ["null", "https://evil.example", "not a url", null]) {
      state.origin = origin;
      const res = await post(gid);
      expect([origin, res.status]).toEqual([origin, 403]);
      expect(await res.json()).toEqual({ ok: false, error: "Not allowed." });
    }
    state.origin = "http://loopin.test";
  });
});

describe("SA-6: the upload limit counts each person first", () => {
  it("X's 31st upload in an hour gets 429; Y's first from the same network address gets 200", async () => {
    await seed(`photo:a:${accounts[0].id}`, 30);
    await as(0);
    const blocked = await post(gid);
    expect(blocked.status).toBe(429);
    await as(1);
    const ok = await post(gid);
    expect([ok.status, (await ok.json()).ok]).toEqual([200, true]);
    // Hand-worked: Y has made one upload (count 1), and the network address has counted one too (X's refused try stopped at X's own limit).
    expect((await db.rateLimit.findUnique({ where: { key: `photo:a:${accounts[1].id}` } }))?.count).toBe(1);
    expect((await db.rateLimit.findUnique({ where: { key: `photo-ip:${ip}` } }))?.count).toBe(1);
    rateKeys.push(`photo:a:${accounts[1].id}`, `photo-ip:${ip}`);
  });

  it("the network address has its own, looser cap: with 300 used, even a person with none left uploads is refused", async () => {
    await db.rateLimit.deleteMany({ where: { key: `photo-ip:${ip}` } });
    await seed(`photo-ip:${ip}`, 300);
    await as(1);
    expect((await post(gid)).status).toBe(429);
  });
});
