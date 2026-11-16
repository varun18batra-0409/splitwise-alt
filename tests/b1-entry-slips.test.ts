import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { markupBox, markupBoxStart, markupBoxValue, type MarkupBoxState } from "@/lib/markup-box";
import { parsePercent } from "@/lib/money";
import { recordButtonText } from "@/lib/pay-words";

// Money batch B1, part 2: small slips at the point of entry. Everything is in paise (or cents), worked by hand.
// The first and fourth groups are pure; the rest need the test database (below the marker).

// Type what the reducer would see, one key at a time.
const typeIn = (state: MarkupBoxState, ...texts: string[]) => texts.reduce((s, t) => markupBox(s, { type: "type", text: t }), state);

describe("1. CA-1: the custom card-fee box keeps what is typed", () => {
  it("typing 3, 3. and 3.5 keeps the box filled, and ends as 3.5% = 350 basis points", () => {
    const start = markupBoxStart("group", "");
    const one = typeIn(start, "3");
    expect(markupBoxValue(one)).toBe("3"); // the old box blanked here, because "3" is also the 3% chip
    const two = typeIn(one, "3.");
    expect(markupBoxValue(two)).toBe("3.");
    const three = typeIn(two, "3.5");
    expect(three).toEqual({ choice: "custom", custom: "3.5", box: "3.5" });
    expect(markupBoxValue(three)).toBe("3.5");
    expect(parsePercent(three.custom)).toBe(350);
  });

  it("2 then 20 is 2000 basis points; 2.75 is 275", () => {
    expect(parsePercent(typeIn(markupBoxStart("group", ""), "2", "20").custom)).toBe(2000);
    expect(parsePercent(typeIn(markupBoxStart("group", ""), "2.75").custom)).toBe(275);
  });

  it("tapping a chip lights the chip and empties the box; None and Default change only the choice", () => {
    const typed = typeIn(markupBoxStart("group", ""), "3.5");
    const chip = markupBox(typed, { type: "chip", percent: "3" });
    expect(chip).toEqual({ choice: "custom", custom: "3", box: "" });
    expect(markupBoxValue(chip)).toBe("");
    expect(markupBox(typed, { type: "none" })).toEqual({ choice: "none", custom: "3.5", box: "3.5" });
    expect(markupBoxValue(markupBox(typed, { type: "none" }))).toBe(""); // not custom: the box is blank
    expect(markupBox(typed, { type: "group" }).choice).toBe("group");
  });

  it("an expense that was saved with a custom fee that is not a chip opens with it in the box; a chip value opens with the box empty", () => {
    expect(markupBoxStart("custom", "3.5")).toEqual({ choice: "custom", custom: "3.5", box: "3.5" });
    expect(markupBoxStart("custom", "3")).toEqual({ choice: "custom", custom: "3", box: "" });
    expect(markupBoxStart("group", "")).toEqual({ choice: "group", custom: "", box: "" });
  });
});

