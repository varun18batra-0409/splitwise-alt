import { afterAll, describe, expect, it, vi } from "vitest";

// UISEQ-06: the shareable "All square" picture is only made when the group really is square (nobody owes anybody,
// and there is at least one expense). Otherwise 409, and never cached.
//
// Fixtures: A paid 90000 for A, B and C (30000 each) so B and C owe A -> not square.
//           An empty group -> not square (nothing has happened).
const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test" }),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const { isSquare } = await import("@/lib/square");
const route = await import("@/app/groups/[id]/square-image/route");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groups: string[] = [];
afterAll(async () => {
  await db.expenseShare.deleteMany({ where: { expense: { groupId: { in: groups } } } });
  await db.expense.deleteMany({ where: { groupId: { in: groups } } });
  await db.group.deleteMany({ where: { id: { in: groups } } });
});

async function make(tag: string, withExpense: boolean) {
  const g = await db.group.create({
    data: { name: `Square ${tag} ${stamp}`, inviteCode: `sq-${tag}-${stamp}`, currency: "INR", members: { create: [{ name: "A" }, { name: "B" }, { name: "C" }] } },
    include: { members: true },
  });
  groups.push(g.id);
  const [a, b, c] = ["A", "B", "C"].map((n) => g.members.find((m) => m.name === n)!.id);
  if (withExpense) {
    await db.expense.create({
      data: { groupId: g.id, description: "Dinner", splitType: "equal", amount: 90000, originalAmount: 90000, convertedAmount: 90000, paidById: a, createdById: a, shares: { create: [a, b, c].map((memberId) => ({ memberId, amount: 30000 })) } },
    });
  }
  state.cookie = await encodeSession({ m: { [g.id]: a }, t: today() });
  return { id: g.id, a, b, c };
}
const get = (id: string) => route.GET(new Request(`https://loopin.test/groups/${id}/square-image`), { params: Promise.resolve({ id }) });

describe("the All square picture", () => {
  it("is refused (409, not cached) while someone still owes", async () => {
    const g = await make("owing", true);
    const res = await get(g.id);
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("is refused (409) for a group with no expenses at all", async () => {
    const g = await make("empty", false);
    const res = await get(g.id);
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("the rule: no transfers and at least one expense", () => {
    expect(isSquare({ transfers: [], expenses: [{}] })).toBe(true);
    expect(isSquare({ transfers: [], expenses: [] })).toBe(false);
    expect(isSquare({ transfers: [{}], expenses: [{}] })).toBe(false);
  });
});
