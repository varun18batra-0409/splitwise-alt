import { afterAll, describe, expect, it, vi } from "vitest";
import { formCurrencyRefusal, FORM_OUT_OF_DATE } from "@/lib/form-currency";
import { CURRENCY_CHANGED } from "@/lib/offline/words";

// M3: a page drawn in one currency must not save amounts in another. The page carries its currency in a hidden field; the action refuses
// when it is missing (a page opened before this change: one calm refusal) or is not the group's currency now.

describe("the currency a form was drawn in", () => {
  it("the same currency is fine; another one gets the usual words; none at all means the page is out of date", () => {
    expect(formCurrencyRefusal("INR", "INR")).toBeNull();
    expect(formCurrencyRefusal("USD", "INR")).toBe(CURRENCY_CHANGED);
    expect(formCurrencyRefusal("", "INR")).toBe(FORM_OUT_OF_DATE);
    expect(formCurrencyRefusal(null, "INR")).toBe("This page is out of date. Open it again.");
  });
});

// @db-begin (everything below needs the test database)
const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", "x-forwarded-for": `10.98.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
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

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { encodeSession, today } = await import("@/lib/session");
const A = await import("@/app/actions");
const { checkBooks } = await import("./helpers/money-invariants");

const groupIds: string[] = [];
afterAll(async () => {
  state.cookie = "";
  await eraseGroups(groupIds);
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

describe("a form opened before the group's currency changed", () => {
  async function world() {
    const g = await db.group.create({
      data: { name: `M3 ${Date.now()}`, type: "trip", currency: "INR", inviteCode: `m3-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, members: { create: [{ name: "Asha", createdAt: new Date(2026, 0, 1), claimedAt: new Date(2026, 0, 1) }, { name: "Ravi", createdAt: new Date(2026, 0, 2), claimedAt: new Date(2026, 0, 2) }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    const id = (n: string) => g.members.find((m) => m.name === n)!.id;
    // Dinner 1,000.00 rupees (100,000 paise) paid by Asha, shared equally: Ravi owes 50,000.
    await db.expense.create({
      data: {
        groupId: g.id, description: "Dinner", amount: 100000, paidById: id("Asha"), createdById: id("Asha"), splitType: "equal", forMode: "everyone", category: "food",
        originalAmount: 100000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 100000,
        shares: { create: [{ memberId: id("Asha"), amount: 50000 }, { memberId: id("Ravi"), amount: 50000 }] },
      },
    });
    state.cookie = await encodeSession({ m: { [g.id]: id("Ravi") }, t: today() });
    return { gid: g.id, asha: id("Asha"), ravi: id("Ravi") };
  }

  it("a payment page drawn in dollars posts 18.00 after the group went to rupees: refused, no payment saved; the right currency records 18.00 as 1,800 paise", async () => {
    const w = await world();
    const stale = await redirectOf(() => A.recordCustomPayment(form({ currency: "USD", groupId: w.gid, fromId: w.ravi, toId: w.asha, amount: "18.00", back: "settle" })));
    expect(stale.pathname).toBe(`/groups/${w.gid}/settle`);
    expect(await db.payment.count({ where: { groupId: w.gid } })).toBe(0);
    const missing = await redirectOf(() => A.recordCustomPayment(form({ groupId: w.gid, fromId: w.ravi, toId: w.asha, amount: "18.00" })));
    expect(missing.pathname).toBe(`/groups/${w.gid}/pay`);
    expect(await db.payment.count({ where: { groupId: w.gid } })).toBe(0);
    const ok = await redirectOf(() => A.recordCustomPayment(form({ currency: "INR", groupId: w.gid, fromId: w.ravi, toId: w.asha, amount: "18.00" })));
    expect(ok.pathname).toBe(`/groups/${w.gid}`);
    const pays = await db.payment.findMany({ where: { groupId: w.gid } });
    expect(pays.map((p) => p.amount)).toEqual([1800]);
    const net = await checkBooks(w.gid); // Asha +50,000 − 1,800, Ravi −50,000 + 1,800
    expect([net[w.asha], net[w.ravi]]).toEqual([48200, -48200]);
  });
});