describe("4. CA-6: the two unused components are gone, and the pay button reads the amount as it is typed", () => {
  it("recordButtonText reads a comma as a decimal point only when it can be one", () => {
    expect(recordButtonText("2,50", "INR")).toBe("Record ₹2.50");
    expect(recordButtonText("2,500", "INR")).toBe("Record ₹2,500");
    expect(recordButtonText("", "INR")).toBe("Record payment");
  });
  it("AmountEcho.tsx and BalanceMeter.tsx are deleted and nothing imports them", () => {
    expect(existsSync("src/components/AmountEcho.tsx")).toBe(false);
    expect(existsSync("src/components/BalanceMeter.tsx")).toBe(false);
    for (const f of ["src/components/AddExpenseForm.tsx", "src/components/RecordPaymentForm.tsx", "src/app/groups/[id]/pay/page.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/AmountEcho|BalanceMeter|PayAmountField/);
    }
  });
});

describe("5. OA-6: the upgrade script no longer clears request keys after 7 days", () => {
  it("prisma/upgrade-data.mjs has no requestKey clean-up; the daily job keeps keys 30 days", () => {
    expect(readFileSync("prisma/upgrade-data.mjs", "utf8")).not.toContain("requestKey.deleteMany");
    const daily = readFileSync("src/app/api/cron/daily/route.ts", "utf8");
    const line = daily.split("\n").find((l) => l.includes('"cleanup-keys"'))!;
    expect(line).toContain("30 * 86_400_000");
  });
});

// @db-begin (everything below needs the test database)
const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", "x-forwarded-for": `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
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
const { saveExpense } = await import("@/lib/save-expense");
const { overKey } = await import("@/lib/pay-record");
const { countOut, finishGame } = await import("@/lib/pot-db");
const { checkBooks } = await import("./helpers/money-invariants");
const A = await import("@/app/actions");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let counter = 0;
const groupIds: string[] = [];
afterAll(async () => {
  state.cookie = "";
  await eraseGroups(groupIds);
});

async function world(label: string, names: string[]) {
  const n = ++counter;
  const g = await db.group.create({
    data: {
      name: `B1s ${label} ${n}`, type: "trip", currency: "INR", inviteCode: `b1s-${n}-${stamp}`,
      members: { create: names.map((name, i) => ({ name, splitWeight: 100, createdAt: new Date(2026, 0, i + 1), claimedAt: new Date(2026, 0, i + 1) })) },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  return { gid: g.id, id: (name: string) => g.members.find((m) => m.name === name)!.id };
}
type World = Awaited<ReturnType<typeof world>>;
const as = async (w: World, memberId: string) => {
  state.cookie = await encodeSession({ m: { [w.gid]: memberId }, t: today() });
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
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const rate = async () => ({ ok: true as const, rate: "1", date: "2026-11-16" });

describe("1 (saved). CA-1: the custom fee typed in the box is what is charged", () => {
  const draft = (w: World, custom: string) => ({
    groupId: w.gid, name: "Hotel", category: "", amount: "1000", currency: "USD", paidById: w.id("Asha"), forMode: "everyone" as const, selected: [], onePersonId: "",
    splitType: "equal" as const, exact: {}, percent: {}, paymentMethod: "card" as const, markupChoice: "custom" as const, markupCustom: custom, rateMode: "auto" as const, manualRate: "",
  });
  it("USD 1000 at rate 1 on a card with 3.5%: fee 3500, total 103500, 51750 each; with 20%: fee 20000, total 120000", async () => {
    const w = await world("fee", ["Asha", "Ravi"]);
    const first = await saveExpense(draft(w, "3.5"), w.id("Asha"), rate);
    if (!first.ok) throw new Error(first.error);
    const e = await db.expense.findUniqueOrThrow({ where: { id: first.id }, include: { shares: true } });
    expect([e.markupBp, e.markupAmount, e.amount]).toEqual([350, 3500, 103500]); // 100000 x 350 / 10000 = 3500
    expect(e.shares.map((s) => s.amount).sort()).toEqual([51750, 51750]);
    const second = await saveExpense({ ...draft(w, "20"), name: "Hotel 2" }, w.id("Asha"), rate);
    if (!second.ok) throw new Error(second.error);
    const f = await db.expense.findUniqueOrThrow({ where: { id: second.id } });
    expect([f.markupBp, f.markupAmount, f.amount]).toEqual([2000, 20000, 120000]); // 100000 x 2000 / 10000 = 20000
    await checkBooks(w.gid);
  });
});

describe("2. CB-1: 'Record anyway' only counts for the amount it was shown for", () => {
  // Asha paid 1000000 for Asha and Nupur, 500000 each: Nupur owes Asha 500000. The most Nupur can pay Asha is 500000.
  async function setup() {
    const w = await world("over", ["Asha", "Nupur"]);
    await db.expense.create({
      data: {
        groupId: w.gid, description: "Stay", amount: 1_000_000, paidById: w.id("Asha"), createdById: w.id("Asha"), splitType: "exact", forMode: "selected", category: "other",
        originalAmount: 1_000_000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 1_000_000,
        shares: { create: [{ memberId: w.id("Asha"), amount: 500_000 }, { memberId: w.id("Nupur"), amount: 500_000 }] },
      },
    });
    await as(w, w.id("Nupur"));
    return w;
  }

  it("overKey says payer, person paid and amount", () => {
    expect(overKey("nupur", "asha", 50_000_000)).toBe("nupur>asha:50000000");
    expect(overKey("nupur", "asha", 5_000_000)).not.toBe(overKey("nupur", "asha", 50_000_000));
  });

  it("an extra zero typed after the warning is asked about again; the same amount goes through; a bare over=1 is asked again", async () => {
    const w = await setup();
    const [N, As] = [w.id("Nupur"), w.id("Asha")];
    // The warning was shown for ₹50,000 (5000000 paise); the person then edited the amount to ₹5,00,000 (50000000) and tapped Record anyway.
    const typo = await redirectOf(() => A.recordCustomPayment(form({ groupId: w.gid, fromId: N, toId: As, amount: "500000", over: "1", overFor: overKey(N, As, 5_000_000) })));
    expect(typo.pathname).toBe(`/groups/${w.gid}/pay`);
    expect(typo.searchParams.get("owes")).toBe("500000");
    expect(await db.payment.count({ where: { groupId: w.gid } })).toBe(0);
    // An old or hand-made "over=1" with no overFor is asked again too.
    const bare = await redirectOf(() => A.recordCustomPayment(form({ groupId: w.gid, fromId: N, toId: As, amount: "500000", over: "1" })));
    expect(bare.pathname).toBe(`/groups/${w.gid}/pay`);
    expect(await db.payment.count({ where: { groupId: w.gid } })).toBe(0);
    // The same amount the warning was shown for: recorded.
    const ok = await redirectOf(() => A.recordCustomPayment(form({ groupId: w.gid, fromId: N, toId: As, amount: "500000", over: "1", overFor: overKey(N, As, 50_000_000) })));
    expect(ok.pathname).toBe(`/groups/${w.gid}`);
    const pays = await db.payment.findMany({ where: { groupId: w.gid } });
    expect(pays.map((p) => [p.fromId, p.toId, p.amount])).toEqual([[N, As, 50_000_000]]);
  });

  it("an amount within what is owed still records straight away, with no key", async () => {
    const w = await setup();
    const ok = await redirectOf(() => A.recordCustomPayment(form({ groupId: w.gid, fromId: w.id("Nupur"), toId: w.id("Asha"), amount: "5000" })));
    expect(ok.pathname).toBe(`/groups/${w.gid}`);
    expect(await db.payment.count({ where: { groupId: w.gid } })).toBe(1);
  });
});

describe("3. CB-4: counting the money twice does not count it twice", () => {
  // Asha and Ravi each took 50000 (100000 in the game). Asha counts 80000 and Ravi 20000: Asha +30000, Ravi -30000.
  async function game(label: string) {
    const w = await world(label, ["Asha", "Ravi"]);
    const [As, R] = [w.id("Asha"), w.id("Ravi")];
    const g = await db.potGame.create({ data: { groupId: w.gid, name: "Friday teen patti", players: JSON.stringify([As, R]), hostId: As } });
    await db.potMove.createMany({ data: [As, R].map((memberId) => ({ gameId: g.id, memberId, kind: "take", amount: 50_000, createdById: As })) });
    return { w, As, R, gameId: g.id, entries: [{ memberId: As, amount: "800" }, { memberId: R, amount: "200" }] };
  }
  const returns = (gameId: string) => db.potMove.count({ where: { gameId, kind: "return", deletedAt: null } });

  it("count #1 is still reading when the same rows are counted by #2: #2 is saved, #1 is told someone changed the game, exactly 2 return lines; finishing gives Asha +30000, Ravi -30000", async () => {
    const x = await game("race");
    const first = await countOut(x.gameId, x.As, x.entries, false, {
      afterRead: async () => void expect((await countOut(x.gameId, x.As, x.entries, false)).ok).toBe(true),
    });
    expect(first).toEqual({ ok: false, error: "Someone just changed this game. Check the amounts and try again." });
    expect(await returns(x.gameId)).toBe(2);
    expect((await finishGame(x.gameId, x.As)).ok).toBe(true);
    const net = await checkBooks(x.w.gid);
    expect([net[x.As], net[x.R]]).toEqual([30_000, -30_000]);
  });

  it("the same form sent twice (same key) is counted once, and the second answer is still ok", async () => {
    const x = await game("key");
    const k = `b1s-count-${stamp}-${++counter}-abcdefgh`;
    const first = await countOut(x.gameId, x.As, x.entries, false, {
      afterRead: async () => void expect((await countOut(x.gameId, x.As, x.entries, false, {}, { requestKey: k })).ok).toBe(true),
    }, { requestKey: k });
    expect(first).toEqual({ ok: true, finished: false, gap: false });
    expect(await returns(x.gameId)).toBe(2); // one set of lines, not two
    expect(await db.requestKey.count({ where: { key: k } })).toBe(1);
  });

  it("a double tap AFTER the count and finish went through gets the first answer back (finished), not 'this game is finished'; nothing is added", async () => {
    const x = await game("after");
    const k = `b1s-after-${stamp}-${++counter}-abcdefgh`;
    const first = await countOut(x.gameId, x.As, x.entries, true, {}, { requestKey: k });
    expect(first).toEqual({ ok: true, finished: true, gap: false });
    expect(await returns(x.gameId)).toBe(2);
    const again = await countOut(x.gameId, x.As, x.entries, true, {}, { requestKey: k });
    expect(again).toEqual({ ok: true, finished: true, gap: false });
    expect(await returns(x.gameId)).toBe(2);
    expect(await db.expense.count({ where: { groupId: x.w.gid, kind: "pot", deletedAt: null } })).toBe(1);
    const net = await checkBooks(x.w.gid);
    expect([net[x.As], net[x.R]]).toEqual([30_000, -30_000]);
    // Without the key the same request is honestly refused: the game is finished.
    expect((await countOut(x.gameId, x.As, x.entries, true)).ok).toBe(false);
  });

  it("a count that did not add up is answered the same way when repeated (counted, gap), and the repeat adds nothing", async () => {
    const x = await game("gap");
    const k = `b1s-gap-${stamp}-${++counter}-abcdefgh`;
    const rows = [{ memberId: x.As, amount: "800" }, { memberId: x.R, amount: "100" }]; // 90000 back, 100000 went in: 10000 missing
    expect(await countOut(x.gameId, x.As, rows, true, {}, { requestKey: k })).toEqual({ ok: true, finished: false, gap: true });
    expect(await countOut(x.gameId, x.As, rows, true, {}, { requestKey: k })).toEqual({ ok: true, finished: false, gap: true });
    expect(await returns(x.gameId)).toBe(2);
  });

  it("after a count the screen is given a new key (a new count from it is accepted): Asha counted under one key, Ravi under the next", async () => {
    const x = await game("fresh");
    const k1 = `b1s-fresh1-${stamp}-${++counter}-abcdefgh`;
    const k2 = `b1s-fresh2-${stamp}-${++counter}-abcdefgh`;
    expect((await countOut(x.gameId, x.As, [x.entries[0]], false, {}, { requestKey: k1 })).ok).toBe(true);
    expect((await countOut(x.gameId, x.As, [x.entries[1]], false, {}, { requestKey: k2 })).ok).toBe(true);
    expect(await returns(x.gameId)).toBe(2);
    // The screen side: the redirect carries a new number, and the count form is built afresh by it (a new mount makes a new key).
    expect(readFileSync("src/app/pot-actions.ts", "utf8")).toMatch(/const n = String\(Date\.now\(\)\);[\s\S]*finished: "1", n/);
    expect(readFileSync("src/app/groups/[id]/pot/[gameId]/page.tsx", "utf8")).toContain('key={`${live.length}-${sp.n ?? ""}`}');
  });

  it("a key reused for a different count is a stale screen: nothing is added", async () => {
    const x = await game("stale");
    const k = `b1s-stale-${stamp}-${++counter}-abcdefgh`;
    expect((await countOut(x.gameId, x.As, [x.entries[0]], false, {}, { requestKey: k })).ok).toBe(true);
    const again = await countOut(x.gameId, x.As, [x.entries[1]], false, {}, { requestKey: k });
    expect(again.ok).toBe(false);
    expect(await returns(x.gameId)).toBe(1);
  });
});
