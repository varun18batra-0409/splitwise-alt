import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The offline door, tested as a whole: the route itself (origin, content type, the switch, who is asking from the cookie, a guest and an
// account member), a send whose first answer was lost, a rate service that is down, and fixing a draft at its own day's rate.
// Every expected number is worked out by hand in the comment above it. 1 rupee = 100 paise.

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", "x-forwarded-for": `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
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
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/push", async (orig) => ({ ...(await orig<typeof import("@/lib/push")>()), sendPushTo: async () => 0 }));
// The rate service: 2.5 for any past day, 9 for today, so an expense at the wrong day's rate shows at once.
vi.mock("@/lib/rates", async (orig) => ({
  ...(await orig<typeof import("@/lib/rates")>()),
  fetchPairRate: vi.fn(async () => ({ ok: true as const, rate: "9", date: new Date().toISOString().slice(0, 10) })),
  fetchRateOn: vi.fn(async (_f: string, _t: string, day: string) => ({ ok: true as const, rate: "2.5", date: day })),
  fetchSupportedCodes: vi.fn(async () => null),
}));

const { NextRequest } = await import("next/server");
const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const { grantValue } = await import("@/lib/identity");
const { sendDraft } = await import("@/lib/offline/send");
const { readDraft } = await import("@/lib/offline/validate");
const { saveExpense } = await import("@/lib/save-expense");
const { POST } = await import("@/app/api/offline/add/route");
const A = await import("@/app/actions");
const { NOT_SIGNED_IN, OTHER_PERSON, PAIR_REFUSED } = await import("@/lib/offline/words");
import { checkBooks } from "./helpers/money-invariants";
import type { DraftInput } from "@/lib/offline/types";
import type { RateAnswer } from "@/lib/rate-cache";

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groups: string[] = [];
const accounts: string[] = [];
const keys: string[] = [];
let n = 0;
const newKey = () => {
  const k = `off-rv-${stamp}-${(n++).toString().padStart(3, "0")}`;
  keys.push(k);
  return k;
};
const todayKey = new Date().toISOString().slice(0, 10);

async function mkGroup(names: string[], over: { type?: string; currency?: string; accountFor?: string[] } = {}) {
  const g = await db.group.create({ data: { name: "Goa trip", currency: over.currency ?? "INR", type: over.type ?? "trip", inviteCode: `rv-${stamp}-${groups.length}` } });
  groups.push(g.id);
  const ids: string[] = [];
  for (const [i, name] of names.entries()) {
    const a = over.accountFor?.includes(name) ? await db.account.create({ data: { email: `rv-${stamp}-${accounts.length}@example.test`, name } }) : null;
    if (a) accounts.push(a.id);
    const m = await db.member.create({ data: { groupId: g.id, name, accountId: a?.id ?? null, claimedAt: a ? new Date() : null, seenAt: a ? new Date() : null, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) } });
    ids.push(m.id);
  }
  return { id: g.id, ids };
}
function draftOf(g: { id: string; ids: string[] }, over: Partial<DraftInput> = {}): DraftInput {
  return {
    key: newKey(), groupId: g.id, memberId: g.ids[0], day: todayKey, typedAt: Date.now(),
    name: "Taxi", amount: "1200", currency: "INR", category: "", paidById: g.ids[0], multiPay: false, payers: {},
    forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, shares: {},
    kind: "expense", paymentMethod: "cash", markupChoice: "group", markupCustom: "", notes: "", rateMode: "auto", manualRate: "",
    seen: { baseCurrency: "INR", cardMarkupBp: 0, activeMemberIds: g.ids, snapshotAt: new Date().toISOString() },
    ...over,
  };
}
const sameRate = async (_f: string, _t: string, day: string): Promise<RateAnswer> => ({ ok: true, rate: "1", date: day });

