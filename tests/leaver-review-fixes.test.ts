import { afterAll, describe, expect, it, vi } from "vitest";

// Review findings on Safety part C, checked against a throwaway database:
//  1. a person back in the group with no "came back" line is counted as back from the first thing they did themselves after leaving;
//  2. tapping "rejoin" twice writes one line;
//  3. changing a reaction's emoji counts as reacting now.

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test" }),
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

const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const { joinNew } = await import("@/lib/join");
const { memberHistory } = await import("@/lib/left-view-db");
const { membershipSpan, overlapped } = await import("@/lib/left-view");
const { reactAction } = await import("@/app/reaction-actions");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let counter = 0;
const groupIds: string[] = [];
const accountIds: string[] = [];
const day = (s: string) => new Date(`${s}T10:00:00Z`);
const DAY = 86_400_000;

async function account(label: string, n: number) {
  const a = await db.account.create({ data: { email: `lrf-${label.toLowerCase()}-${n}-${stamp}@example.test`, name: label } });
  accountIds.push(a.id);
  return a;
}
async function world(over: { asha?: object; ravi?: object } = {}) {
  const n = ++counter;
  const [asha, ravi, meera] = await Promise.all([account("Asha", n), account("Ravi", n), account("Meera", n)]);
  const g = await db.group.create({
    data: {
      name: `LRF ${n} ${stamp}`, inviteCode: `lrf-${n}-${stamp}`, currency: "INR", type: "trip",
      members: {
        create: [
          { name: "Meera", accountId: meera.id, claimedAt: day("2026-01-01"), createdAt: day("2026-01-01") },
          { name: "Asha", accountId: asha.id, claimedAt: day("2026-01-05"), createdAt: day("2026-01-05"), ...over.asha },
          { name: "Ravi", accountId: ravi.id, claimedAt: day("2026-03-01"), createdAt: day("2026-03-01"), ...over.ravi },
        ],
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const row = (name: string) => g.members.find((m) => m.name === name)!;
  return { g, asha, ravi, meera, row };
}
const line = (groupId: string, actorId: string, kind: string, createdAt: Date) =>
  db.groupEvent.create({ data: { groupId, actorId, kind, text: kind, createdAt, undo: kind.startsWith("member_") ? JSON.stringify({ type: "member_set", memberId: actorId, data: { leftAt: null } }) : null } });

afterAll(async () => {
  state.cookie = "";
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("1: back in the group with no 'came back' line", () => {
  // Asha 5-20 Jan, in the group again (leftAt cleared) but only a "left" line exists. Ravi was in 1-30 Mar.
  // Her first own line after leaving is an expense on 10 Mar: that is when she was back, so she overlapped Ravi (10-30 Mar).
  it("the stay starts at her first own line after she left; with none it starts now and nothing is invented", async () => {
    const w = await world({ ravi: { leftAt: day("2026-03-30") } });
    const asha = w.row("Asha");
    await line(w.g.id, asha.id, "member_left", day("2026-01-20"));
    await line(w.g.id, asha.id, "expense_added", day("2026-01-10")); // before she left: doesn't count
    const noOwn = await memberHistory([w.g.id]);
    const now = day("2026-05-05");
    expect(membershipSpan(asha, noOwn.get(asha.id), now).periods![1]).toEqual({ from: now, to: null });
    expect(overlapped(membershipSpan(asha, noOwn.get(asha.id), now), membershipSpan(w.row("Ravi"), noOwn.get(w.row("Ravi").id), now))).toBe(false);

    await line(w.g.id, asha.id, "expense_added", day("2026-03-10"));
    await line(w.g.id, asha.id, "expense_added", day("2026-04-02")); // later lines don't move the start
    const withOwn = await memberHistory([w.g.id]);
    expect(membershipSpan(asha, withOwn.get(asha.id), now).periods![1]).toEqual({ from: day("2026-03-10"), to: null });
    expect(overlapped(membershipSpan(asha, withOwn.get(asha.id), now), membershipSpan(w.row("Ravi"), withOwn.get(w.row("Ravi").id), now))).toBe(true);
  });

  it("someone who is still out is not looked up (their row is left, so nothing is added)", async () => {
    const w = await world({ asha: { leftAt: day("2026-01-20") } });
    const asha = w.row("Asha");
    await line(w.g.id, asha.id, "member_left", day("2026-01-20"));
    await line(w.g.id, asha.id, "expense_added", day("2026-03-10"));
    expect((await memberHistory([w.g.id])).get(asha.id)!.map((c) => c.kind)).toEqual(["member_left"]);
  });
});

describe("2: tapping rejoin twice writes one line", () => {
  it("two taps at once: one 'rejoined' line, both taps end with her in the group", async () => {
    const w = await world({ asha: { leftAt: new Date(Date.now() - 5 * DAY) } });
    const account = { id: w.asha.id, name: "Asha", email: w.asha.email };
    const [a, b] = await Promise.all([joinNew(w.g.inviteCode, account, ""), joinNew(w.g.inviteCode, account, "")]);
    expect(await db.groupEvent.count({ where: { groupId: w.g.id, kind: "member_rejoined" } })).toBe(1);
    expect((await db.member.findUniqueOrThrow({ where: { id: w.row("Asha").id } })).leftAt).toBeNull();
    expect([a.ok, b.ok].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    // A third tap, later: already back, no new line.
    expect((await joinNew(w.g.inviteCode, account, "")).ok).toBe(true);
    expect(await db.groupEvent.count({ where: { groupId: w.g.id, kind: "member_rejoined" } })).toBe(1);
  });

  it("someone who was removed in the meantime is not put back", async () => {
    const w = await world({ asha: { leftAt: new Date(Date.now() - 5 * DAY), removedAt: new Date(), removedById: "admin" } });
    const r = await joinNew(w.g.inviteCode, { id: w.asha.id, name: "Asha", email: w.asha.email }, "");
    expect(r.ok).toBe(false);
    expect(await db.groupEvent.count({ where: { groupId: w.g.id, kind: "member_rejoined" } })).toBe(0);
  });
});

describe("3: changing a reaction's emoji counts as reacting now", () => {
  it("a reaction made 10 days ago and changed today is dated today, so someone who left 5 days ago doesn't see the new one", async () => {
    const w = await world();
    const meera = w.row("Meera");
    const e = await db.expense.create({
      data: { groupId: w.g.id, description: "Dinner", amount: 3000, originalAmount: 3000, convertedAmount: 3000, splitType: "equal", paidById: w.row("Asha").id, createdById: w.row("Asha").id, shares: { create: [{ memberId: meera.id, amount: 1500 }, { memberId: w.row("Asha").id, amount: 1500 }] } },
    });
    state.cookie = await encodeSession({ m: { [w.g.id]: meera.id }, t: today() });
    const react = async (emoji: string) => {
      const f = new FormData();
      f.set("expenseId", e.id);
      f.set("emoji", emoji);
      try {
        await reactAction(f);
      } catch (err) {
        if (!/^NEXT_REDIRECT/.test(String((err as Error)?.message))) throw err;
      }
    };
    await react("😂");
    await db.reaction.updateMany({ where: { expenseId: e.id }, data: { createdAt: new Date(Date.now() - 10 * DAY) } });
    await react("❤️"); // changed
    const r = await db.reaction.findFirstOrThrow({ where: { expenseId: e.id } });
    expect(r.emoji).toBe("❤️");
    expect(Date.now() - r.createdAt.getTime()).toBeLessThan(60_000);
    // Tapping the same emoji again takes it back (unchanged).
    await react("❤️");
    expect(await db.reaction.count({ where: { expenseId: e.id } })).toBe(0);
  });
});
