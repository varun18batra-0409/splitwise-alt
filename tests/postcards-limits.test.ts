import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// Postcards and passport sends (Step 7).
//  - SA-9: the daily limit counts each person a send goes to. Postcards: 80 people a day. Passports: 80 people a day (it was 40 sends of
//    up to 60 people each, which is 2,400 people).
//  - SA-7: a postcard carries a group only when both people are in it right now; otherwise it carries none.
const state = vi.hoisted(() => ({ session: "", pending: [] as (() => unknown)[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.session ? { value: state.session } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void state.pending.push(fn) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/fresh-redirect", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
process.env.MAIL_OUTBOX = "1";

const { db } = await import("@/lib/db");
const { allow } = await import("@/lib/rate-limit");
const { encodeSession, today } = await import("@/lib/session");
const { postcardGroupTags } = await import("@/lib/postcards/people");
const { sendPostcardAction } = await import("@/app/postcard-actions");
const { sendPassportAction } = await import("@/app/passport/send/actions");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
const rateKeys: string[] = [];
const DAY = 86_400;

beforeEach(() => {
  state.session = "";
  state.pending = [];
});
afterAll(async () => {
  await db.rateLimit.deleteMany({ where: { key: { in: rateKeys } } });
  await db.postcard.deleteMany({ where: { OR: [{ fromId: { in: accountIds } }, { toId: { in: accountIds } }] } });
  await db.accountNote.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(label: string) {
  const a = await db.account.create({ data: { email: `pl-${label.toLowerCase()}-${stamp}@example.test`, name: label, passportChoiceAt: new Date() } });
  accountIds.push(a.id);
  return a;
}
async function group(label: string, members: { a: { id: string; name: string }; extra?: Record<string, unknown> }[], extra: Record<string, unknown> = {}) {
  const g = await db.group.create({
    data: { name: `${label} ${stamp}`, inviteCode: `pl-${label}-${stamp}`, ...extra, members: { create: members.map((m) => ({ name: m.a.name, accountId: m.a.id, claimedAt: new Date(), ...(m.extra ?? {}) })) } },
  });
  groupIds.push(g.id);
  return g;
}
const key = (tag: string) => {
  const k = `pl-${tag}-${stamp}`;
  rateKeys.push(k);
  return k;
};
const count = async (k: string) => (await db.rateLimit.findUnique({ where: { key: k } }))?.count;
async function redirected(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    const m = /^REDIRECT (.*)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  throw new Error("expected a redirect");
}
function form(o: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
const signedInAs = async (a: { id: string }) => {
  state.session = await encodeSession({ m: {}, a: a.id, v: 0, t: today() });
};

describe("SA-9: the limit counts people, not sends (limit 80 a day)", () => {
  it("60 people, then 21 refused (60 + 21 = 81 > 80), then 20 accepted (80), then 1 refused", async () => {
    const k = key("cost");
    expect(await allow(k, 80, DAY, undefined, 60)).toBe(true);
    expect(await count(k)).toBe(60);
    expect(await allow(k, 80, DAY, undefined, 21)).toBe(false);
    expect(await count(k)).toBe(60); // a refused send uses nothing
    expect(await allow(k, 80, DAY, undefined, 20)).toBe(true);
    expect(await count(k)).toBe(80);
    expect(await allow(k, 80, DAY, undefined, 1)).toBe(false);
    expect(await count(k)).toBe(80);
  });

  it("a send bigger than the whole limit is never allowed, and makes no counter", async () => {
    const k = key("huge");
    expect(await allow(k, 80, DAY, undefined, 81)).toBe(false);
    expect(await count(k)).toBeUndefined();
  });

  it("a new day starts again at the cost of the first send; the old cost-1 behaviour is unchanged", async () => {
    const k = key("window");
    const t0 = new Date("2026-11-16T08:00:00Z");
    expect(await allow(k, 80, DAY, t0, 60)).toBe(true);
    expect(await allow(k, 80, DAY, new Date(t0.getTime() + (DAY + 60) * 1000), 60)).toBe(true);
    expect(await count(k)).toBe(60); // restarted at 60, not 120
    const one = key("one");
    for (let i = 0; i < 3; i++) expect(await allow(one, 3, DAY)).toBe(true);
    expect(await allow(one, 3, DAY)).toBe(false);
    expect(await count(one)).toBe(3);
  });

  it("the postcard action counts each person: with 79 used, a card to 2 people is refused and saves nothing; to 1 person it goes", async () => {
    const asha = await account("Asha");
    const ben = await account("Ben");
    const cleo = await account("Cleo");
    await group("Flat", [{ a: asha }, { a: ben }, { a: cleo }]);
    const k = `postcard:${asha.id}`;
    rateKeys.push(k);
    await db.rateLimit.create({ data: { key: k, count: 79, resetAt: new Date(Date.now() + 3_600_000) } });
    await signedInAs(asha);
    const url = await redirected(() => sendPostcardAction(form({ to: [ben.id, cleo.id], front: "print:beach", message: "hello" })));
    expect(new URL(url, "https://x").searchParams.get("error")).toBe("That’s a lot of postcards today. Try again tomorrow.");
    expect(await db.postcard.count({ where: { fromId: asha.id } })).toBe(0);
    expect(await count(k)).toBe(79);
    await redirected(() => sendPostcardAction(form({ to: ben.id, front: "print:beach", message: "hello" })));
    expect(await db.postcard.count({ where: { fromId: asha.id, toId: ben.id } })).toBe(1);
    expect(await count(k)).toBe(80);
  });

  it("L-3: a card refused for another reason uses none of the day's allowance", async () => {
    const asha = await account("LAsha");
    const ben = await account("LBen");
    await group("LFlat", [{ a: asha }, { a: ben }]);
    const k = `postcard:${asha.id}`;
    rateKeys.push(k);
    await signedInAs(asha);
    // A sealed card with a day in the past is refused after the person is picked and the words are written, but before anything is saved.
    const url = await redirected(() => sendPostcardAction(form({ to: ben.id, front: "print:beach", message: "hello", opensOn: "2020-01-01" })));
    expect(new URL(url, "https://x").searchParams.get("error")).toBe("Pick a day from tomorrow, up to two years ahead.");
    expect(await count(k)).toBeUndefined();
    // And a missing message is refused before it too.
    await redirected(() => sendPostcardAction(form({ to: ben.id, front: "print:beach", message: "" })));
    expect(await count(k)).toBeUndefined();
    // A card that goes counts one.
    await redirected(() => sendPostcardAction(form({ to: ben.id, front: "print:beach", message: "hello" })));
    expect(await count(k)).toBe(1);
  });

  it("the passport action: with 79 used, sending to 2 people is refused (error=limit) and nobody is told", async () => {
    const asha = await account("PAsha");
    const ben = await account("PBen");
    const cleo = await account("PCleo");
    await group("PFlat", [{ a: asha }, { a: ben }, { a: cleo }]);
    const k = `passport-send:${asha.id}`;
    rateKeys.push(k);
    await db.rateLimit.create({ data: { key: k, count: 79, resetAt: new Date(Date.now() + 3_600_000) } });
    await signedInAs(asha);
    expect(await redirected(() => sendPassportAction(form({ to: [ben.id, cleo.id] })))).toBe("/passport/send?error=limit");
    expect(await db.accountNote.count({ where: { accountId: { in: [ben.id, cleo.id] }, kind: "passport" } })).toBe(0);
    expect(await count(k)).toBe(79);
    expect(await redirected(() => sendPassportAction(form({ to: [ben.id] })))).toBe("/passport?sent=1");
    expect(await count(k)).toBe(80);
  });

  it("the limits in the source are 80 people a day, counted by the number of people", () => {
    expect(readFileSync("src/app/passport/send/actions.ts", "utf8")).toContain("`passport-send:${me!.id}`, 80, 86_400, undefined, to.size");
    expect(readFileSync("src/app/postcard-actions.ts", "utf8")).toContain("`postcard:${me.id}`, 80, 86_400, undefined, to.size");
  });
});

describe("SA-7: a postcard carries a group only when both people are in it", () => {
  it("Asha and Ben are in Goa, Cleo is not: Ben's card names Goa, Cleo's carries none", async () => {
    const asha = await account("SAsha");
    const ben = await account("SBen");
    const cleo = await account("SCleo");
    const goa = await group("Goa", [{ a: asha }, { a: ben }]);
    expect([...(await postcardGroupTags(asha.id, goa.id, [ben.id, cleo.id]))]).toEqual([[ben.id, goa.id], [cleo.id, ""]]);
  });

  it("a group Asha is not in (Flat: Ben and Cleo) gives every card none", async () => {
    const asha = await account("FAsha");
    const ben = await account("FBen");
    const cleo = await account("FCleo");
    const flat = await group("FlatB", [{ a: ben }, { a: cleo }]);
    expect([...(await postcardGroupTags(asha.id, flat.id, [ben.id, cleo.id]))].map(([, v]) => v)).toEqual(["", ""]);
  });

  it("no group, an unknown group, a deleted group and a pair of two people give none", async () => {
    const asha = await account("NAsha");
    const ben = await account("NBen");
    const live = await group("NLive", [{ a: asha }, { a: ben }]);
    const gone = await group("NGone", [{ a: asha }, { a: ben }], { deletedAt: new Date() });
    const pair = await group("NPair", [{ a: asha }, { a: ben }], { type: "direct" });
    for (const id of ["", "no-such-group", gone.id, pair.id]) expect([...(await postcardGroupTags(asha.id, id, [ben.id])).values()]).toEqual([""]);
    expect([...(await postcardGroupTags(asha.id, live.id, [ben.id])).values()]).toEqual([live.id]);
  });

  it("removed, left, or never-opened people don't count: Asha removed means no card names the group; Ben left or pending means his card does not", async () => {
    const asha = await account("RAsha");
    const ben = await account("RBen");
    const cleo = await account("RCleo");
    const when = new Date("2026-11-10T00:00:00Z");
    const removedAsha = await group("RGoa1", [{ a: asha, extra: { leftAt: when, removedAt: when } }, { a: ben }, { a: cleo }]);
    expect([...(await postcardGroupTags(asha.id, removedAsha.id, [ben.id, cleo.id])).values()]).toEqual(["", ""]);
    const leftAsha = await group("RGoa2", [{ a: asha, extra: { leftAt: when } }, { a: ben }]);
    expect([...(await postcardGroupTags(asha.id, leftAsha.id, [ben.id])).values()]).toEqual([""]);
    const mixed = await group("RGoa3", [{ a: asha }, { a: ben, extra: { leftAt: when } }, { a: cleo, extra: { addedBy: "someone" } }]);
    expect([...(await postcardGroupTags(asha.id, mixed.id, [ben.id, cleo.id])).values()]).toEqual(["", ""]);
  });

  it("the action saves each card with its own group", async () => {
    const asha = await account("AAsha");
    const ben = await account("ABen");
    const cleo = await account("ACleo");
    const goa = await group("AGoa", [{ a: asha }, { a: ben }]);
    await group("AFlat", [{ a: asha }, { a: cleo }]);
    await signedInAs(asha);
    await redirected(() => sendPostcardAction(form({ to: [ben.id, cleo.id], groupId: goa.id, front: "print:beach", message: "hello" })));
    const cards = await db.postcard.findMany({ where: { fromId: asha.id }, select: { toId: true, groupId: true } });
    expect(Object.fromEntries(cards.map((c) => [c.toId, c.groupId]))).toEqual({ [ben.id]: goa.id, [cleo.id]: "" });
  });

  it("the composer only prefills a group the sender is still in (not left, not removed)", () => {
    expect(readFileSync("src/app/postcards/new/page.tsx", "utf8")).toContain("members: { some: { accountId: me.id, leftAt: null, removedAt: null } }");
  });
});