afterAll(async () => {
  await db.requestKey.deleteMany({ where: { OR: [{ key: { in: keys } }, { key: { startsWith: `rv-${stamp}` } }] } });
  await db.groupEvent.deleteMany({ where: { groupId: { in: groups } } });
  await db.group.deleteMany({ where: { id: { in: groups } } });
  await db.account.deleteMany({ where: { id: { in: accounts } } });
  await db.exchangeRate.deleteMany({ where: { base: "THB", quote: "INR", rate: { in: ["9", "2.5"] } } }); // the rates this file's mock made
});
beforeEach(() => {
  process.env.OFFLINE_ADD = "1";
  state.cookie = "";
});

const post = (body: unknown, o: { origin?: string | null; type?: string } = {}) => {
  const headers: Record<string, string> = { "content-type": o.type ?? "application/json", "x-forwarded-host": "loopin.test", "x-forwarded-for": `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
  if (o.origin !== null) headers.origin = o.origin ?? "http://loopin.test";
  return POST(new NextRequest("http://loopin.test/api/offline/add", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
};
const guestCookie = async (groupId: string, memberId: string) => encodeSession({ m: { [groupId]: grantValue(memberId, 0) }, v: 0, t: today() });
const accountCookie = async (accountId: string) => encodeSession({ m: {}, a: accountId, v: 0, t: today() });

describe("POST /api/offline/add: the door itself", () => {
  it("a request from another site is refused (403) and nothing is saved", async () => {
    const g = await mkGroup(["A", "B", "C"]);
    state.cookie = await guestCookie(g.id, g.ids[0]);
    const r = await post({ draft: draftOf(g) }, { origin: "http://evil.example" });
    expect(r.status).toBe(403);
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(0);
    expect((await post({ draft: draftOf(g) }, { origin: null })).status).toBe(403); // no origin at all
  });

  it("anything but JSON is refused (415)", async () => {
    const r = await post("draft=1", { type: "text/plain" });
    expect(r.status).toBe(415);
    expect(await r.json()).toMatchObject({ status: "refused", code: "invalid" });
  });

  it("with the OFFLINE_ADD switch off it keeps everything waiting (503, status later) and saves nothing", async () => {
    const g = await mkGroup(["A", "B", "C"]);
    state.cookie = await guestCookie(g.id, g.ids[0]);
    delete process.env.OFFLINE_ADD;
    const r = await post({ draft: draftOf(g) });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ status: "later" });
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(0);
  });

  it("a damaged draft gets a calm 400, never a crash", async () => {
    expect((await post({ draft: { key: "off-x" } })).status).toBe(400);
    expect((await post("{not json")).status).toBe(400);
  });

  it("who is asking comes from the cookie: a guest adds ₹1,200 among 3 as 120000 paise, 3 shares of 40000", async () => {
    // A guest (no account) is the first person. 1,200 rupees = 120000 paise; 120000 / 3 = 40000 each, no remainder.
    const g = await mkGroup(["A", "B", "C"]);
    state.cookie = await guestCookie(g.id, g.ids[0]);
    const r = await post({ draft: draftOf(g) });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: "added" });
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id }, include: { shares: true } });
    expect(e.amount).toBe(120000);
    expect(e.createdById).toBe(g.ids[0]);
    expect(e.shares.map((s) => s.amount)).toEqual([40000, 40000, 40000]);
  });

  it("an account member (not a guest) adds the same way: ₹900 among 3 is 90000 paise, 30000 each, balances A +60000, B -30000, C -30000", async () => {
    const g = await mkGroup(["A", "B", "C"], { accountFor: ["A", "B", "C"] });
    const a = await db.member.findUniqueOrThrow({ where: { id: g.ids[0] } });
    state.cookie = await accountCookie(a.accountId as string);
    const r = await post({ draft: draftOf(g, { amount: "900" }) });
    expect(await r.json()).toMatchObject({ status: "added" });
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id }, include: { shares: true } });
    expect(e.amount).toBe(90000);
    expect(e.createdById).toBe(g.ids[0]);
    const share = (id: string) => e.shares.find((s) => s.memberId === id)?.amount;
    expect([share(g.ids[0]), share(g.ids[1]), share(g.ids[2])]).toEqual([30000, 30000, 30000]);
    // Paid 90000, owes 30000: +60000; B and C owe 30000 each; together 0. Read back from the database, not worked out here.
    const net = await checkBooks(g.id);
    expect([net[g.ids[0]], net[g.ids[1]], net[g.ids[2]]]).toEqual([60000, -30000, -30000]);
    expect(e.shares.reduce((s, x) => s + x.amount, 0)).toBe(e.amount);
  });

  it("the cookie, not the request, decides: a draft saved by A sent while B is signed in is refused and nothing is saved", async () => {
    const g = await mkGroup(["A", "B", "C"]);
    state.cookie = await guestCookie(g.id, g.ids[1]); // B
    const r = await post({ draft: draftOf(g) }); // memberId says A
    expect(await r.json()).toEqual({ status: "refused", code: "other-person", reason: OTHER_PERSON });
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(0);
  });

  it("nobody signed in: it keeps waiting, and a group that is a pair is NOT revealed to a stranger", async () => {
    const pair = await mkGroup(["A", "B"], { type: "direct" });
    state.cookie = ""; // not signed in
    const r = await post({ draft: draftOf(pair) });
    const body = await r.json();
    expect(body).toEqual({ status: "later", reason: NOT_SIGNED_IN });
    expect(JSON.stringify(body)).not.toContain(PAIR_REFUSED);
    // A signed-in person who is not in that pair learns nothing about it either.
    const other = await mkGroup(["X", "Y", "Z"]);
    state.cookie = await guestCookie(other.id, other.ids[0]);
    const r2 = await (await post({ draft: draftOf(pair) })).json();
    expect(r2).toEqual({ status: "later", reason: NOT_SIGNED_IN });
  });

  it("a member of a pair is told it is a pair (offline add is not in version 1)", async () => {
    const pair = await mkGroup(["A", "B"], { type: "direct" });
    state.cookie = await guestCookie(pair.id, pair.ids[0]);
    expect(await (await post({ draft: draftOf(pair) })).json()).toMatchObject({ status: "refused", code: "pair" });
    expect(await db.expense.count({ where: { groupId: pair.id } })).toBe(0);
  });

  it("a dry run through the route saves nothing and uses no key", async () => {
    const g = await mkGroup(["A", "B", "C"]);
    state.cookie = await guestCookie(g.id, g.ids[0]);
    const d = draftOf(g);
    expect(await (await post({ draft: d, dryRun: true })).json()).toEqual({ status: "ok" });
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(0);
    expect(await db.requestKey.count({ where: { key: d.key } })).toBe(0);
  });
});

describe("a key that was already used is answered 'already added' (never saved twice)", () => {
  // A kept expense has its own one-time key; if the server already used that key, the answer is the same expense again.
  const lost = (g: { id: string; ids: string[] }, K: string) => ({ ...draftOf(g), key: K }); // ₹1,200 "Taxi", paid by A, shared by everyone
  const online = (g: { id: string; ids: string[] }, K: string) => onlineSave(g, K, "1200");

  it("a save with this key committed (say the reply was lost): sending the kept copy answers 'already added' (dry run too), exactly one expense of 120000", async () => {
    const g = await mkGroup(["A", "B"]);
    const K = newKey();
    const first = await online(g, K);
    expect(first.ok).toBe(true);
    const id = first.ok ? first.id : "";
    expect(await sendDraft(lost(g, K), g.ids[0], { rateOn: sameRate, dryRun: true })).toEqual({ status: "added", id });
    expect(await sendDraft(lost(g, K), g.ids[0], { rateOn: sameRate })).toEqual({ status: "added", id });
    const all = await db.expense.findMany({ where: { groupId: g.id } });
    expect(all).toHaveLength(1);
    expect(all[0].amount).toBe(120000);
  });
  it("the phone's copy was sent first: the online try with the same key then finds it and answers with the same expense (still one)", async () => {
    const g = await mkGroup(["A", "B"]);
    const K = newKey();
    const sent = await sendDraft(lost(g, K), g.ids[0], { rateOn: sameRate });
    expect(sent.status).toBe("added");
    const again = await online(g, K);
    expect(again).toEqual({ ok: true, id: sent.status === "added" ? sent.id : "" });
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(1);
  });
  it("a draft whose key was never used is added normally (one expense, once)", async () => {
    const g = await mkGroup(["A", "B"]);
    const d = draftOf(g);
    expect((await sendDraft(d, g.ids[0], { rateOn: sameRate })).status).toBe("added");
    expect((await sendDraft(d, g.ids[0], { rateOn: sameRate })).status).toBe("added");
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(1);
  });
  it("a new expense (new key) of the same amount and name after one was added is asked about, not dropped", async () => {
    const g = await mkGroup(["A", "B"]);
    await online(g, newKey());
    const fresh = draftOf(g); // a fresh key, ₹1,200 "Taxi" again
    expect((await sendDraft(fresh, g.ids[0], { rateOn: sameRate })).status).toBe("duplicate");
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(1);
  });
});

describe("a rate service that is down keeps the draft waiting", () => {
  it("'offline' means later (keep waiting, nothing saved, no key); 'no rate for that day' still refuses and asks for a rate", async () => {
    const g = await mkGroup(["A", "B"]);
    const d = draftOf(g, { amount: "1000", currency: "THB", day: "2026-11-17" });
    const down = async (): Promise<RateAnswer> => ({ ok: false, reason: "offline", message: "Couldn't reach the rate service. Enter the rate yourself, or try again later." });
    expect(await sendDraft(d, g.ids[0], { rateOn: down })).toEqual({ status: "later", reason: "Couldn't reach the rate service. Enter the rate yourself, or try again later." });
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(0);
    expect(await db.requestKey.count({ where: { key: d.key } })).toBe(0);
    const none = async (): Promise<RateAnswer> => ({ ok: false, reason: "unavailable", message: "x" });
    expect(await sendDraft(d, g.ids[0], { rateOn: none })).toMatchObject({ status: "refused", code: "no-rate" });
  });
});

describe("a group of 100 people (card night) can send a draft", () => {
  it("100 people are read; 101 are not", () => {
    const ids = Array.from({ length: 101 }, (_, i) => `m${i}`);
    const g = { id: "g1", ids };
    const ok = readDraft({ ...draftOf(g, { forMode: "selected", selected: ids.slice(0, 100) }), seen: { baseCurrency: "INR", cardMarkupBp: 0, activeMemberIds: ids.slice(0, 100), snapshotAt: "2026-11-22T00:00:00Z" } });
    expect(ok?.selected).toHaveLength(100);
    const tooMany = readDraft({ ...draftOf(g, { forMode: "selected", selected: ids }), seen: { baseCurrency: "INR", cardMarkupBp: 0, activeMemberIds: ids, snapshotAt: "2026-11-22T00:00:00Z" } });
    expect(tooMany).toBeNull();
  });
});

// ---- the third review ----
const onlineSave = (g: { id: string; ids: string[] }, key: string, amount: string, name = "Taxi") =>
  saveExpense(
    { groupId: g.id, name, amount, currency: "INR", category: "", paidById: g.ids[0], forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", requestKey: key },
    g.ids[0],
    sameRate,
    { requestKey: key },
  );

const THB = (g: { id: string; ids: string[] }, key: string, extra: Record<string, unknown> = {}) => ({
  groupId: g.id, name: "Dinner", amount: "1000", currency: "THB", category: "", paidById: g.ids[0], forMode: "everyone" as const, selected: [], onePersonId: "", splitType: "equal" as const, exact: {}, percent: {},
  paymentMethod: "cash" as const, markupChoice: "group" as const, markupCustom: "", rateMode: "auto" as const, manualRate: "", date: "2026-11-10", requestKey: key, ...extra,
});
const addOnline = (input: ReturnType<typeof THB>) =>
  A.addExpense(input).catch((e: Error) => {
    if (!/^NEXT_REDIRECT/.test(e.message)) throw e;
  });

describe("an online save is exactly as on the live app, with the switch on or off", () => {
  // THB 1,000 = 100000 satang, at TODAY's rate 9 = 900000 paise, even for a past date or with an off- key (Open and fix keeps its key).
  for (const on of [true, false]) {
    it(`switch ${on ? "ON" : "OFF"}: a past date uses today's rate 9 -> 900000, shared in two 450000; the rate lookup action answers today's rate`, async () => {
      if (!on) delete process.env.OFFLINE_ADD;
      const g = await mkGroup(["A", "B"], { accountFor: ["A", "B"] });
      state.cookie = await accountCookie(((await db.member.findUniqueOrThrow({ where: { id: g.ids[0] } })).accountId) as string);
      await addOnline(THB(g, newKey())); // newKey() is an off- key like Open and fix's
      const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id }, include: { shares: true } });
      expect([e.amount, e.exchangeRate]).toEqual([900000, "9"]);
      expect(e.shares.map((x) => x.amount)).toEqual([450000, 450000]);
      expect(await A.lookupRate("THB", "INR")).toMatchObject({ ok: true, rate: "9" });
    });
  }
});

describe("offline code never writes an exchange rate", () => {
  it("getRateOn for a past day (10 Nov) answers 2.5 and leaves the ExchangeRate table exactly as it was", async () => {
    const { getRateOn } = await import("@/lib/rate-cache");
    const before = await db.exchangeRate.count({ where: { base: "THB", date: "2026-11-09" } });
    expect(await getRateOn("THB", "INR", "2026-11-09", todayKey)).toMatchObject({ ok: true, rate: "2.5" });
    expect(await db.exchangeRate.count({ where: { base: "THB", date: "2026-11-09" } })).toBe(before);
    expect(before).toBe(0);
  });
});

describe("Open and fix is refused on the server when it would quietly use today's rate for an earlier day", () => {
  // THB 1,000 = 100000 satang. Typed rate 2.5 -> 250000 paise. (Live rate today in this file's mock: 9 -> 900000: never used.)
  it("an off- key, 10 Nov, THB, 'use the live rate': refused with the note, nothing saved; the same with a typed rate 2.5: saved as 250000, 125000 each", async () => {
    const g = await mkGroup(["A", "B"], { accountFor: ["A", "B"] });
    state.cookie = await accountCookie(((await db.member.findUniqueOrThrow({ where: { id: g.ids[0] } })).accountId) as string);
    const key = newKey();
    const refused = await A.addExpense(THB(g, key));
    expect(refused).toEqual({ error: "Enter the rate for 10 Nov (the day of this expense)." });
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(0);
    expect(await db.requestKey.count({ where: { key } })).toBe(0);
    await addOnline(THB(g, key, { rateMode: "manual", manualRate: "2.5" }));
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id }, include: { shares: true } });
    expect([e.amount, e.exchangeRate, e.rateSource]).toEqual([250000, "2.5", "manual"]);
    expect(e.shares.map((x) => x.amount)).toEqual([125000, 125000]);
  });
  it("a normal key is exactly as on live (today's rate 9: 900000), and today's date with an off- key is not refused", async () => {
    const g = await mkGroup(["A", "B"], { accountFor: ["A", "B"] });
    state.cookie = await accountCookie(((await db.member.findUniqueOrThrow({ where: { id: g.ids[0] } })).accountId) as string);
    await addOnline(THB(g, `rv-${stamp}-normal-0010`));
    keys.push(`rv-${stamp}-normal-0010`);
    await addOnline(THB(g, newKey(), { date: "", name: "Today" }));
    const rows = await db.expense.findMany({ where: { groupId: g.id }, orderBy: { amount: "asc" } });
    expect(rows.map((e) => e.amount)).toEqual([900000, 900000]);
  });
});
