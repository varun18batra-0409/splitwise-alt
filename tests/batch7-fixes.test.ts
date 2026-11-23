import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// Batch 7 review fixes. Throwaway database only; whole units, worked by hand in each test.
// Two things are mocked: the cookie (so a person is signed in), and the flash link (so the error sentence can be read from the redirect).

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", "x-forwarded-for": `10.97.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
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
vi.mock("@/lib/flash", async (orig) => ({
  ...(await orig<typeof import("@/lib/flash")>()),
  flashTo: async (path: string | string[], notes: Record<string, string>, extra?: Record<string, string>) => {
    const p = Array.isArray(path) ? `/${path.join("/")}` : path;
    const q = new URLSearchParams(extra ?? {});
    for (const [k, v] of Object.entries(notes)) q.set(k, v);
    return `${p}?${q}`;
  },
}));
// An import line that comes to 3,000,000,000 (as if two payers' parts were added): only the line described "Huge".
vi.mock("@/lib/splitwise-csv", async (orig) => {
  const real = await orig<typeof import("@/lib/splitwise-csv")>();
  return {
    ...real,
    planRow: (row: Parameters<typeof real.planRow>[0]) => {
      const p = real.planRow(row);
      return row.description === "Huge" && p.type !== "payment"
        ? { ...p, amount: 3_000_000_000, payers: [{ i: 0, a: 3_000_000_000 }], shares: [{ i: 0, a: 1_500_000_000 }, { i: 1, a: 1_500_000_000 }] }
        : p;
    },
  };
});

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { encodeSession, today } = await import("@/lib/session");
const A = await import("@/app/actions");
const P = await import("@/app/pay-actions");
const { planKey } = await import("@/lib/settle-all");
const { loadGroup } = await import("@/lib/group-data");
const { payLinkFor, readPayLink, recordLinkPayment } = await import("@/lib/pay-link");
const { importSplitwise } = await import("@/lib/splitwise-import");
const { convertWaitingClaims } = await import("@/lib/convert-claims");
const { paymentTooBigText } = await import("@/lib/payments");
const { STALE_KEY_ERROR } = await import("@/lib/once");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;
afterAll(async () => {
  state.cookie = "";
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function redirectOf(fn: () => Promise<unknown>): Promise<URL> {
  try {
    await fn();
  } catch (err) {
    const m = /^NEXT_REDIRECT (.*)$/.exec(String((err as Error)?.message));
    if (!m) throw err;
    return new URL(m[1], "http://loopin.test");
  }
  throw new Error("expected a redirect");
}
async function account(name: string) {
  const a = await db.account.create({ data: { email: `b7f-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}

// A VND group where Asha paid two bills for Ravi alone: 1,500,000,000 + 900,000,000. Ravi owes Asha 2,400,000,000 (one suggested transfer).
async function bigDebt(amounts: number[] = [1_500_000_000, 900_000_000]) {
  const asha = await account("Asha"); // Asha has an account, so she may record other people's payments
  const g = await db.group.create({
    data: { name: `B7F ${++n} ${stamp}`, type: "trip", currency: "VND", inviteCode: `b7f-${n}-${stamp}`, members: { create: [{ name: "Asha", accountId: asha.id, createdAt: new Date(2026, 0, 1), claimedAt: new Date() }, { name: "Ravi", createdAt: new Date(2026, 0, 2), claimedAt: new Date() }] } },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (m: string) => g.members.find((x) => x.name === m)!.id;
  for (const amount of amounts) {
    await db.expense.create({
      data: { groupId: g.id, description: "Bill", amount, splitType: "exact", forMode: "selected", paidById: id("Asha"), createdById: id("Asha"), originalAmount: amount, convertedAmount: amount, originalCurrency: "VND", baseCurrency: "VND", shares: { create: [{ memberId: id("Ravi"), amount }] } },
    });
  }
  return { gid: g.id, asha: id("Asha"), ravi: id("Ravi"), ashaAccount: asha.id };
}
const written = async (gid: string) => [await db.payment.count({ where: { groupId: gid } }), await db.groupEvent.count({ where: { groupId: gid } })];
const SENTENCE = "That’s more than one payment can record (VND 2,000,000,000). Record it as two payments.";

describe("M1: the payment forms say the payment sentence, not the expense one", () => {
  it("Record a payment of 2,000,000,001 VND (typed with commas) gets the sentence; nothing is written", async () => {
    const w = await bigDebt();
    state.cookie = await encodeSession({ m: { [w.gid]: w.ravi }, t: today() });
    for (const typed of ["2,000,000,001", "2000000001", "2400000000"]) {
      const url = await redirectOf(() => A.recordCustomPayment(form({ currency: "VND", groupId: w.gid, fromId: w.ravi, toId: w.asha, amount: typed })));
      expect(url.pathname).toBe(`/groups/${w.gid}/pay`);
      expect(url.searchParams.get("error"), typed).toBe(SENTENCE);
    }
    expect(await written(w.gid)).toEqual([0, 0]);
    // A typo is still the ordinary message, and exactly the cap is accepted as one payment.
    const typo = await redirectOf(() => A.recordCustomPayment(form({ currency: "VND", groupId: w.gid, fromId: w.ravi, toId: w.asha, amount: "1,2,3" })));
    expect(typo.searchParams.get("error")).toBe("Check the commas: write 123,456 or 123456.");
    expect(await written(w.gid)).toEqual([0, 0]);
  });

  it("exactly 2,000,000,000 VND typed into Record a payment is accepted and writes one payment", async () => {
    const w = await bigDebt();
    state.cookie = await encodeSession({ m: { [w.gid]: w.ravi }, t: today() });
    const url = await redirectOf(() => A.recordCustomPayment(form({ currency: "VND", groupId: w.gid, fromId: w.ravi, toId: w.asha, amount: "2000000000" })));
    expect(url.pathname).toBe(`/groups/${w.gid}`);
    expect(url.searchParams.get("error")).toBeNull();
    const pays = await db.payment.findMany({ where: { groupId: w.gid } });
    expect(pays.map((p) => [p.fromId, p.toId, p.amount])).toEqual([[w.ravi, w.asha, 2_000_000_000]]);
    // Ravi owed 2,400,000,000: 400,000,000 is left.
    const after = await loadGroup(w.gid, { events: false });
    expect(after!.transfers).toEqual([{ from: w.ravi, to: w.asha, amount: 400_000_000 }]);
  });

  it("Mark all paid with a hidden 2,400,000,000 transfer gets the sentence; nothing is written", async () => {
    const w = await bigDebt();
    // Asha's name is linked to her account, so she is signed in through the account (a guest copy of a linked name doesn't count).
    state.cookie = await encodeSession({ m: {}, a: w.ashaAccount, v: 0, t: today() });
    const data = await loadGroup(w.gid, { events: false });
    expect(data!.transfers).toEqual([{ from: w.ravi, to: w.asha, amount: 2_400_000_000 }]);
    const url = await redirectOf(() => P.markAllPaidAction(form({ groupId: w.gid, plan: planKey(data!.transfers) })));
    expect(url.searchParams.get("error")).toBe(SENTENCE);
    expect(await written(w.gid)).toEqual([0, 0]);
  });

  it("the combined Settle up screens have their own notice for it", () => {
    for (const f of ["src/app/settle/page.tsx", "src/app/people/[id]/page.tsx"]) expect(readFileSync(f, "utf8")).toContain("PAYMENT_TOO_BIG_SHORT");
  });
});

describe("L1: the reminder link says the payment sentence", () => {
  it("a 2,400,000,000 debt on the link returns toobig, nothing is recorded; the action shows the sentence", async () => {
    const w = await bigDebt();
    const token = await payLinkFor(w.gid, w.ravi, w.asha, w.ravi);
    const s = await readPayLink(token);
    if (s.kind !== "owes") throw new Error("expected owes");
    expect(s.amount).toBe(2_400_000_000);
    expect(await recordLinkPayment({ link: s.link, amount: s.amount, currency: "VND", toName: "Asha" })).toBe("toobig");
    expect(await written(w.gid)).toEqual([0, 0]);
    expect(readFileSync("src/app/pay-link-actions.ts", "utf8")).toContain('if (done === "toobig") await back(token, { error: paymentTooBigText(s.group.currency) });');
    expect(paymentTooBigText("VND")).toBe(SENTENCE);
  });
});

describe("imports: L2 fingerprint, L3 cap, L4 race, L5 name", () => {
  const FILE = [
    "Date,Description,Category,Cost,Currency,Asha,Ravi",
    "2026-09-01,Dinner,Dining out,1200.00,INR,600.00,-600.00",
    "",
  ].join("\r\n");

  it("L2: the same key with a changed currency or column choice is stale, and no second group appears", async () => {
    const acc = await account("");
    const key = `imp-l2-${stamp}-aaaa`;
    const first = await importSplitwise(acc, { text: FILE, groupName: "L2", type: "trip", me: 0, key });
    if (!first.ok) throw new Error(first.error);
    groupIds.push(first.groupId);
    expect(await importSplitwise(acc, { text: FILE, groupName: "L2", type: "trip", me: 0, key, currency: "USD" })).toEqual({ ok: false, error: STALE_KEY_ERROR });
    expect(await importSplitwise(acc, { text: FILE, groupName: "L2", type: "trip", me: 0, key, map: { date: 0, description: 1, amount: 3, paidBy: 5, split: "everyone" } })).toEqual({ ok: false, error: STALE_KEY_ERROR });
    expect((await importSplitwise(acc, { text: FILE, groupName: "L2", type: "trip", me: 0, key })).ok).toBe(true);
    expect(await db.group.count({ where: { members: { some: { accountId: acc.id } } } })).toBe(1);
  });

  it("L3: a line above the cap is refused with a message, nothing is made", async () => {
    const acc = await account("");
    const text = [FILE.trimEnd(), "2026-09-02,Huge,General,100.00,INR,50.00,-50.00", ""].join("\r\n");
    const r = await importSplitwise(acc, { text, groupName: "Huge", type: "trip", me: 0, key: `imp-l3-${stamp}-bbbb` });
    expect(r).toEqual({ ok: false, error: "A line in this file is more than ₹2,00,00,000, the most Loopin can hold for one expense, so nothing was brought over." });
    expect(await db.group.count({ where: { members: { some: { accountId: acc.id } } } })).toBe(0);
    expect(await db.requestKey.count({ where: { key: { contains: `imp-l3-${stamp}` } } })).toBe(0);
  });

  it("L4: simultaneous requests with the same key (several rounds) all end on the same group, and one group is made each time", async () => {
    for (const round of ["c1", "c2", "c3"]) {
      const acc = await account("");
      const input = { text: FILE, groupName: "Race", type: "trip", me: 0, key: `imp-l4-${round}-${stamp}-cccc` };
      const results = await Promise.all([importSplitwise(acc, input), importSplitwise(acc, input), importSplitwise(acc, input)]);
      const first = results[0];
      if (!first.ok) throw new Error(JSON.stringify(results));
      groupIds.push(first.groupId);
      for (const r of results) expect(r).toEqual(first);
      expect(await db.group.count({ where: { members: { some: { accountId: acc.id } } } })).toBe(1);
    }
    expect(readFileSync("src/lib/splitwise-import.ts", "utf8")).toContain("await withRetry(() => db.$transaction(");
  });

  it("L5: a retry that returns the stored result still names an account that has no name", async () => {
    const acc = await account("");
    const input = { text: FILE, groupName: "Name", type: "trip", me: 0, key: `imp-l5-${stamp}-dddd` };
    const first = await importSplitwise(acc, input);
    if (!first.ok) throw new Error(first.error);
    groupIds.push(first.groupId);
    expect((await db.account.findUniqueOrThrow({ where: { id: acc.id } })).name).toBe("Asha");
    await db.account.update({ where: { id: acc.id }, data: { name: "" } }); // as if the first run stopped before naming it
    const again = await importSplitwise({ id: acc.id, name: "" }, input);
    expect(again).toEqual(first);
    expect((await db.account.findUniqueOrThrow({ where: { id: acc.id } })).name).toBe("Asha");
    // A name that is already there is never overwritten.
    await db.account.update({ where: { id: acc.id }, data: { name: "Someone Else" } });
    await importSplitwise({ id: acc.id, name: "Someone Else" }, input);
    expect((await db.account.findUniqueOrThrow({ where: { id: acc.id } })).name).toBe("Someone Else");
  });
});

describe("L7: an old note above the cap is counted the same in a dry run and a real run", () => {
  it("a waiting note of 2,100,000,000 VND (owed in full) is closed as more-than-owed both ways; no payment is made", async () => {
    // 2,100,000,000 fits the database's Int but is above the 2,000,000,000 cap.
    const w = await bigDebt([2_100_000_000]);
    await db.paymentClaim.create({ data: { groupId: w.gid, fromId: w.ravi, toId: w.asha, amount: 2_100_000_000, currency: "VND", source: "app", status: "waiting", slot: "" } });
    const dry = await convertWaitingClaims({ apply: false, groupIds: [w.gid] });
    expect([dry.converted, dry.expired, dry.failed, dry.reasons]).toEqual([0, 1, 0, { "more-than-owed": 1 }]);
    expect(await db.payment.count({ where: { groupId: w.gid } })).toBe(0);
    const real = await convertWaitingClaims({ apply: true, groupIds: [w.gid] });
    expect([real.converted, real.expired, real.failed, real.reasons]).toEqual([0, 1, 0, { "more-than-owed": 1 }]);
    expect(await db.payment.count({ where: { groupId: w.gid } })).toBe(0);
  });
});
