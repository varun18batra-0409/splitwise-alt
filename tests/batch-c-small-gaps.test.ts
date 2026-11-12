import { afterAll, describe, expect, it, vi } from "vitest";

// Batch C: the small gaps. Each group below is made fresh for its own test and erased afterwards.

const state = vi.hoisted(() => ({ cookie: "", ip: "10.99.0.1" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", "x-forwarded-for": state.ip }),
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
const { eraseGroups } = await import("@/lib/purge");
const { safeErrorNote, scrubPersonal } = await import("@/lib/scrub");
const A = await import("@/app/actions");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let counter = 0;
const groups: string[] = [];
afterAll(async () => {
  state.cookie = "";
  await eraseGroups(groups);
});

async function world() {
  const n = ++counter;
  const g = await db.group.create({
    data: { name: `C gaps ${n} ${stamp}`, currency: "INR", inviteCode: `cg-${n}-${stamp}`, members: { create: [{ name: "Asha", claimedAt: new Date() }, { name: "Ravi", claimedAt: new Date() }] } },
    include: { members: true },
  });
  groups.push(g.id);
  const a = g.members.find((m) => m.name === "Asha")!.id;
  const r = g.members.find((m) => m.name === "Ravi")!.id;
  state.cookie = await encodeSession({ m: { [g.id]: a }, t: today() });
  return { gid: g.id, a, r };
}
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function redirectOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    const m = /^NEXT_REDIRECT (.*)$/.exec(String((err as Error)?.message));
    if (!m) throw err;
    return m[1];
  }
  throw new Error("expected a redirect");
}

describe("setGroupClosed", () => {
  it("closes and reopens a live group", async () => {
    const w = await world();
    await redirectOf(() => A.setGroupClosed(form({ groupId: w.gid, closed: "1" })));
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).closed).toBe(true);
    await redirectOf(() => A.setGroupClosed(form({ groupId: w.gid, closed: "0" })));
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).closed).toBe(false);
  });

  it("refuses a deleted group: nothing changes and no history line is written", async () => {
    const w = await world();
    await db.group.update({ where: { id: w.gid }, data: { deletedAt: new Date(), deletedById: w.a } });
    const to = await redirectOf(() => A.setGroupClosed(form({ groupId: w.gid, closed: "1" })));
    expect(to).toBe("/");
    const after = await db.group.findUniqueOrThrow({ where: { id: w.gid } });
    expect(after.closed).toBe(false);
    expect(after.closedAt).toBeNull();
    expect(await db.groupEvent.count({ where: { groupId: w.gid, kind: "group_closed" } })).toBe(0);
  });
});

describe("lookupRate limit", () => {
  it("allows 120 lookups an hour from one address, then says so calmly; another address is unaffected", async () => {
    state.ip = `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    // An unsupported code answers at once without any network call.
    for (let i = 0; i < 120; i++) {
      const r = await A.lookupRate("XXX", "INR");
      expect(!r.ok && r.reason).toBe("unsupported");
    }
    const blocked = await A.lookupRate("XXX", "INR");
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.reason).toBe("unavailable");
    expect(!blocked.ok && blocked.message).toBe("Lots of rate lookups from here in the last hour. Enter the rate yourself, or try again later.");
    state.ip = `10.98.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const other = await A.lookupRate("XXX", "INR");
    expect(!other.ok && other.reason).toBe("unsupported");
  }, 60_000);
});

describe("erasing a group", () => {
  it("deletes its pay links explicitly (without relying on the database to cascade)", async () => {
    const w = await world();
    await db.payLink.create({ data: { token: `tok-${stamp}-${w.gid}`, groupId: w.gid, fromId: w.r, toId: w.a, createdById: w.a, expiresAt: new Date(Date.now() + 86_400_000) } });
    expect(await db.payLink.count({ where: { groupId: w.gid } })).toBe(1);
    await eraseGroups([w.gid]);
    expect(await db.payLink.count({ where: { groupId: w.gid } })).toBe(0);
    expect(await db.group.count({ where: { id: w.gid } })).toBe(0);
  });
});

describe("mail errors in the log", () => {
  it("keeps only the code and message, with emails and long ids scrubbed", () => {
    const err = Object.assign(new Error("Recipient rejected: asha@example.com <asha@example.com> token abcdefghijklmnopqrstuvwxyz123456"), {
      code: "EENVELOPE",
      command: "RCPT TO",
      response: "550 secret server reply for asha@example.com",
    });
    const note = safeErrorNote(err);
    expect(note).toBe("EENVELOPE: Recipient rejected: [email] <[email]> token [id]");
    expect(note).not.toMatch(/asha@|550|secret/);
    expect(safeErrorNote(undefined)).toBe("unknown error");
    expect(scrubPersonal("call +91 98765 43210 now")).toBe("call [number] now");
  });
});
