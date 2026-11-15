import { afterAll, describe, expect, it, vi } from "vitest";

// The screens and the server ask ONE question: canUndo(event, history, now, viewer). So the Undo button is shown exactly when the server
// would allow the undo, and when it would not, the reason on the screen is the server's own words.
//
// The group (amounts in paise): Asha looks after it (first in), Ada, Bea, and Kiran (a name only).
//   Dinner 9000 paid by Ada, 3000 each (Ada, Bea, Asha)  -> Ada +6000, Bea -3000, Asha -3000
//   Taxi   4000 paid by Bea, 2000 each (Bea, Asha)       -> Bea +2000, Asha -2000
//   Bea pays Ada 3000 and Asha pays Ada 3000             -> Ada 0, Bea +2000, Asha -2000   (sum 0)
// Every case gets a fresh group.

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test" }),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { setMemberLeft } = await import("@/lib/people");
const { canUndo, removeMembers, undoEvent, undoViewerFor } = await import("@/lib/undo");
const { netBalances } = await import("@/lib/balances");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
let n = 0;

afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(name: string) {
  const a = await db.account.create({ data: { email: `uv-${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}

async function world() {
  const [asha, ada, bea] = [await account("Asha"), await account("Ada"), await account("Bea")];
  const g = await db.group.create({
    data: {
      name: `Undo viewer ${++n} ${stamp}`, type: "trip", currency: "INR", inviteCode: `uv-${n}-${stamp}`,
      members: {
        create: [
          { name: "Asha", accountId: asha.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) },
          { name: "Ada", accountId: ada.id, claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2) },
          { name: "Bea", accountId: bea.id, claimedAt: new Date(2026, 0, 3), createdAt: new Date(2026, 0, 3) },
          { name: "Kiran", createdAt: new Date(2026, 0, 4) },
        ],
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  const [S, A, B, K] = [id("Asha"), id("Ada"), id("Bea"), id("Kiran")];
  const exp = (description: string, amount: number, paidById: string, split: [string, number][]) =>
    db.expense.create({
      data: {
        groupId: g.id, description, amount, paidById, createdById: paidById, splitType: "equal", forMode: "selected",
        originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount,
        shares: { create: split.map(([memberId, a]) => ({ memberId, amount: a })) },
      },
    });
  await exp("Dinner", 9000, A, [[A, 3000], [B, 3000], [S, 3000]]);
  await exp("Taxi", 4000, B, [[B, 2000], [S, 2000]]);
  await db.payment.create({ data: { groupId: g.id, fromId: B, toId: A, amount: 3000, createdById: B } });
  await db.payment.create({ data: { groupId: g.id, fromId: S, toId: A, amount: 3000, createdById: S } });
  const x = await db.group.findUniqueOrThrow({ where: { id: g.id }, include: { members: true, expenses: { include: { shares: true } }, payments: true } });
  expect(netBalances(x.members.map((m) => m.id), x.expenses, x.payments)).toEqual({ [A]: 0, [B]: 2000, [S]: -2000, [K]: 0 });
  return { g, S, A, B, K };
}

// Asks the screen's rule, then the server's, as the same person, and says they agree. A refusal reads the same on both.
async function agree(groupId: string, eventId: string, memberId: string) {
  const ev = await db.groupEvent.findUniqueOrThrow({ where: { id: eventId } });
  const history = await db.groupEvent.findMany({ where: { groupId, createdAt: { gte: ev.createdAt } } });
  const screen = canUndo(ev, history, new Date(), await undoViewerFor(groupId, memberId));
  const server = await undoEvent(eventId, memberId);
  expect(screen.ok).toBe(server.ok);
  if (!screen.ok && !server.ok) expect(screen.reason).toBe(server.error);
  return { screen, server };
}

const eventOf = (r: { ok: boolean; eventId?: string }) => {
  if (!r.ok || !r.eventId) throw new Error("no event");
  return r.eventId;
};

describe("the Undo button and the server agree", () => {
  it("Ada's own leave: Ada may undo it, Bea and Asha may not", async () => {
    const w = await world();
    const ev = eventOf(await setMemberLeft(w.g.id, w.A, w.A, true));
    const bea = await agree(w.g.id, ev, w.B);
    expect(bea.screen.ok).toBe(false);
    const asha = await agree(w.g.id, ev, w.S);
    expect(asha.screen.ok).toBe(false);
    expect((await db.member.findUniqueOrThrow({ where: { id: w.A } })).leftAt).not.toBeNull(); // nothing changed
    const ada = await agree(w.g.id, ev, w.A);
    expect(ada.screen.ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: w.A } })).leftAt).toBeNull();
  });

  it("Asha removes Ada: Asha may undo it (within 10 minutes), Bea may not, Ada may not (she has left)", async () => {
    const w = await world();
    const ev = eventOf(await setMemberLeft(w.g.id, w.S, w.A, true));
    const bea = await agree(w.g.id, ev, w.B);
    expect(bea.screen.ok).toBe(false);
    const ada = await agree(w.g.id, ev, w.A);
    expect(ada.screen.ok).toBe(false);
    expect(!ada.screen.ok && ada.screen.reason).toMatch(/left/i); // LEFT_ERROR
    expect((await db.member.findUniqueOrThrow({ where: { id: w.A } })).removedAt).not.toBeNull();
    const asha = await agree(w.g.id, ev, w.S);
    expect(asha.screen.ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: w.A } })).removedAt).toBeNull();
  });

  it("Ada rejoins: Bea may not undo that (it would push her out), Ada may", async () => {
    const w = await world();
    expect((await setMemberLeft(w.g.id, w.A, w.A, true)).ok).toBe(true);
    const ev = eventOf(await setMemberLeft(w.g.id, w.A, w.A, false));
    const bea = await agree(w.g.id, ev, w.B);
    expect(bea.screen.ok).toBe(false);
    expect((await db.member.findUniqueOrThrow({ where: { id: w.A } })).leftAt).toBeNull();
    const ada = await agree(w.g.id, ev, w.A);
    expect(ada.screen.ok).toBe(true);
  });

  it("Asha deletes Kiran (a name only): Bea may not undo that, Asha (who looks after the group) may", async () => {
    const w = await world();
    const ev = eventOf(await removeMembers(w.g.id, w.S, [w.K], false));
    expect(await db.member.count({ where: { id: w.K } })).toBe(0);
    const bea = await agree(w.g.id, ev, w.B);
    expect(bea.screen.ok).toBe(false);
    expect(await db.member.count({ where: { id: w.K } })).toBe(0);
    const asha = await agree(w.g.id, ev, w.S);
    expect(asha.screen.ok).toBe(true);
    expect(await db.member.count({ where: { id: w.K } })).toBe(1);
  });

  it("Bea adds an expense after Ada left: Ada (who has left) may not undo it, Bea may", async () => {
    const w = await world();
    expect((await setMemberLeft(w.g.id, w.A, w.A, true)).ok).toBe(true);
    const lunch = await db.expense.create({
      data: {
        groupId: w.g.id, description: "Lunch", amount: 1000, paidById: w.B, createdById: w.B, splitType: "equal", forMode: "selected",
        originalAmount: 1000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 1000, shares: { create: [{ memberId: w.B, amount: 500 }, { memberId: w.S, amount: 500 }] },
      },
    });
    const logged = await db.groupEvent.create({ data: { groupId: w.g.id, actorId: w.B, kind: "expense_added", text: "added Lunch (₹10.00)", expenseId: lunch.id, undo: JSON.stringify({ type: "expense_delete", expenseId: lunch.id }), touches: `${w.B},${w.S}` } });
    const ada = await agree(w.g.id, logged.id, w.A);
    expect(ada.screen.ok).toBe(false);
    expect((await db.expense.findUniqueOrThrow({ where: { id: lunch.id } })).deletedAt).toBeNull();
    const bea = await agree(w.g.id, logged.id, w.B);
    expect(bea.screen.ok).toBe(true);
    expect((await db.expense.findUniqueOrThrow({ where: { id: lunch.id } })).deletedAt).not.toBeNull();
  });
});
