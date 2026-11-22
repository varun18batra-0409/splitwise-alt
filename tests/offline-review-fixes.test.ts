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

describe("a save whose reply was lost, kept on the phone afterwards", () => {
  it("the same expense is answered 'already added' (not saved twice): ₹1,200 among 2 stays ONE expense of 120000", async () => {
    const g = await mkGroup(["A", "B"]);
    const online = `rv-${stamp}-lost-reply-1`; // the key the Add screen used for its online try
    const base = draftOf(g);
    const first = await saveExpense(
      { groupId: g.id, name: "Taxi", amount: "1200", currency: "INR", category: "", paidById: g.ids[0], forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", requestKey: online },
      g.ids[0],
      sameRate,
      { requestKey: online },
    );
    expect(first.ok).toBe(true);
    // "Save on this phone" then keeps it as off- + that key.
    const kept = { ...base, key: `off-${online}` };
    keys.push(kept.key);
    const id = first.ok ? first.id : "";
    expect(await sendDraft(kept, g.ids[0], { rateOn: sameRate, dryRun: true, allowDuplicate: true })).toEqual({ status: "added", id });
    expect(await sendDraft(kept, g.ids[0], { rateOn: sameRate, allowDuplicate: true })).toEqual({ status: "added", id });
    const all = await db.expense.findMany({ where: { groupId: g.id } });
    expect(all).toHaveLength(1);
    expect(all[0].amount).toBe(120000);
  });
  it("a draft whose original key was never used is added normally (one expense, once)", async () => {
    const g = await mkGroup(["A", "B"]);
    const d = draftOf(g);
    expect((await sendDraft(d, g.ids[0], { rateOn: sameRate })).status).toBe("added");
    expect((await sendDraft(d, g.ids[0], { rateOn: sameRate })).status).toBe("added");
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

describe("Open and fix uses the draft's own day's rate", () => {
  it("THB 1,000 dated 10 Nov, key off-...: 100000 satang x 2.5 (10 Nov) = 250000 paise, NOT x 9 (today) = 900000", async () => {
    const g = await mkGroup(["A", "B"], { accountFor: ["A", "B"] });
    const a = await db.member.findUniqueOrThrow({ where: { id: g.ids[0] } });
    state.cookie = await accountCookie(a.accountId as string);
    const key = newKey();
    await A.addExpense({
      groupId: g.id, name: "Dinner", amount: "1000", currency: "THB", category: "", paidById: g.ids[0], forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {},
      paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", date: "2026-11-10", requestKey: key,
    }).catch((e: Error) => {
      if (!/^NEXT_REDIRECT/.test(e.message)) throw e;
    });
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id }, include: { shares: true } });
    expect(e.amount).toBe(250000);
    expect(e.exchangeRate).toBe("2.5");
    expect(e.shares.map((s) => s.amount)).toEqual([125000, 125000]);
  });
});

// ---- the second review ----
const typedOf = (amount: string, name = "Taxi", currency = "INR") => ({ amount, currency, name });
const onlineSave = (g: { id: string; ids: string[] }, key: string, amount: string, name = "Taxi") =>
  saveExpense(
    { groupId: g.id, name, amount, currency: "INR", category: "", paidById: g.ids[0], forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", requestKey: key },
    g.ids[0],
    sameRate,
    { requestKey: key },
  );

describe("the original key of a draft kept after an online try", () => {
  it("an edited draft is never dropped: ₹1,200 saved online, the draft says ₹1,500 -> a duplicate question; 'Different, keep both' adds 150000 beside the 120000", async () => {
    const g = await mkGroup(["A", "B"]);
    const K = `rv-${stamp}-edit-0001`;
    const first = await onlineSave(g, K, "1200");
    expect(first.ok).toBe(true);
    const kept = { ...draftOf(g, { amount: "1500" }), key: `off-${K}` };
    keys.push(kept.key);
    const asked = await sendDraft(kept, g.ids[0], { rateOn: sameRate });
    expect(asked.status).toBe("duplicate");
    expect(asked.status === "duplicate" && asked.dup).toMatchObject({ id: first.ok ? first.id : "", description: "Taxi", amount: 120000, by: "A" });
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(1); // asking saved nothing
    const both = await sendDraft(kept, g.ids[0], { rateOn: sameRate, allowDuplicate: true });
    expect(both.status).toBe("added");
    const amounts = (await db.expense.findMany({ where: { groupId: g.id } })).map((e) => e.amount).sort((a, b) => a - b);
    expect(amounts).toEqual([120000, 150000]);
  });
  it("a changed name or currency is a question too; the same amount and name (different spacing) is already added", async () => {
    const g = await mkGroup(["A", "B"]);
    const K = `rv-${stamp}-edit-0002`;
    const first = await onlineSave(g, K, "1200");
    const kept = { ...draftOf(g), key: `off-${K}` };
    keys.push(kept.key);
    expect((await sendDraft({ ...kept, name: "Lunch" }, g.ids[0], { rateOn: sameRate })).status).toBe("duplicate");
    expect((await sendDraft({ ...kept, name: "  Taxi " }, g.ids[0], { rateOn: sameRate })).status).toBe("added");
    expect(await sendDraft({ ...kept, amount: "1,200" }, g.ids[0], { rateOn: sameRate })).toEqual({ status: "added", id: first.ok ? first.id : "" });
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(1);
  });
  it("a key that made an expense in ANOTHER group is nothing to do with this draft: it is added normally (₹1,200 = 120000), the other group's expense is untouched", async () => {
    const mine = await mkGroup(["A", "B"]);
    const other = await mkGroup(["X", "Y"]);
    const K = `rv-${stamp}-other-0003`;
    const there = await onlineSave(other, K, "1200");
    const d = { ...draftOf(mine), key: `off-${K}` };
    keys.push(d.key);
    const r = await sendDraft(d, mine.ids[0], { rateOn: sameRate });
    expect(r.status).toBe("added");
    const e = await db.expense.findFirstOrThrow({ where: { groupId: mine.id } });
    expect(e.amount).toBe(120000);
    expect(r.status === "added" && r.id).toBe(e.id);
    expect(r.status === "added" && r.id).not.toBe(there.ok ? there.id : "");
    expect(await db.expense.count({ where: { groupId: other.id } })).toBe(1);
  });
});

describe("one save wins when an online save and the phone's copy both try", () => {
  it("the phone's copy claims K too: afterwards an online save with K is answered 'already added' (one expense)", async () => {
    const g = await mkGroup(["A", "B"]);
    const K = `rv-${stamp}-race-0004`;
    const d = { ...draftOf(g), key: `off-${K}` };
    keys.push(d.key, K);
    const r = await sendDraft(d, g.ids[0], { rateOn: sameRate });
    expect(r.status).toBe("added");
    const again = await onlineSave(g, K, "1200");
    expect(again).toEqual({ ok: true, id: r.status === "added" ? r.id : "" });
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(1);
  });
  it("if the online save with K lands in between, the phone's copy fails cleanly and is told the id of the one that is there", async () => {
    const g = await mkGroup(["A", "B"]);
    const K = `rv-${stamp}-race-0005`;
    keys.push(`off-${K}`, K);
    // The phone's copy has already looked (K was free); the online save commits; then the copy saves.
    const online = await onlineSave(g, K, "1200");
    const second = await saveExpense(
      { groupId: g.id, name: "Taxi", amount: "1200", currency: "INR", category: "", paidById: g.ids[0], forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", requestKey: `off-${K}` },
      g.ids[0],
      sameRate,
      { requestKey: `off-${K}`, alsoKey: K },
    );
    expect(second).toEqual({ ok: true, id: online.ok ? online.id : "" });
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(1);
    expect(await db.requestKey.count({ where: { key: `off-${K}` } })).toBe(0); // nothing half-claimed
  });
});

describe("POST /api/offline/status", () => {
  it("also sees the original key: the same expense is done, an edited one keeps waiting, another person's group is never revealed", async () => {
    const status = await import("@/app/api/offline/status/route");
    const g = await mkGroup(["A", "B"]);
    const other = await mkGroup(["X", "Y"]);
    const K1 = `rv-${stamp}-stat-0006`;
    const K2 = `rv-${stamp}-stat-0007`;
    const K3 = `rv-${stamp}-stat-0008`;
    const one = await onlineSave(g, K1, "1200");
    await onlineSave(g, K2, "1200", "Lunch");
    await onlineSave(other, K3, "1200");
    state.cookie = await guestCookie(g.id, g.ids[0]);
    const body = {
      keys: [`off-${K1}`, `off-${K2}`, `off-${K3}`],
      typed: { [`off-${K1}`]: typedOf("1200"), [`off-${K2}`]: typedOf("1500", "Lunch"), [`off-${K3}`]: typedOf("1200") },
    };
    const res = await status.POST(new NextRequest("http://loopin.test/api/offline/status", { method: "POST", headers: { "content-type": "application/json", origin: "http://loopin.test", "x-forwarded-host": "loopin.test" }, body: JSON.stringify(body) }));
    expect(await res.json()).toEqual({ done: { [`off-${K1}`]: one.ok ? one.id : "" } });
  });
});

describe("an ordinary online save is exactly as before", () => {
  it("a normal key and a past date: THB 1,000 on 10 Nov uses TODAY's rate 9 (100000 x 9 = 900000), not 10 Nov's 2.5", async () => {
    const g = await mkGroup(["A", "B"], { accountFor: ["A", "B"] });
    const a = await db.member.findUniqueOrThrow({ where: { id: g.ids[0] } });
    state.cookie = await accountCookie(a.accountId as string);
    await A.addExpense({
      groupId: g.id, name: "Dinner", amount: "1000", currency: "THB", category: "", paidById: g.ids[0], forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {},
      paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", date: "2026-11-10", requestKey: `rv-${stamp}-online-0009`,
    }).catch((e: Error) => {
      if (!/^NEXT_REDIRECT/.test(e.message)) throw e;
    });
    keys.push(`rv-${stamp}-online-0009`);
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id }, include: { shares: true } });
    expect(e.amount).toBe(900000);
    expect(e.exchangeRate).toBe("9");
    expect(e.shares.map((x) => x.amount)).toEqual([450000, 450000]);
  });
});
