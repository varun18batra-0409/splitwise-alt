import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Page level: the moments page and the single-moment viewer answer "not found" (the same for every reason) to someone who may not
// open them: never opened the group (pending), taken out by the admin (removed), signed out, a stranger, and (for the viewer) someone
// with a block either way. The pages are called directly; the check happens before anything is shown.

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  RedirectType: { replace: "replace", push: "push" },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const listPage = (await import("@/app/groups/[id]/moments/page")).default;
const viewPage = (await import("@/app/groups/[id]/moments/[momentId]/page")).default;

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const accountIds: string[] = [];
let groupId = "";
let momentId = "";
const who = {} as Record<"ann" | "bea" | "pam" | "rex" | "cal" | "dee", string>;

const as = async (accountId: string | null) => {
  state.cookie = accountId ? await encodeSession({ m: {}, a: accountId, v: 0, t: today() }) : "";
};
const listAs = (id = groupId) => listPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
const viewAs = (id = groupId, m = momentId) => viewPage({ params: Promise.resolve({ id, momentId: m }) });

beforeAll(async () => {
  for (const n of ["ann", "bea", "pam", "rex", "cal", "dee"] as const) {
    who[n] = (await db.account.create({ data: { email: `pg-${n}-${stamp}@example.test`, name: n } })).id;
    accountIds.push(who[n]);
  }
  const g = await db.group.create({
    data: {
      name: `Pages ${stamp}`, inviteCode: `pg-${stamp}`, type: "trip", tripStart: "2026-03-10", tripEnd: "2026-03-14",
      members: {
        create: [
          { name: "Ann", accountId: who.ann, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) },
          { name: "Bea", accountId: who.bea, claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2) },
          { name: "Dee", accountId: who.dee, claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 3) },
          { name: "Pam", accountId: who.pam, createdAt: new Date(2026, 0, 7), addedBy: "Ann" }, // never opened it
          { name: "Rex", accountId: who.rex, claimedAt: new Date(2026, 0, 4), createdAt: new Date(2026, 0, 6), leftAt: new Date(), removedAt: new Date(), removedById: "admin" },
        ],
      },
    },
    include: { members: true },
  });
  groupId = g.id;
  const ann = g.members.find((m) => m.name === "Ann")!.id;
  momentId = (await db.moment.create({ data: { groupId, authorId: ann, authorAccountId: who.ann, caption: "page test", data: new Uint8Array(), thumbData: new Uint8Array() } })).id;
});
afterAll(async () => {
  state.cookie = "";
  await db.block.deleteMany({ where: { OR: [{ blockerId: { in: accountIds } }, { blockedId: { in: accountIds } }] } });
  await db.moment.deleteMany({ where: { groupId } });
  await db.group.deleteMany({ where: { id: groupId } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("the moments pages say not found to people who may not open them", () => {
  it("the list page: pending, removed, a stranger and a signed-out phone", async () => {
    for (const [label, id] of [["pending", who.pam], ["removed", who.rex], ["stranger", who.cal], ["signed out", null]] as const) {
      await as(id);
      await expect(listAs(), label).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("the viewer: pending, removed, a stranger and a signed-out phone", async () => {
    for (const [label, id] of [["pending", who.pam], ["removed", who.rex], ["stranger", who.cal], ["signed out", null]] as const) {
      await as(id);
      await expect(viewAs(), label).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("the viewer: a block either way, and a moment that doesn't exist or is in another group", async () => {
    await db.block.create({ data: { blockerId: who.bea, blockedId: who.ann } }); // Bea blocked the author
    await db.block.create({ data: { blockerId: who.ann, blockedId: who.dee } }); // the author blocked Dee
    for (const [label, id] of [["viewer blocked the author", who.bea], ["author blocked the viewer", who.dee]] as const) {
      await as(id);
      await expect(viewAs(), label).rejects.toThrow("NEXT_NOT_FOUND");
    }
    await as(who.ann);
    await expect(viewAs(groupId, "no-such-moment-id"), "no such moment").rejects.toThrow("NEXT_NOT_FOUND");
    await expect(viewAs("another-group-id", momentId), "wrong group").rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a deleted group is not found either", async () => {
    await db.block.deleteMany({ where: { blockerId: { in: accountIds } } });
    await db.group.update({ where: { id: groupId }, data: { deletedAt: new Date() } });
    try {
      await as(who.ann);
      await expect(listAs()).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(viewAs()).rejects.toThrow("NEXT_NOT_FOUND");
    } finally {
      await db.group.update({ where: { id: groupId }, data: { deletedAt: null } });
    }
  });
});
