import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// AS-3: signing in on a phone that holds guest groups first lists them, and only the groups the person confirmed move.
//
// Hand-worked. One phone holds guest names P (Flat), Q (Trip) and R (Us), all epoch 0, none linked.
//   Cancel in the screen  -> nobody signs in at all; nothing here runs. The server-side twin is "no confirmation":
//                            signInAs(acc, { confirmed: parseConfirmed([]) }) links 0 names, every epoch stays 0, all three stay on the phone.
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
const { clearMoveConfirmation, confirmedGuestIds, getMemberships, guestGroupsOnPhone, moveFromAttempt, moveGuestsToAccount, parseConfirmed, sealMoveForAttempt, setMoveConfirmation, signInAs, takeMoveConfirmation } = await import("@/lib/identity");

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
  await mk("T", "Notice one", ["a"]); // the "only on this device" notice
  await mk("U", "Notice two", ["a"]);
  await mk("V", "Notice three", ["a"]);
  await mk("W", "Not held", ["a"]);
});
afterAll(async () => {
  state.cookie = "";
  await db.group.deleteMany({ where: { id: { in: groups } } });
  await db.account.deleteMany({ where: { id: { in: accounts } } });
});

describe("what the sheet lists", () => {
  it("lists exactly the guest groups on this device, with their people counts", async () => {
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

describe("S7: a group the admin removed this name from is not offered or moved", () => {
  it("a removed name is not listed and is skipped on sign-in; a name that left on its own is still listed", async () => {
    state.cookie = await cookie(["P", "Q"]);
    await db.member.update({ where: { id: m.P.id }, data: { removedAt: new Date() } });
    await db.member.update({ where: { id: m.Q.id }, data: { leftAt: new Date() } });
    try {
      expect((await guestGroupsOnPhone()).map((g) => g.memberId)).toEqual([m.Q.id]);
      const acc = await account("removed");
      await signInAs(acc, { confirmed: parseConfirmed([m.P.id]) });
      expect((await row("P")).accountId).toBeNull();
    } finally {
      await db.member.update({ where: { id: m.P.id }, data: { removedAt: null } });
      await db.member.update({ where: { id: m.Q.id }, data: { leftAt: null } });
    }
  });
});

describe("Cancel / no confirmation moves nothing", () => {
  it("signInAs with an empty confirmation links 0 names, keeps every epoch, and leaves all three on the phone as guests", async () => {
    const acc = await account("none");
    state.cookie = await cookie(["P", "Q", "R"]);
    await signInAs(acc, { confirmed: parseConfirmed([]) });
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
    await signInAs(acc, { confirmed: parseConfirmed([m.P.id, m.Q.id, m.S.id]) });
    expect(await row("P")).toMatchObject({ accountId: acc, grantEpoch: 1 });
    expect(await row("Q")).toMatchObject({ accountId: acc, grantEpoch: 1 });
    expect(await row("R")).toMatchObject({ accountId: null, grantEpoch: 0 });
    expect(await row("S")).toMatchObject({ accountId: null, grantEpoch: 0 });
    const s = await decodeSession(state.cookie);
    expect(Object.keys(s?.m ?? {})).toEqual([m.R.groupId]); // only R is still carried by the cookie
  });
});

describe("the confirmation that travels with each route", () => {
  it("parseConfirmed keeps plain id strings only, once each, with no cap", () => {
    expect([...parseConfirmed("a, b,a,,")]).toEqual(["a", "b"]);
    expect([...parseConfirmed(["x", 5, null, "y", "x"])]).toEqual(["x", "y"]);
    expect([...parseConfirmed(undefined)]).toEqual([]);
    expect([...parseConfirmed({ id: "x" })]).toEqual([]);
    expect([...parseConfirmed("x".repeat(65))]).toEqual([]);
    expect(parseConfirmed(Array.from({ length: 80 }, (_, i) => `id${i}`)).length).toBe(80);
  });
  it("confirmedGuestIds keeps only guest groups this device really holds", async () => {
    state.cookie = await cookie(["T", "U"]);
    expect([...(await confirmedGuestIds([m.T.id, m.W.id, "nope"]))]).toEqual([m.T.id]);
    expect([...(await confirmedGuestIds(undefined))]).toEqual([]);
  });
});

// The note left by "Move them and continue" (hand-worked in seconds): set at t=1000; read at 1010 (10 s later) works once; at 1121
// (121 s later, over the 120 s limit) it is ignored. Sealed into an attempt at t=1000 for state "A": state "A" at 1000+900 works,
// at 1000+901 (over 15 minutes) or for state "B" it does not. Any edit to the ids breaks the signature.
describe("the Google confirmation is signed, dated and tied to its attempt", () => {
  const T0 = 1_000_000;
  it("a fresh note is read once, then it is gone", async () => {
    await setMoveConfirmation(parseConfirmed([m.P.id, m.Q.id]), T0);
    expect([...(await takeMoveConfirmation(T0 + 10_000))]).toEqual([m.P.id, m.Q.id]);
    expect([...(await takeMoveConfirmation(T0 + 10_000))]).toEqual([]);
  });
  it("an old note is ignored (and removed)", async () => {
    await setMoveConfirmation(parseConfirmed([m.P.id]), T0);
    expect([...(await takeMoveConfirmation(T0 + 121_000))]).toEqual([]);
    expect(state.jar["lp_move"]).toBeUndefined();
  });
  it("a note whose ids were edited is ignored", async () => {
    await setMoveConfirmation(parseConfirmed([m.P.id]), T0);
    const [payload, sig] = state.jar["lp_move"].split(".");
    const edited = JSON.parse(Buffer.from(payload, "base64url").toString()) as { ids: string[] };
    edited.ids.push(m.Q.id);
    state.jar["lp_move"] = `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${sig}`;
    expect([...(await takeMoveConfirmation(T0 + 1000))]).toEqual([]);
  });
  it("Cancel throws the note away", async () => {
    await setMoveConfirmation(parseConfirmed([m.P.id]), T0);
    await clearMoveConfirmation();
    expect([...(await takeMoveConfirmation(T0 + 1000))]).toEqual([]);
  });
  it("sealed into an attempt: only that state, only within 15 minutes, never edited", async () => {
    const token = await sealMoveForAttempt("A", parseConfirmed([m.P.id, m.Q.id]), T0);
    expect([...(await moveFromAttempt("A", token, T0 + 900_000))]).toEqual([m.P.id, m.Q.id]);
    expect([...(await moveFromAttempt("A", token, T0 + 901_000))]).toEqual([]);
    expect([...(await moveFromAttempt("B", token, T0 + 1000))]).toEqual([]);
    expect([...(await moveFromAttempt("A", undefined, T0))]).toEqual([]);
    expect([...(await moveFromAttempt("A", "junk.junk", T0))]).toEqual([]);
    const [payload, sig] = token.split(".");
    const edited = JSON.parse(Buffer.from(payload, "base64url").toString()) as { ids: string[] };
    edited.ids = [m.R.id];
    expect([...(await moveFromAttempt("A", `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${sig}`, T0 + 1000))]).toEqual([]);
  });
});

describe("no cap: every guest group is listed and can be confirmed", () => {
  it("15 guest groups: all 15 are listed, confirmed and moved (epoch 0 -> 1 each)", async () => {
    const extra: { id: string; groupId: string }[] = [];
    try {
      for (let i = 0; i < 15; i++) {
        const g = await db.group.create({ data: { name: `Many ${i} ${stamp}`, inviteCode: `as3-many-${i}-${stamp}`, members: { create: [{ name: "Me" }] } }, include: { members: true } });
        groups.push(g.id);
        extra.push({ id: g.members[0].id, groupId: g.id });
      }
      const held = Object.fromEntries(extra.map((e) => [e.groupId, e.id]));
      state.cookie = await encodeSession({ m: held, t: today() });
      const list = await guestGroupsOnPhone();
      expect(list.length).toBe(15);
      const all = await confirmedGuestIds(list.map((g) => g.memberId));
      expect(all.length).toBe(15);
      const acc = await account("many");
      await signInAs(acc, { confirmed: all });
      const rows = await db.member.findMany({ where: { id: { in: extra.map((e) => e.id) } } });
      expect(rows.every((r) => r.accountId === acc && r.grantEpoch === 1)).toBe(true);
      expect(rows.length).toBe(15);
    } finally {
      /* groups are removed in afterAll */
    }
  });
});

// Signed in already, guest groups still only on this device (the check was skipped): the notice's action.
//   Phone holds T, U, V as guests, signed in as account N. Confirm [T, W]: W is not on the phone, so only T moves (epoch 0 -> 1).
//   U and V stay guests (epoch 0) and stay in the cookie; T leaves the cookie (the account now holds it).
describe("the 'only on this device' notice moves exactly what was confirmed", () => {
  it("links T only; U and V stay; an old guest copy of T is refused afterwards", async () => {
    const acc = await account("notice");
    const guestCopy = await cookie(["T", "U", "V"]);
    state.cookie = await encodeSession({ m: Object.fromEntries(["T", "U", "V"].map((k) => [m[k].groupId, m[k].id])), a: acc, v: 0, t: today() });
    const n = await moveGuestsToAccount(await confirmedGuestIds([m.T.id, m.W.id]));
    expect(n).toBe(1);
    expect(await row("T")).toMatchObject({ accountId: acc, grantEpoch: 1 });
    expect(await row("U")).toMatchObject({ accountId: null, grantEpoch: 0 });
    expect(await row("V")).toMatchObject({ accountId: null, grantEpoch: 0 });
    expect(await row("W")).toMatchObject({ accountId: null, grantEpoch: 0 });
    const s = await decodeSession(state.cookie);
    expect(Object.keys(s?.m ?? {}).sort()).toEqual([m.U.groupId, m.V.groupId].sort());
    expect(s?.a).toBe(acc);
    expect(Object.values(await getMemberships()).sort()).toEqual([m.T.id, m.U.id, m.V.id].sort());
    state.cookie = guestCopy; // another device's old guest copy of T
    expect(Object.values(await getMemberships())).not.toContain(m.T.id);
  });
  it("an empty confirmation moves nothing; a phone that is not signed in moves nothing", async () => {
    state.cookie = await encodeSession({ m: { [m.U.groupId]: m.U.id }, t: today() }); // not signed in
    expect(await moveGuestsToAccount(parseConfirmed([m.U.id]))).toBe(0);
    expect(await row("U")).toMatchObject({ accountId: null, grantEpoch: 0 });
    const acc = await account("empty");
    state.cookie = await encodeSession({ m: { [m.U.groupId]: m.U.id }, a: acc, v: 0, t: today() });
    expect(await moveGuestsToAccount(parseConfirmed([]))).toBe(0);
    expect(await row("U")).toMatchObject({ accountId: null, grantEpoch: 0 });
  });
});

describe("no sign-in route can skip the check", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  const all = files(path.join(process.cwd(), "src")).map((f) => ({ f: path.relative(process.cwd(), f), text: readFileSync(f, "utf8") }));
  const outside = all.filter((x) => x.f !== path.join("src", "lib", "identity.ts"));
  // The text of each call, from "signInAs(" to its matching ")", even over several lines.
  const calls = (text: string) => {
    const out: string[] = [];
    for (const m2 of text.matchAll(/\bsignInAs\s*\(/g)) {
      let depth = 0;
      let i = (m2.index ?? 0) + m2[0].length - 1;
      const start = i;
      for (; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")" && --depth === 0) break;
      }
      out.push(text.slice(start, i + 1));
    }
    return out;
  };
  it("only the three sign-in routes use signInAs, under its own name (no renamed import)", () => {
    const users = outside.filter((x) => /\bsignInAs\b/.test(x.text)).map((x) => x.f).sort();
    expect(users).toEqual([
      path.join("src", "app", "actions.ts"),
      path.join("src", "app", "api", "auth", "google", "callback", "route.ts"),
      path.join("src", "app", "api", "passkey", "login", "verify", "route.ts"),
    ]);
    for (const x of outside) expect(x.text, x.f).not.toMatch(/\bsignInAs\s+as\s+/);
  });
  it("every call (one line or many) takes `confirmed` from a parse of what the screen sent, or from the sealed Google attempt", () => {
    const found = outside.flatMap((x) => calls(x.text).map((c) => ({ f: x.f, c })));
    expect(found.length).toBe(3);
    for (const { f, c } of found) expect(c, f).toMatch(/confirmed:\s*(parseConfirmed\(|await moveFromAttempt\()/);
  });
  it("nothing but identity.ts can make a ConfirmedIds out of a plain list (no casts)", () => {
    for (const x of outside) expect(x.text, x.f).not.toMatch(/as\s+(unknown\s+as\s+)?ConfirmedIds/);
    const id = all.find((x) => x.f === path.join("src", "lib", "identity.ts"))!.text;
    expect(id.match(/as\s+unknown\s+as\s+ConfirmedIds/g)?.length).toBe(1); // the one helper that brands a list
  });
});
