import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// AS-3: signing in on a phone that holds guest groups first lists them, and only the groups the person confirmed move.
//
// Hand-worked. One phone holds guest names P (Flat), Q (Trip) and R (Us), all epoch 0, none linked.
//   Cancel in the screen  -> nobody signs in at all; nothing here runs. The server-side twin is "no confirmation":
//                            signInAs(acc, { confirmed: [] }) links 0 names, every epoch stays 0, all three stay on the phone.
//   Confirm P and Q       -> P and Q link to the account (epoch 0 -> 1 each); R stays a guest (epoch 0, accountId null).
//   A confirmed id the phone does not hold (S, a name in another group) -> ignored: S stays unlinked, epoch 0.
const state = vi.hoisted(() => ({ cookie: "", jar: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => {
      if (n === "sw_me") return state.cookie ? { value: state.cookie } : undefined;
      return state.jar[n] ? { value: state.jar[n] } : undefined;
    },
    set: (n: string, v: string) => {
      if (n === "sw_me") state.cookie = v;
      else state.jar[n] = v;
    },
    delete: (n: string | { name: string }) => {
      const name = typeof n === "string" ? n : n.name;
      if (name === "sw_me") state.cookie = "";
      else delete state.jar[name];
    },
  }),
  headers: async () => new Headers({ host: "loopin.test" }),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { encodeSession, decodeSession, today } = await import("@/lib/session");
const { getMemberships, guestGroupsOnPhone, parseConfirmed, setMoveConfirmation, signInAs, takeMoveConfirmation } = await import("@/lib/identity");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groups: string[] = [];
const m: Record<string, { id: string; groupId: string }> = {};
const accounts: string[] = [];
const cookie = (held: string[]) => encodeSession({ m: Object.fromEntries(held.map((k) => [m[k].groupId, m[k].id])), t: today() });
const account = async (label: string) => {
  const a = await db.account.create({ data: { email: `as3-${label}-${stamp}@example.test` } });
  accounts.push(a.id);
  return a.id;
};
const row = (k: string) => db.member.findUniqueOrThrow({ where: { id: m[k].id } });

beforeAll(async () => {
  const mk = async (key: string, name: string, others: string[]) => {
    const g = await db.group.create({ data: { name: `${name} ${stamp}`, inviteCode: `as3-${key}-${stamp}`, members: { create: [{ name: key }, ...others.map((o) => ({ name: o }))] } }, include: { members: true } });
    groups.push(g.id);
    const me = g.members.find((x) => x.name === key)!;
    m[key] = { id: me.id, groupId: g.id };
  };
  await mk("P", "Flat", ["a", "b"]); // 3 people
  await mk("Q", "Trip", ["a", "b", "c"]); // 4 people
  await mk("R", "Us", ["a"]); // 2 people
  await mk("S", "Elsewhere", ["a"]); // not on the phone
});
afterAll(async () => {
  state.cookie = "";
  await db.group.deleteMany({ where: { id: { in: groups } } });
  await db.account.deleteMany({ where: { id: { in: accounts } } });
});

describe("what the sheet lists", () => {
  it("lists exactly the guest groups on this phone, with their people counts", async () => {
    state.cookie = await cookie(["P", "Q", "R"]);
    const list = await guestGroupsOnPhone();
    expect(list.map((g) => g.memberId).sort()).toEqual([m.P.id, m.Q.id, m.R.id].sort());
    const people = Object.fromEntries(list.map((g) => [g.groupId, g.people]));
    expect(people).toEqual({ [m.P.groupId]: 3, [m.Q.groupId]: 4, [m.R.groupId]: 2 });
  });
  it("a phone with no guest groups lists nothing (so nothing is asked)", async () => {
    state.cookie = await encodeSession({ m: {}, t: today() });
    expect(await guestGroupsOnPhone()).toEqual([]);
  });
  it("a name already linked to an account is not a guest group, and is not listed", async () => {
    const other = await account("linked");
    await db.member.update({ where: { id: m.R.id }, data: { accountId: other } });
    state.cookie = await cookie(["P", "R"]);
    expect((await guestGroupsOnPhone()).map((g) => g.memberId)).toEqual([m.P.id]);
    await db.member.update({ where: { id: m.R.id }, data: { accountId: null } });
  });
});

describe("Cancel / no confirmation moves nothing", () => {
  it("signInAs with an empty confirmation links 0 names, keeps every epoch, and leaves all three on the phone as guests", async () => {
    const acc = await account("none");
    state.cookie = await cookie(["P", "Q", "R"]);
    await signInAs(acc, { confirmed: [] });
    for (const k of ["P", "Q", "R"]) {
      const r = await row(k);
      expect(r.accountId).toBeNull();
      expect(r.grantEpoch).toBe(0);
    }
    const s = await decodeSession(state.cookie);
    expect(s?.a).toBe(acc); // signed in...
    expect(Object.keys(s?.m ?? {}).sort()).toEqual([m.P.groupId, m.Q.groupId, m.R.groupId].sort()); // ...but the guest names stay guest names
    expect(Object.values(await getMemberships()).sort()).toEqual([m.P.id, m.Q.id, m.R.id].sort());
  });
});

describe("Confirm moves exactly the listed groups", () => {
  it("confirming P and Q links those two (epoch 1 each); R stays a guest; an id the phone doesn't hold is ignored", async () => {
    const acc = await account("two");
    state.cookie = await cookie(["P", "Q", "R"]);
    await signInAs(acc, { confirmed: [m.P.id, m.Q.id, m.S.id] });
    expect(await row("P")).toMatchObject({ accountId: acc, grantEpoch: 1 });
    expect(await row("Q")).toMatchObject({ accountId: acc, grantEpoch: 1 });
    expect(await row("R")).toMatchObject({ accountId: null, grantEpoch: 0 });
    expect(await row("S")).toMatchObject({ accountId: null, grantEpoch: 0 });
    const s = await decodeSession(state.cookie);
    expect(Object.keys(s?.m ?? {})).toEqual([m.R.groupId]); // only R is still carried by the cookie
  });
});

describe("the confirmation that travels with each route", () => {
  it("parseConfirmed keeps plain id strings only, once each", () => {
    expect(parseConfirmed("a, b,a,,")).toEqual(["a", "b"]);
    expect(parseConfirmed(["x", 5, null, "y", "x"])).toEqual(["x", "y"]);
    expect(parseConfirmed(undefined)).toEqual([]);
    expect(parseConfirmed({ id: "x" })).toEqual([]);
    expect(parseConfirmed("x".repeat(65))).toEqual([]);
  });
  it("Google: the confirmation is kept for the way back, read once, then gone", async () => {
    await setMoveConfirmation([m.P.id, m.Q.id]);
    expect(await takeMoveConfirmation()).toEqual([m.P.id, m.Q.id]);
    expect(await takeMoveConfirmation()).toEqual([]); // used up: a second sign-in is not covered
  });
});

describe("no sign-in route can skip the check", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  it("every call to signInAs outside identity.ts passes an explicit `confirmed` list", () => {
    const calls = files(path.join(process.cwd(), "src"))
      .filter((f) => !f.endsWith(path.join("lib", "identity.ts")))
      .flatMap((f) => readFileSync(f, "utf8").split("\n").filter((l) => /\bsignInAs\(/.test(l) && !/^\s*import /.test(l)).map((l) => ({ f, l })));
    expect(calls.length).toBe(3); // typed code / email link, Google, fingerprint or face
    for (const c of calls) expect(c.l, c.f).toMatch(/confirmed:/);
  });
});
