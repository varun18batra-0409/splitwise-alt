import { afterAll, describe, expect, it, vi } from "vitest";
import type { SaveExpenseInput } from "@/lib/save-expense";

// Saving November's bill (dated 30 Nov) is only allowed once that day has come: these run "as of" 1 Dec.
async function asOf<T>(when: Date, run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(when);
  try {
    return await run();
  } finally {
    vi.useRealTimers();
  }
}
// The error text a result carries ("" when it went through), so a failing check shows what the app said.
const errorOf = (r: unknown) => ((r as { ok?: boolean; error?: string }).ok ? "" : String((r as { error?: string }).error ?? JSON.stringify(r)));

// Pausing or stopping a daily bill adds nothing at that moment. The days used so far (up to the day before) are added with the normal
// monthly bill on the 1st; a stop is a pause with an end month, and the bill goes once nothing is left to add.
// Milk is 60 rupees a day = 6,000 paise; flatmates A, B, C share equally and A pays; the bill's time zone is Asia/Kolkata and actions
// happen at 06:00 UTC (11:30 there). After every step the three checks run (checkBooks): the shares add up to each expense, the balances
// add up to 0, and nobody who left is off 0. Every database test ends by settling up through the real payment action, everyone at 0.

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

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { encodeSession, today } = await import("@/lib/session");
const A = await import("@/app/actions");
const B = await import("@/app/bill-actions");
const { billBadge, countedMissed, dailyTotal, dayRangeLabel, isStopped, nextBillLabel, pausedDays, periodsDue, stopDone, stopLines } = await import("@/lib/home/bills");
const { addWaitingBill, billExpenseInput, billFormFingerprint, billStatuses, prepaidFor, runBillsForGroup, stopWordsFor } = await import("@/lib/home/bills-db");
const { billCommand, saveBillFor, toggleMissedDayFor } = await import("@/lib/home/bill-setup");
const { moveOut, moveBackInFor } = await import("@/lib/home/moving-db");
const { dailyPrecharge } = await import("@/lib/home/moving");
const { setExpenseDeleted } = await import("@/lib/save-expense");
const { rejectPayment } = await import("@/lib/payment-ok");
const { recordPaymentCore } = await import("@/lib/pay-record");
const { undoEvent } = await import("@/lib/undo");
const { checkBooks } = await import("./helpers/money-invariants");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
afterAll(async () => {
  state.cookie = "";
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});
const at = (day: string) => new Date(`${day}T06:00:00Z`); // 11:30 in India that day
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function redirected(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    if (/^NEXT_REDIRECT/.test(String((err as Error)?.message))) return;
    throw err;
  }
}

// A flat of A, B and C (D moved in on 15 Nov when `extra`), each with an account, signed in as A. Milk, daily, 6,000 a day, A pays, equal split.
async function flat(label: string, o: { startMonth?: string; extra?: boolean } = {}) {
  const names = ["A", "B", "C", ...(o.extra ? ["D"] : [])];
  const tag = `${label}-${Math.random().toString(36).slice(2, 7)}`;
  const accs = await Promise.all(names.map((n) => db.account.create({ data: { email: `bps-${n}-${tag}-${stamp}@example.test`, name: n } })));
  accountIds.push(...accs.map((x) => x.id));
  const g = await db.group.create({
    data: {
      name: `Flat ${tag}`, type: "home", currency: "INR", inviteCode: `bps-${tag}-${stamp}`,
      members: {
        create: accs.map((x, i) => ({
          name: x.name, accountId: x.id, splitWeight: 100, createdAt: new Date(2026, 0, i + 1), claimedAt: new Date(2026, 0, i + 1),
          ...(x.name === "D" ? { joinedFrom: new Date("2026-11-15T12:00:00Z") } : {}),
        })),
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  const bill = await db.bill.create({
    data: { groupId: g.id, name: "Milk", category: "groceries", nature: "daily", amount: 6000, startMonth: o.startMonth ?? "2026-11", payer: id("A"), split: JSON.stringify({ mode: "equal" }), tz: "Asia/Kolkata" },
  });
  state.cookie = await encodeSession({ m: {}, a: accs[0].id, v: accs[0].sessionVersion, t: today() });
  return { groupId: g.id, a: id("A"), b: id("B"), c: id("C"), d: o.extra ? id("D") : "", billId: bill.id };
}
type Flat = Awaited<ReturnType<typeof flat>>;
const live = (groupId: string) => db.expense.findMany({ where: { groupId, deletedAt: null }, include: { shares: true }, orderBy: { createdAt: "asc" } });
const shareMap = (e: { shares: { memberId: string; amount: number }[] }) => Object.fromEntries(e.shares.map((s) => [s.memberId, s.amount]));
const billOf = (f: Flat) => db.bill.findUniqueOrThrow({ where: { id: f.billId } });
const nets = async (f: Flat) => {
  const n = await checkBooks(f.groupId);
  return [n[f.a], n[f.b], n[f.c]];
};
const rateOk = async () => ({ ok: true as const, rate: "1", date: "2026-11-02" });

// Everyone pays A (the one who paid it all) or is paid by A, through the real payment action; then everyone is at 0.
async function settleUp(f: Flat) {
  const net = await checkBooks(f.groupId);
  for (const [id, n] of Object.entries(net)) {
    if (id === f.a || n === 0) continue;
    const [fromId, toId, paise] = n < 0 ? [id, f.a, -n] : [f.a, id, n];
    await redirected(() => A.recordCustomPayment(form({ currency: "INR", groupId: f.groupId, fromId, toId, amount: String(paise / 100) })));
  }
  const after = await checkBooks(f.groupId);
  expect(Object.values(after).every((x) => x === 0)).toBe(true);
}

// C pays A what he owes, as the app records it. Someone settling up only who is square after it is moved out again, in that same step.
async function payAsC(f: Flat, amount: number, k: string) {
  const r = await recordPaymentCore({ groupId: f.groupId, fromId: f.c, toId: f.a, amount, currency: "INR", myId: f.c, key: `bps-${k}-${stamp}-abcdefgh`, fp: `bps-fp-${k}`, warnOver: false });
  expect(r.kind).toBe("done");
}
const SETTLING_NO_MOVE_OUT = "C is settling up after moving out, and is moved out again as soon as they’re square.";

// ---------- Pure rules, hand-worked ----------
describe("pure rules", () => {
  const paused = { day: 31, every: 1, startMonth: "2026-10", endMonth: "", paused: true, pausedAt: new Date("2026-10-20T06:00:00Z"), tz: "Asia/Kolkata", nature: "daily" };

  it("periodsDue: a paused daily bill still has the month it was paused in, and nothing later", () => {
    expect(periodsDue(paused, at("2026-11-01"))).toEqual(["2026-10"]); // October is over: added on 1 Nov
    expect(periodsDue(paused, at("2026-10-25"))).toEqual([]); // October is not over yet
    expect(periodsDue(paused, at("2026-12-01"))).toEqual([]); // November and December are after the pause
    expect(periodsDue({ ...paused, nature: "fixed" }, at("2026-11-01"))).toEqual([]); // paused non-daily bills: nothing due
    expect(periodsDue({ ...paused, pausedAt: null }, at("2026-11-01"))).toEqual([]); // no pause day: nothing due
    expect(periodsDue({ ...paused, paused: false, pausedAt: null }, at("2026-11-01"))).toEqual(["2026-10"]); // running: as always
  });

  it("pausedDays and countedMissed: from the pause day to the month's end, and every day of later months", () => {
    expect(pausedDays(paused, "2026-09")).toEqual([]);
    expect(pausedDays(paused, "2026-10")).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]); // 12 days
    expect(pausedDays(paused, "2026-11")).toHaveLength(30);
    expect(pausedDays({ ...paused, paused: false }, "2026-10")).toEqual([]);
    // Day 25 is marked and also cut: counted once. 1 marked day (5) + 12 cut days = 13.
    const counted = countedMissed({ ...paused, missed: JSON.stringify({ "2026-10": [5, 25] }) }, "2026-10");
    expect(counted).toEqual([5, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]);
    expect(counted).toHaveLength(13);
  });

  it("dailyTotal: October paused on the 20th = 31 − 12 = 19 days = 114,000; a running bill with nothing marked is the whole month", () => {
    expect(dailyTotal({ ...paused, amount: 6000, missed: "{}" }, "2026-10")).toEqual({ days: 19, amount: 114000 });
    expect(dailyTotal({ ...paused, amount: 6000, missed: "{}" }, "2026-11")).toEqual({ days: 0, amount: 0 });
    expect(dailyTotal({ amount: 6000, missed: "{}" }, "2026-11")).toEqual({ days: 30, amount: 180000 });
    expect(dailyTotal({ amount: 6000, missed: JSON.stringify({ "2026-11": [5, 6] }) }, "2026-11")).toEqual({ days: 28, amount: 168000 });
  });

  it("dailyPrecharge with a pause: C leaves 25 Nov on a bill stopped 20 Nov = 19 days × 6,000 ÷ 3 = 38,000", () => {
    const members = ["A", "B", "C"].map((id) => ({ id, splitWeight: 100, joinedFrom: null, leftAt: null }));
    const bill = { amount: 6000, missed: "{}", split: JSON.stringify({ mode: "equal" }), paused: true, pausedAt: at("2026-11-20"), tz: "Asia/Kolkata" };
    expect(dailyPrecharge(bill, "2026-11", "2026-11-25", members, "C").amount).toBe(38000);
    expect(dailyPrecharge({ ...bill, paused: false }, "2026-11", "2026-11-25", members, "C").amount).toBe(50000); // not paused: 25 days
  });

  it("stopDone: a stopped bill is finished only when nothing is left to add", () => {
    const stopped = { paused: true, endMonth: "2026-11", startMonth: "2026-11", every: 1, nature: "daily", amount: 6000, missed: "{}", pausedAt: at("2026-11-20"), tz: "Asia/Kolkata" };
    expect(stopDone(stopped, [], at("2026-11-25"))).toBe(false); // November (19 days) is still to be added
    expect(stopDone(stopped, [], at("2026-12-01"))).toBe(false); // the job has not run yet
    expect(stopDone(stopped, [{ period: "2026-11", status: "added", reason: "" }], at("2026-12-01"))).toBe(true);
    expect(stopDone(stopped, [{ period: "2026-11", status: "waiting", reason: "" }], at("2026-12-01"))).toBe(false);
    expect(stopDone(stopped, [{ period: "2026-11", status: "adding", reason: "" }], at("2026-12-01"))).toBe(false);
    expect(stopDone(stopped, [{ period: "2026-11", status: "added", reason: "" }, { period: "2026-10", status: "waiting", reason: "deleted" }], at("2026-12-01"))).toBe(true); // a deleted month does not hold it back
    expect(stopDone({ ...stopped, endMonth: "" }, [{ period: "2026-11", status: "added", reason: "" }], at("2026-12-01"))).toBe(false); // only paused: never finished
    expect(stopDone({ ...stopped, nature: "fixed" }, [], at("2026-11-25"))).toBe(true); // a fixed bill with nothing waiting goes at once
    expect(isStopped({ paused: true, endMonth: "2026-11" })).toBe(true);
    expect(isStopped({ paused: true, endMonth: "" })).toBe(false);
    expect(isStopped({ paused: false, endMonth: "2026-11" })).toBe(false);
  });

  it("the chip: Stopped for a stopped bill, Paused for a paused one (the same grey)", () => {
    const base = { nature: "daily", status: "paused" as const, due: "", payerId: "A", reason: "", recordedThisMonth: false, tz: "Asia/Kolkata", now: at("2026-11-25") };
    expect(billBadge({ ...base, ended: true })).toEqual({ id: "paused", label: "Stopped", tone: "grey" });
    expect(billBadge(base)).toEqual({ id: "paused", label: "Paused", tone: "grey" });
    expect(billBadge({ ...base, status: "waiting", nature: "varies", ended: true })?.label).toBe("Needs amount");
  });

  it("the words, exactly", () => {
    const w = { name: "Milk", nature: "daily", month: "2026-11", day: 20, days: 19, money: "₹1,140", less: [], lastMonth: null, waiting: null };
    expect(stopLines(w)).toEqual({
      stop: "Stop Milk? Milk stops now. 1–19 Nov (₹1,140) is added on 1 Dec with the monthly bill. Expenses already added stay.",
      pause: "Pause Milk? 1–19 Nov (₹1,140) is added on 1 Dec with the monthly bill. Nothing more is added until you start it again.",
      stoppedNote: "Stopped from 20 Nov. 1–19 Nov (₹1,140) is added on 1 Dec with the monthly bill, then Milk ends.",
      pausedNote: "Paused from 20 Nov. 1–19 Nov (₹1,140) is added on 1 Dec with the monthly bill. Nothing more is added until you start it again.",
    });
    expect(stopLines({ ...w, less: [{ who: "C", money: "₹200" }] }).stop).toBe("Stop Milk? Milk stops now. 1–19 Nov (₹1,140, less ₹200 C already paid when they moved out) is added on 1 Dec with the monthly bill. Expenses already added stay.");
    expect(stopLines({ ...w, month: "2026-12", day: 5, days: 4, money: "₹240", lastMonth: { period: "2026-11", money: "₹1,800" } }).stop).toBe(
      "Stop Milk? Milk stops now. 1–4 Dec (₹240) is added on 1 Jan with the monthly bill. November (₹1,800) is still added with the monthly bill. Expenses already added stay.",
    );
    expect(stopLines({ ...w, day: 1, days: 0, money: "₹0" })).toMatchObject({ stop: "Stop Milk? Expenses already added stay.", pause: "Pause Milk? Nothing more is added until you start it again." });
    expect(stopLines({ ...w, name: "Electricity", nature: "varies", days: 0, waiting: { period: "2026-11", varies: true } }).stop).toBe(
      "Stop Electricity? November is still waiting for its amount. It stays in Bills until you enter it or skip it. Nothing new is added after that.",
    );
    expect(dayRangeLabel("2026-11", 1, 19)).toBe("1–19 Nov");
    expect(dayRangeLabel("2026-11", 19, 19)).toBe("19 Nov");
    expect(nextBillLabel({ status: "waiting", nature: "fixed", reason: "", payerId: "A" })).toBe("Overdue");
    expect(nextBillLabel({ status: "waiting", nature: "varies", reason: "", payerId: "A" })).toBe("Waiting for amount");
    expect(nextBillLabel({ status: "waiting", nature: "fixed", reason: "payer left", payerId: null })).toBe("Needs a payer");
    expect(nextBillLabel({ status: "upcoming", nature: "fixed", reason: "", payerId: "A" })).toBe("Next bill");
  });
});

// ---------- Stop ----------
describe("stopping a daily bill", () => {
  it("1. stop 20 Nov: nothing is charged that day (19 × 6,000 = 114,000 is the month's total); the job on 1 Dec, run twice, adds Milk once (38,000 each, 'Stopped' until then) and the bill goes; A +76,000, B −38,000, C −38,000; settled to 0", async () => {
    const f = await flat("one");
    const words = (await stopWordsFor(f.billId, at("2026-11-20")))!.words;
    expect(words.stop).toBe("Stop Milk? Milk stops now. 1–19 Nov (₹1,140) is added on 1 Dec with the monthly bill. Expenses already added stay.");
    expect(words.pause).toBe("Pause Milk? 1–19 Nov (₹1,140) is added on 1 Dec with the monthly bill. Nothing more is added until you start it again.");
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"))).ok).toBe(true);
    expect(await live(f.groupId)).toHaveLength(0);
    let bill = await billOf(f);
    expect([bill.paused, bill.endMonth, bill.deletedAt]).toEqual([true, "2026-11", null]);
    expect(dailyTotal(bill, "2026-11").amount).toBe(114000);
    expect((await stopWordsFor(f.billId, at("2026-11-25")))!.words.stoppedNote).toBe("Stopped from 20 Nov. 1–19 Nov (₹1,140) is added on 1 Dec with the monthly bill, then Milk ends.");
    const status = (await billStatuses(f.groupId, at("2026-11-25")))[0];
    expect(status.status).toBe("paused");
    expect(billBadge({ nature: "daily", status: status.status, due: status.due, payerId: status.payerId, reason: status.reason, recordedThisMonth: status.recordedThisMonth, tz: "Asia/Kolkata", now: at("2026-11-25"), ended: isStopped(status.bill) })?.label).toBe("Stopped");
    expect(await nets(f)).toEqual([0, 0, 0]);
    await runBillsForGroup(f.groupId, at("2026-11-30")); // November is not over: nothing yet
    expect(await live(f.groupId)).toHaveLength(0);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await live(f.groupId);
    expect(list.map((e) => [e.description, e.amount, e.notes])).toEqual([["Milk", 114000, "19 days × ₹60"]]);
    expect(shareMap(list[0])).toEqual({ [f.a]: 38000, [f.b]: 38000, [f.c]: 38000 });
    bill = await billOf(f);
    expect(bill.deletedAt).not.toBeNull();
    await runBillsForGroup(f.groupId, at("2027-01-01"));
    expect(await live(f.groupId)).toHaveLength(1);
    expect(await nets(f)).toEqual([76000, -38000, -38000]);
    await settleUp(f);
  });

  it("14. stop on 1 Dec at 07:00 in India, before the job: November is added whole, 30 × 6,000 = 180,000 (60,000 each), nothing for December, and the bill goes", async () => {
    const f = await flat("fourteen");
    const early = new Date("2026-12-01T01:30:00Z"); // 07:00 in India
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", early)).ok).toBe(true);
    expect(await live(f.groupId)).toHaveLength(0);
    expect((await billOf(f)).endMonth).toBe("2026-12");
    await runBillsForGroup(f.groupId, early);
    const list = await live(f.groupId);
    expect(list.map((e) => [e.description, e.amount])).toEqual([["Milk", 180000]]);
    expect(shareMap(list[0])).toEqual({ [f.a]: 60000, [f.b]: 60000, [f.c]: 60000 });
    expect((await billOf(f)).deletedAt).not.toBeNull();
    await runBillsForGroup(f.groupId, at("2026-12-02"));
    await runBillsForGroup(f.groupId, at("2027-01-01"));
    expect(await live(f.groupId)).toHaveLength(1);
    expect(await nets(f)).toEqual([120000, -60000, -60000]);
    await settleUp(f);
  });

  it("9. the time zone: stop at 23:30 in India on 30 Nov counts 29 days = 174,000 (58,000 each); stop at 00:30 on 1 Dec counts all 30 = 180,000 (60,000 each) and nothing for December", async () => {
    const f1 = await flat("nine-a");
    expect((await billCommand(f1.groupId, f1.a, f1.billId, "stop", new Date("2026-11-30T18:00:00Z"))).ok).toBe(true);
    await runBillsForGroup(f1.groupId, at("2026-12-01"));
    expect((await live(f1.groupId)).map((e) => e.amount)).toEqual([174000]);
    expect(await nets(f1)).toEqual([116000, -58000, -58000]);
    await settleUp(f1);
    const f2 = await flat("nine-b");
    expect((await billCommand(f2.groupId, f2.a, f2.billId, "stop", new Date("2026-11-30T19:00:00Z"))).ok).toBe(true);
    await runBillsForGroup(f2.groupId, at("2026-12-01"));
    expect((await live(f2.groupId)).map((e) => e.amount)).toEqual([180000]);
    expect(await nets(f2)).toEqual([120000, -60000, -60000]);
    await settleUp(f2);
  });

  it("4. stop with a 'varies' month waiting: Electricity for November (day 5) stays in Bills ('Needs amount'); A enters ₹1,500 = 150,000 (50,000 each), then it goes and the 5 Dec job adds nothing; A +100,000, B −50,000, C −50,000", async () => {
    const f = await flat("four");
    await db.bill.update({ where: { id: f.billId }, data: { name: "Electricity", nature: "varies", amount: 0, day: 5 } });
    await runBillsForGroup(f.groupId, at("2026-11-06"));
    expect((await stopWordsFor(f.billId, at("2026-11-20")))!.words.stop).toBe("Stop Electricity? November is still waiting for its amount. It stays in Bills until you enter it or skip it. Nothing new is added after that.");
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"))).ok).toBe(true);
    let bill = await billOf(f);
    expect([bill.paused, bill.endMonth, bill.deletedAt === null]).toEqual([true, "2026-11", true]);
    const status = (await billStatuses(f.groupId, at("2026-11-21")))[0];
    expect(status.status).toBe("waiting");
    expect(billBadge({ nature: "varies", status: status.status, due: status.due, payerId: status.payerId, reason: status.reason, recordedThisMonth: false, tz: "Asia/Kolkata", now: at("2026-11-21"), ended: true })?.label).toBe("Needs amount");
    const members = await db.member.findMany({ where: { groupId: f.groupId } });
    const input: SaveExpenseInput = { ...billExpenseInput(bill, f.groupId, "INR", "2026-11", 150000, f.a, members), name: "Electricity" };
    expect((await addWaitingBill(input, f.a, rateOk, { billId: f.billId, period: "2026-11" }, "bps-four-key-aaaa1")).ok).toBe(true);
    bill = await billOf(f);
    expect(bill.deletedAt).not.toBeNull();
    await runBillsForGroup(f.groupId, at("2026-12-05"));
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([150000]);
    expect(await nets(f)).toEqual([100000, -50000, -50000]);
    await settleUp(f);
  });

  it("4b. the same, but skipped: the bill goes and the books stay at 0", async () => {
    const f = await flat("four-b");
    await db.bill.update({ where: { id: f.billId }, data: { name: "Electricity", nature: "varies", amount: 0, day: 5 } });
    await runBillsForGroup(f.groupId, at("2026-11-06"));
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"))).ok).toBe(true);
    expect((await billOf(f)).deletedAt).toBeNull();
    expect((await billCommand(f.groupId, f.a, f.billId, "skip", at("2026-11-21"))).ok).toBe(true);
    expect((await billOf(f)).deletedAt).not.toBeNull();
    expect(await live(f.groupId)).toHaveLength(0);
    expect(await nets(f)).toEqual([0, 0, 0]);
    await settleUp(f);
  });

  it("10. the calendar after the stop: 22 Nov can't be tapped (exact words); 5 Nov can: 18 days = 108,000 (36,000 each)", async () => {
    const f = await flat("ten");
    await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"));
    expect(await toggleMissedDayFor(f.groupId, f.a, f.billId, "2026-11", 22)).toEqual({ ok: false, error: "Milk stopped on 20 Nov, so days from then aren’t counted." });
    expect((await toggleMissedDayFor(f.groupId, f.a, f.billId, "2026-11", 5)).ok).toBe(true);
    expect(dailyTotal(await billOf(f), "2026-11")).toEqual({ days: 18, amount: 108000 });
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await live(f.groupId);
    expect(list.map((e) => e.amount)).toEqual([108000]);
    expect(shareMap(list[0])).toEqual({ [f.a]: 36000, [f.b]: 36000, [f.c]: 36000 });
    expect(await nets(f)).toEqual([72000, -36000, -36000]);
    await settleUp(f);
  });

  it("15. a stopped bill can't start again, can't skip a coming month and can't be edited; a paused daily bill can't change type; a paused bill with no pause day has nothing due; the real action pauses, stops and refuses", async () => {
    const f = await flat("fifteen");
    await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"));
    expect(await billCommand(f.groupId, f.a, f.billId, "resume", at("2026-11-21"))).toEqual({ ok: false, error: "Milk has been stopped, so it can’t start again. Set it up again from Add a bill." });
    expect(await billCommand(f.groupId, f.a, f.billId, "skip", at("2026-11-21"))).toEqual({ ok: false, error: "There’s no coming month to skip." });
    expect(await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-21"))).toEqual({ ok: true, id: f.billId }); // already stopped: nothing changes
    const input = { billId: f.billId, template: "milk", name: "Milk", nature: "daily", amount: "70", day: "31", payer: f.a, split: "equal", ids: [] as string[] };
    expect(await saveBillFor(f.groupId, f.a, input)).toEqual({ ok: false, error: "Milk has been stopped, so it can’t be changed." });
    expect((await billOf(f)).amount).toBe(6000);
    expect(await live(f.groupId)).toHaveLength(0);
    expect(await nets(f)).toEqual([0, 0, 0]);
    // A paused (not stopped) daily bill: its type can't change, and the calendar says why a day can't be tapped.
    const g = await flat("fifteen-b");
    await billCommand(g.groupId, g.a, g.billId, "pause", at("2026-11-20"));
    expect(await saveBillFor(g.groupId, g.a, { ...input, billId: g.billId, nature: "fixed", payer: g.a })).toEqual({ ok: false, error: "Milk is paused, so its type can’t change. Start it again first." });
    expect(await toggleMissedDayFor(g.groupId, g.a, g.billId, "2026-11", 22)).toEqual({ ok: false, error: "Milk is paused from 20 Nov, so days from then aren’t counted." });
    // A paused daily bill with no pause day written adds nothing.
    const h = await flat("fifteen-c");
    await db.bill.update({ where: { id: h.billId }, data: { paused: true, pausedAt: null } });
    await runBillsForGroup(h.groupId, at("2026-12-01"));
    expect(await live(h.groupId)).toHaveLength(0);
    expect(await db.billRun.count({ where: { billId: h.billId } })).toBe(0);
    await settleUp(f);
  });

  it("15b. a paused bill whose pause month is already added closes straight away when stopped, with no new expense; a fixed bill with nothing waiting goes at once", async () => {
    const f = await flat("fifteen-d", { startMonth: "2026-10" });
    await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-10-20"));
    await runBillsForGroup(f.groupId, at("2026-11-01")); // October: 31 − 12 = 19 days = 114,000
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([114000]);
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-25"))).ok).toBe(true);
    const bill = await billOf(f);
    expect([bill.endMonth, bill.deletedAt !== null]).toEqual(["2026-10", true]);
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([114000]);
    expect(await nets(f)).toEqual([76000, -38000, -38000]);
    await settleUp(f);
    const g = await flat("fifteen-e");
    await db.bill.update({ where: { id: g.billId }, data: { name: "Rent", nature: "fixed", amount: 1800000, day: 1 } });
    expect((await billCommand(g.groupId, g.a, g.billId, "stop", at("2026-11-20"))).ok).toBe(true);
    expect((await billOf(g)).deletedAt).not.toBeNull();
  });
});

// ---------- Pause and start again ----------
describe("pausing and starting again", () => {
  it("2. pause 20 Nov, start again 25 Nov: 20–24 count as not come, 25 days = 150,000 (50,000 each) on 1 Dec; A +100,000, B −50,000, C −50,000", async () => {
    const f = await flat("two");
    expect((await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-20"))).ok).toBe(true);
    expect(await live(f.groupId)).toHaveLength(0);
    expect(await nets(f)).toEqual([0, 0, 0]);
    expect((await billCommand(f.groupId, f.a, f.billId, "resume", at("2026-11-25"))).ok).toBe(true);
    const bill = await billOf(f);
    expect([bill.paused, bill.pausedAt, JSON.parse(bill.missed)["2026-11"]]).toEqual([false, null, [20, 21, 22, 23, 24]]);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await live(f.groupId);
    expect(list.map((e) => e.amount)).toEqual([150000]);
    expect(shareMap(list[0])).toEqual({ [f.a]: 50000, [f.b]: 50000, [f.c]: 50000 });
    expect(await nets(f)).toEqual([100000, -50000, -50000]);
    await settleUp(f);
  });

  it("3. pause 20 Oct, start again 5 Dec: 1 Nov adds October (19 days = 114,000); 1 Dec adds nothing; 6 Dec closes November as 'no days'; 1 Jan adds December (27 days = 162,000); A +184,000, B −92,000, C −92,000", async () => {
    const f = await flat("three", { startMonth: "2026-10" });
    expect((await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-10-20"))).ok).toBe(true);
    await runBillsForGroup(f.groupId, at("2026-11-01"));
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([114000]);
    expect(shareMap((await live(f.groupId))[0])).toEqual({ [f.a]: 38000, [f.b]: 38000, [f.c]: 38000 });
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    expect(await live(f.groupId)).toHaveLength(1);
    expect(await nets(f)).toEqual([76000, -38000, -38000]);
    expect((await billCommand(f.groupId, f.a, f.billId, "resume", at("2026-12-05"))).ok).toBe(true);
    const missed = JSON.parse((await billOf(f)).missed);
    expect([missed["2026-11"].length, missed["2026-12"]]).toEqual([30, [1, 2, 3, 4]]);
    await runBillsForGroup(f.groupId, at("2026-12-06"));
    const nov = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } });
    expect([nov.status, nov.reason]).toEqual(["skipped", "no days"]);
    expect(await live(f.groupId)).toHaveLength(1);
    await runBillsForGroup(f.groupId, at("2027-01-01"));
    const list = await live(f.groupId);
    expect(list.map((e) => [e.description, e.amount])).toEqual([["Milk", 114000], ["Milk", 162000]]);
    expect(shareMap(list[1])).toEqual({ [f.a]: 54000, [f.b]: 54000, [f.c]: 54000 });
    expect(await nets(f)).toEqual([184000, -92000, -92000]);
    await settleUp(f);
  });

  it("13. pause 20, start 25, pause 28, start 29: days 20–24 and 28 are not come, 24 days = 144,000 (48,000 each); A +96,000, B −48,000, C −48,000", async () => {
    const f = await flat("thirteen");
    for (const [c, d] of [["pause", "2026-11-20"], ["resume", "2026-11-25"], ["pause", "2026-11-28"], ["resume", "2026-11-29"]] as const) {
      expect((await billCommand(f.groupId, f.a, f.billId, c, at(d))).ok).toBe(true);
      expect(await nets(f)).toEqual([0, 0, 0]);
    }
    expect(JSON.parse((await billOf(f)).missed)["2026-11"]).toEqual([20, 21, 22, 23, 24, 28]);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await live(f.groupId);
    expect(list.map((e) => e.amount)).toEqual([144000]);
    expect(shareMap(list[0])).toEqual({ [f.a]: 48000, [f.b]: 48000, [f.c]: 48000 });
    expect(await nets(f)).toEqual([96000, -48000, -48000]);
    await settleUp(f);
  });

  it("the real change-bill action (the clock fixed at 20 Nov 2026): Pause then Stop on 22 Nov adds nothing then; the pause day stays 20 Nov, so 1–19 Nov (114,000) is added on 1 Dec", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T06:00:00Z"));
    try {
      const f = await flat("real");
      await redirected(() => B.changeBill(form({ groupId: f.groupId, billId: f.billId, command: "pause" })));
      let bill = await billOf(f);
      expect([bill.paused, bill.pausedAt?.toISOString()]).toEqual([true, "2026-11-20T06:00:00.000Z"]);
      expect(await live(f.groupId)).toHaveLength(0);
      vi.setSystemTime(new Date("2026-11-22T06:00:00Z"));
      await redirected(() => B.changeBill(form({ groupId: f.groupId, billId: f.billId, command: "stop" })));
      bill = await billOf(f);
      expect([bill.paused, bill.endMonth, bill.pausedAt?.toISOString(), bill.deletedAt]).toEqual([true, "2026-11", "2026-11-20T06:00:00.000Z", null]);
      await redirected(() => B.changeBill(form({ groupId: f.groupId, billId: f.billId, command: "resume" })));
      expect((await billOf(f)).paused).toBe(true); // refused: stopped
      expect(await live(f.groupId)).toHaveLength(0);
      await runBillsForGroup(f.groupId, at("2026-12-01"));
      expect((await live(f.groupId)).map((e) => e.amount)).toEqual([114000]);
      expect(await nets(f)).toEqual([76000, -38000, -38000]);
      await settleUp(f);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------- Moving out, moving in ----------
describe("moving out and in around a stop", () => {
  it("5. C moves out 10 Nov with the daily charge (10 × 6,000 ÷ 3 = 20,000, C pays A), then stop 20 Nov is not refused; 1 Dec: 114,000 − 20,000 = 94,000 (47,000 each for A and B) with the note naming C's share; A +47,000, B −47,000, C 0", async () => {
    const f = await flat("five");
    const out = await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-10", addDaily: true, requestKey: `bps-five-${stamp}-abcdefgh` }, at("2026-11-10"));
    expect(out).toMatchObject({ ok: true });
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([20000]);
    expect(await nets(f)).toEqual([0, 0, 0]);
    expect((await stopWordsFor(f.billId, at("2026-11-20")))!.words.stop).toBe(
      "Stop Milk? Milk stops now. 1–19 Nov (₹1,140, less ₹200 C already paid when they moved out) is added on 1 Dec with the monthly bill. Expenses already added stay.",
    );
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"))).ok).toBe(true);
    expect(await nets(f)).toEqual([0, 0, 0]);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await live(f.groupId);
    const end = list.find((e) => e.description === "Milk")!;
    expect(end.amount).toBe(94000);
    expect(shareMap(end)).toEqual({ [f.a]: 47000, [f.b]: 47000 });
    expect(end.notes).toContain("less ₹200 C’s share (moved out 10 Nov 2026)");
    expect(sum(list.map((e) => e.amount))).toBe(114000); // 20,000 + 94,000: the 19 days, once
    expect(await nets(f)).toEqual([47000, -47000, 0]);
    await settleUp(f);
  });

  it("6. undoing the move-out after the stop: on 25 Nov it works (charge and payment come off, C is back, 1 Dec shares 114,000 as 38,000 each; A +76,000, B −38,000, C −38,000); after the 1 Dec bill it is refused and the books stay A +47,000, B −47,000, C 0", async () => {
    const f = await flat("six");
    const out = await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-10", addDaily: true, requestKey: `bps-six-${stamp}-abcdefgh` }, at("2026-11-10"));
    const eventId = (out as { eventId: string }).eventId;
    await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"));
    expect((await undoEvent(eventId, f.a)).ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.c } })).leftAt).toBeNull();
    expect(await live(f.groupId)).toHaveLength(0);
    expect(await nets(f)).toEqual([0, 0, 0]);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await live(f.groupId);
    expect(list.map((e) => e.amount)).toEqual([114000]);
    expect(shareMap(list[0])).toEqual({ [f.a]: 38000, [f.b]: 38000, [f.c]: 38000 });
    expect(await nets(f)).toEqual([76000, -38000, -38000]);
    await settleUp(f);

    const g = await flat("six-b");
    const out2 = await moveOut(g.groupId, g.a, { leaverId: g.c, lastDay: "2026-11-10", addDaily: true, requestKey: `bps-six2-${stamp}-abcdefgh` }, at("2026-11-10"));
    await billCommand(g.groupId, g.a, g.billId, "stop", at("2026-11-20"));
    await runBillsForGroup(g.groupId, at("2026-12-01"));
    expect(await nets(g)).toEqual([47000, -47000, 0]);
    const late = await undoEvent((out2 as { eventId: string }).eventId, g.a);
    expect(late.ok).toBe(false);
    expect((await db.member.findUniqueOrThrow({ where: { id: g.c } })).leftAt).not.toBeNull();
    expect(await nets(g)).toEqual([47000, -47000, 0]);
    await settleUp(g);
  });

  it("7. 'Not received' after the stop: B moves C out 10 Nov (A is asked about C's 20,000), stop 20 Nov, A says Not received on 22 Nov and C is back (A +20,000, C −20,000)", async () => {
    const f = await flat("seven");
    const out = await moveOut(f.groupId, f.b, { leaverId: f.c, lastDay: "2026-11-10", addDaily: true, requestKey: `bps-seven-${stamp}-abcdefgh` }, at("2026-11-10"));
    expect(out).toMatchObject({ ok: true });
    const pay = await db.payment.findFirstOrThrow({ where: { groupId: f.groupId, fromId: f.c, toId: f.a } });
    expect([pay.amount, pay.needsOk]).toEqual([20000, true]);
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"))).ok).toBe(true);
    expect((await rejectPayment(pay.id, f.a)).ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.c } })).leftAt).toBeNull();
    expect(await nets(f)).toEqual([20000, 0, -20000]);

    // (a) C is settling up only, so he cannot be moved out by hand any more (the app does it the moment he is square). He pays A 20,000:
    // no second milk charge, C is square (0) and is moved out again with his old last day (10 Nov); 1 Dec: 94,000 to A and B, 47,000 each.
    const again = await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-23", addDaily: true, requestKey: `bps-seven2-${stamp}-abcdefgh` }, at("2026-11-23"));
    expect(again).toEqual({ ok: false, error: SETTLING_NO_MOVE_OUT });
    await payAsC(f, 20000, "seven3");
    expect((await db.member.findUniqueOrThrow({ where: { id: f.c } })).leftAt?.toISOString()).toBe("2026-11-10T12:00:00.000Z");
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([20000]);
    expect(await nets(f)).toEqual([0, 0, 0]);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const end = (await live(f.groupId)).find((e) => e.description === "Milk")!;
    expect([end.amount, shareMap(end)]).toEqual([94000, { [f.a]: 47000, [f.b]: 47000 }]);
    expect(await nets(f)).toEqual([47000, -47000, 0]);
    await settleUp(f);
  });

  // C moved out 10 Nov (charge 20,000 paid to A, asked of A by B), the bill is stopped 20 Nov, and A says "Not received": C is back, but his
  // charge is still on the bill. The month (19 days = 114,000) is his 20,000 charge plus 94,000 for A and B: C takes no part of the 94,000.
  async function notReceivedFlat(label: string) {
    const f = await flat(label);
    await moveOut(f.groupId, f.b, { leaverId: f.c, lastDay: "2026-11-10", addDaily: true, requestKey: `bps-${label}-${stamp}-abcdefgh` }, at("2026-11-10"));
    const pay = await db.payment.findFirstOrThrow({ where: { groupId: f.groupId, fromId: f.c, toId: f.a } });
    await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"));
    return { f, pay };
  }
  const milkOf = async (f: Flat) => (await live(f.groupId)).filter((e) => e.description === "Milk");

  it("7b. 'Not received' with the charge still on the bill: C is back but takes no part of the month end: 94,000 = A 47,000, B 47,000; A +67,000 (20,000 charge + 94,000 − 47,000), B −47,000, C −20,000; settled to 0", async () => {
    const { f, pay } = await notReceivedFlat("seven-b");
    expect((await rejectPayment(pay.id, f.a)).ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.c } })).leftAt).toBeNull();
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const end = (await milkOf(f))[0];
    expect([end.amount, shareMap(end)]).toEqual([94000, { [f.a]: 47000, [f.b]: 47000 }]);
    expect(await nets(f)).toEqual([67000, -47000, -20000]);
    await settleUp(f);
  });

  it("7c. 'Not received', then the charge expense is deleted (C is back, so it may be): C shares only the days up to his last day, 10 Nov: 114,000 = A 47,000, B 47,000, C 20,000 (days 1–10 three-way, 11–19 two-way; in sixths A = 10×2 + 9×3 = 47, C = 10×2 = 20, of 114); A +67,000, B −47,000, C −20,000", async () => {
    const { f, pay } = await notReceivedFlat("seven-c");
    expect((await rejectPayment(pay.id, f.a)).ok).toBe(true);
    const charge = (await live(f.groupId)).find((e) => e.description !== "Milk")!;
    expect(charge.amount).toBe(20000);
    expect((await setExpenseDeleted(charge.id, f.a, true)).ok).toBe(true);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const end = (await milkOf(f))[0];
    expect([end.amount, shareMap(end)]).toEqual([114000, { [f.a]: 47000, [f.b]: 47000, [f.c]: 20000 }]);
    expect(await nets(f)).toEqual([67000, -47000, -20000]);
    await settleUp(f);
  });

  it("7d. 'Not received' lands in the middle of the month-end run (after the group is read, before it is saved): still 94,000 = A 47,000, B 47,000, and a second run adds nothing", async () => {
    const { f, pay } = await notReceivedFlat("seven-d");
    let fired = false;
    await runBillsForGroup(f.groupId, at("2026-12-01"), {
      afterRead: async () => {
        if (fired) return;
        fired = true;
        expect((await rejectPayment(pay.id, f.a)).ok).toBe(true);
      },
    });
    expect(fired).toBe(true);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await milkOf(f);
    expect(list).toHaveLength(1);
    expect([list[0].amount, shareMap(list[0])]).toEqual([94000, { [f.a]: 47000, [f.b]: 47000 }]);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.c } })).leftAt).toBeNull();
    expect(await nets(f)).toEqual([67000, -47000, -20000]);
    await settleUp(f);
  });

  it("7e. the job run twice on 1 Dec adds Milk once; a failure after the save (afterSave throws) leaves the month already marked added, so the next run adds nothing more: still one 94,000 expense; and a run at 00:30 India time on 1 Dec (19:00 UTC on 30 Nov) gives the same numbers", async () => {
    const a = await notReceivedFlat("seven-e1");
    expect((await rejectPayment(a.pay.id, a.f.a)).ok).toBe(true);
    await runBillsForGroup(a.f.groupId, at("2026-12-01"));
    await runBillsForGroup(a.f.groupId, at("2026-12-01"));
    expect((await milkOf(a.f)).map((e) => [e.amount, shareMap(e)])).toEqual([[94000, { [a.f.a]: 47000, [a.f.b]: 47000 }]]);
    expect(await nets(a.f)).toEqual([67000, -47000, -20000]);
    await settleUp(a.f);

    const b = await notReceivedFlat("seven-e2");
    expect((await rejectPayment(b.pay.id, b.f.a)).ok).toBe(true);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const first = await runBillsForGroup(b.f.groupId, at("2026-12-01"), { afterSave: async () => { throw new Error("crash after the save"); } });
      expect(first.failed).toBe(1);
    } finally {
      quiet.mockRestore();
    }
    // (The month is marked added in the same step as the save, so the failure after it loses nothing and there is nothing to finish.)
    expect((await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: b.f.billId, period: "2026-11" } } })).status).toBe("added");
    const again = await runBillsForGroup(b.f.groupId, new Date("2026-12-01T06:30:00Z"));
    expect(again.added).toBe(0); // no second expense
    expect((await milkOf(b.f)).map((e) => [e.amount, shareMap(e)])).toEqual([[94000, { [b.f.a]: 47000, [b.f.b]: 47000 }]]);
    expect(await nets(b.f)).toEqual([67000, -47000, -20000]);
    await settleUp(b.f);

    const c = await notReceivedFlat("seven-e3");
    expect((await rejectPayment(c.pay.id, c.f.a)).ok).toBe(true);
    await runBillsForGroup(c.f.groupId, new Date("2026-11-30T19:00:00Z"));
    expect((await milkOf(c.f)).map((e) => [e.amount, shareMap(e)])).toEqual([[94000, { [c.f.a]: 47000, [c.f.b]: 47000 }]]);
    expect(await nets(c.f)).toEqual([67000, -47000, -20000]);
    await settleUp(c.f);
  });

  it("8. D moved in 15 Nov, stop 20 Nov: shared day by day, 114,000 = A 35,500, B 35,500, C 35,500, D 7,500 (days 1–14 three-way, 15–19 four-way; in twelfths A = 14×4 + 5×3 = 71, D = 5×3 = 15, of 228); A +78,500, B −35,500, C −35,500, D −7,500; settled to 0", async () => {
    const f = await flat("eight", { extra: true });
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"))).ok).toBe(true);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await live(f.groupId);
    expect(list.map((e) => e.amount)).toEqual([114000]);
    expect(shareMap(list[0])).toEqual({ [f.a]: 35500, [f.b]: 35500, [f.c]: 35500, [f.d]: 7500 });
    const net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c], net[f.d]]).toEqual([78500, -35500, -35500, -7500]);
    await settleUp(f);
  });

  it("11. C moves out 25 Nov, after the stop on 20 Nov: C's charge is 19 × 6,000 ÷ 3 = 38,000; 1 Dec: 114,000 − 38,000 = 76,000 (38,000 each for A and B); A +38,000, B −38,000, C 0", async () => {
    const f = await flat("eleven");
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"))).ok).toBe(true);
    const out = await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-25", addDaily: true, requestKey: `bps-eleven-${stamp}-abcdefgh` }, at("2026-11-25"));
    expect(out).toMatchObject({ ok: true });
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([38000]);
    expect(await nets(f)).toEqual([0, 0, 0]);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const end = (await live(f.groupId)).find((e) => e.description === "Milk")!;
    expect([end.amount, shareMap(end)]).toEqual([76000, { [f.a]: 38000, [f.b]: 38000 }]);
    expect(await nets(f)).toEqual([38000, -38000, 0]);
    await settleUp(f);
  });

  it("12. a pause lands while a move-out is being confirmed (the afterRead hook): the move-out is refused with the usual words and nothing changes; C stays, no charge; books at 0", async () => {
    const f = await flat("twelve");
    const r = await moveOut(
      f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-10", addDaily: true, requestKey: `bps-twelve-${stamp}-abcdefgh` }, at("2026-11-10"),
      { afterRead: async () => void (await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-10"))) },
    );
    expect(r).toEqual({ ok: false, error: "A bill changed just now. Check it and try again." });
    expect((await db.member.findUniqueOrThrow({ where: { id: f.c } })).leftAt).toBeNull();
    expect(await live(f.groupId)).toHaveLength(0);
    expect(await nets(f)).toEqual([0, 0, 0]);
    await settleUp(f);
  });
});

// ---------- Carried over: a deleted month can be added again (M8), and the other fixes ----------
describe("a deleted automatic bill expense can be added again (M8)", () => {
  async function rentFlat(label: string) {
    const f = await flat(label);
    await db.bill.update({ where: { id: f.billId }, data: { name: "Rent", nature: "fixed", amount: 1800000, day: 1, startMonth: "2026-11" } });
    await runBillsForGroup(f.groupId, at("2026-11-02"));
    const first = (await live(f.groupId))[0];
    return { ...f, first };
  }
  it("Rent 1,800,000 (600,000 each): delete → waiting 'deleted', the job doesn't add it twice, add it again once; the old one can't come back; balances A +1,200,000, B −600,000, C −600,000", async () => {
    const f = await rentFlat("rent1");
    expect(f.first.amount).toBe(1800000);
    expect((await setExpenseDeleted(f.first.id, f.a, true)).ok).toBe(true);
    let run = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } });
    expect([run.status, run.reason]).toEqual(["waiting", "deleted"]);
    await runBillsForGroup(f.groupId, at("2026-11-03"));
    expect(await db.expense.count({ where: { groupId: f.groupId, deletedAt: null } })).toBe(0);
    const bill = await billOf(f);
    const members = await db.member.findMany({ where: { groupId: f.groupId } });
    const input: SaveExpenseInput = billExpenseInput(bill, f.groupId, "INR", "2026-11", 1800000, f.a, members);
    const r = await addWaitingBill(input, f.a, rateOk, { billId: f.billId, period: "2026-11" }, "rent-again-key-aaaa1");
    expect(r.ok).toBe(true);
    run = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } });
    expect(run.status).toBe("added");
    const net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([1200000, -600000, -600000]);
    const back = await setExpenseDeleted(f.first.id, f.a, false);
    expect(back).toEqual({ ok: false, error: "This month’s Rent was already added, so this can’t come back." });
    await settleUp(f);
  });
  it("restoring the deleted one before it is added again works, and the month is 'added' with the old expense", async () => {
    const f = await rentFlat("rent2");
    await setExpenseDeleted(f.first.id, f.a, true);
    expect((await setExpenseDeleted(f.first.id, f.a, false)).ok).toBe(true);
    const run = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } });
    expect([run.status, run.expenseId]).toEqual(["added", f.first.id]);
    await settleUp(f);
  });
});

describe("A4: a month added again can't have the old expense back, however it was renamed", () => {
  it("Rent 1,800,000 deleted and re-added as 'Rent Nov': restoring the first is refused; B and C each owe 600,000, not 1,200,000", async () => {
    const f = await flat("a4");
    await db.bill.update({ where: { id: f.billId }, data: { name: "Rent", nature: "fixed", amount: 1800000, day: 1, startMonth: "2026-11" } });
    await runBillsForGroup(f.groupId, at("2026-11-02"));
    const first = (await live(f.groupId))[0];
    await setExpenseDeleted(first.id, f.a, true);
    const bill = await billOf(f);
    const members = await db.member.findMany({ where: { groupId: f.groupId } });
    const input: SaveExpenseInput = { ...billExpenseInput(bill, f.groupId, "INR", "2026-11", 1800000, f.a, members), name: "Rent Nov", date: "2026-11-09" };
    expect((await addWaitingBill(input, f.a, rateOk, { billId: f.billId, period: "2026-11" }, "a4-again-key-aaaa1")).ok).toBe(true);
    expect(await db.requestKey.count({ where: { key: `bill-replaced:${first.id}` } })).toBe(1);
    expect((await setExpenseDeleted(first.id, f.a, false)).ok).toBe(false);
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([1800000]);
    const net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([1200000, -600000, -600000]);
    await settleUp(f);
  });
  it("an unrelated expense with the same name and month no longer stops a restore (no guessing by name)", async () => {
    const f = await flat("a4b");
    await db.bill.update({ where: { id: f.billId }, data: { name: "Rent", nature: "fixed", amount: 1800000, day: 1, startMonth: "2026-11" } });
    await runBillsForGroup(f.groupId, at("2026-11-02"));
    const first = (await live(f.groupId))[0];
    await setExpenseDeleted(first.id, f.a, true);
    expect((await setExpenseDeleted(first.id, f.a, false)).ok).toBe(true);
    await settleUp(f);
  });
});

describe("A8: a month whose expense was deleted is not 'waiting' on Home and does not hold the bill back", () => {
  it("October waiting as 'deleted': the status is not waiting; stop 20 Nov works and the 1 Dec bill still adds November (114,000); A +76,000, B −38,000, C −38,000", async () => {
    const f = await flat("a8", { startMonth: "2026-10" });
    await db.billRun.create({ data: { billId: f.billId, period: "2026-10", status: "waiting", reason: "deleted", expenseId: "gone-expense" } });
    expect((await billStatuses(f.groupId, at("2026-11-20")))[0].status).not.toBe("waiting");
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"))).ok).toBe(true);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([114000]);
    expect((await billOf(f)).deletedAt).not.toBeNull();
    expect(await nets(f)).toEqual([76000, -38000, -38000]);
    await settleUp(f);
  });
});

describe("B3: a month added again that crashed part-way still remembers what it replaced", () => {
  it("Rent deleted, added again, then the run looks unfinished (as after a crash): the daily job finishes it and the old expense still can't come back", async () => {
    const f = await flat("b3");
    await db.bill.update({ where: { id: f.billId }, data: { name: "Rent", nature: "fixed", amount: 1800000, day: 1, startMonth: "2026-11" } });
    await runBillsForGroup(f.groupId, at("2026-11-02"));
    const first = (await live(f.groupId))[0];
    await setExpenseDeleted(first.id, f.a, true);
    const bill = await billOf(f);
    const members = await db.member.findMany({ where: { groupId: f.groupId } });
    const input: SaveExpenseInput = { ...billExpenseInput(bill, f.groupId, "INR", "2026-11", 1800000, f.a, members), name: "Rent again" };
    const key = "b3-again-key-aaaaaa1";
    const added = await addWaitingBill(input, f.a, rateOk, { billId: f.billId, period: "2026-11" }, key);
    expect(added.ok).toBe(true);
    // The crash: the expense is saved, but the month still says "adding" with the old expense, and the note was never written.
    await db.billRun.update({ where: { billId_period: { billId: f.billId, period: "2026-11" } }, data: { status: "adding", expenseId: first.id, requestKey: key, claimedAt: new Date("2026-11-03T00:00:00Z") } });
    await db.requestKey.deleteMany({ where: { key: `bill-replaced:${first.id}` } });
    await runBillsForGroup(f.groupId, at("2026-11-20"));
    const run = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } });
    expect(run.status).toBe("added");
    expect(run.expenseId).toBe(added.ok ? added.id : "");
    expect(await db.requestKey.count({ where: { key: `bill-replaced:${first.id}` } })).toBe(1);
    expect((await setExpenseDeleted(first.id, f.a, false)).ok).toBe(false);
    const net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([1200000, -600000, -600000]);
    await settleUp(f);
  });
});

describe("B6: Skip this time ignores a month waiting because its expense was deleted", () => {
  it("November waits as 'deleted': skipping skips December, and November still waits to be added again", async () => {
    const f = await flat("b6");
    await db.billRun.create({ data: { billId: f.billId, period: "2026-11", status: "waiting", reason: "deleted", expenseId: "gone-expense" } });
    expect((await billCommand(f.groupId, f.a, f.billId, "skip", at("2026-11-20"))).ok).toBe(true);
    const runs = await db.billRun.findMany({ where: { billId: f.billId }, orderBy: { period: "asc" } });
    expect(runs.map((r) => [r.period, r.status, r.reason])).toEqual([["2026-11", "waiting", "deleted"], ["2026-12", "skipped", "skipped"]]);
    await settleUp(f);
  });
});

// ---------- H1, H3, H4 ----------
describe("H1: a pause or stop on the day of someone's last day does not count that day twice", () => {
  async function leaveThenCut(label: string, lastDay: string, command: "stop" | "pause") {
    const f = await flat(label);
    const out = await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay, addDaily: true, requestKey: `bps-${label}-${stamp}-abcdefgh` }, at(lastDay));
    expect(out).toMatchObject({ ok: true });
    expect((await billCommand(f.groupId, f.a, f.billId, command, at(lastDay))).ok).toBe(true);
    expect(await nets(f)).toEqual([0, 0, 0]);
    return f;
  }

  it("C's last day is 20 Nov (add it now): C pays 20 × 2,000 = 40,000; stop the same day; 1 Dec adds 120,000 − 40,000 = 80,000, 40,000 each for A and B; A +40,000, B −40,000, C 0", async () => {
    const f = await leaveThenCut("h1a", "2026-11-20", "stop");
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([40000]);
    expect((await billOf(f)).pausedAt).toEqual(new Date("2026-11-21T12:00:00Z")); // the cut starts on 21 Nov
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await live(f.groupId);
    const end = list.find((e) => e.description === "Milk")!;
    expect([end.amount, shareMap(end)]).toEqual([80000, { [f.a]: 40000, [f.b]: 40000 }]);
    expect(sum(list.map((e) => e.amount))).toBe(120000); // 20 days × 6,000, once
    expect(await nets(f)).toEqual([40000, -40000, 0]);
    expect((await billOf(f)).deletedAt).not.toBeNull(); // nothing left to add: the bill is gone
    await settleUp(f);
  });

  it("the same with a pause instead of a stop: 1 Dec adds 80,000 (40,000 each); A +40,000, B −40,000, C 0", async () => {
    const f = await leaveThenCut("h1b", "2026-11-20", "pause");
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const end = (await live(f.groupId)).find((e) => e.description === "Milk")!;
    expect([end.amount, shareMap(end)]).toEqual([80000, { [f.a]: 40000, [f.b]: 40000 }]);
    expect(await nets(f)).toEqual([40000, -40000, 0]);
    await settleUp(f);
  });

  it("extreme: C's last day is 1 Nov and the stop is the same day: C pays 1 × 2,000; 1 Dec adds 6,000 − 2,000 = 4,000 (2,000 each); A +2,000, B −2,000, C 0", async () => {
    const f = await leaveThenCut("h1c", "2026-11-01", "stop");
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([2000]);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const end = (await live(f.groupId)).find((e) => e.description === "Milk")!;
    expect([end.amount, shareMap(end)]).toEqual([4000, { [f.a]: 2000, [f.b]: 2000 }]);
    expect(await nets(f)).toEqual([2000, -2000, 0]);
    await settleUp(f);
  });

  it("C's last day is 30 Nov (the month's last day), stopped the same day: C pays 30 × 2,000 = 60,000; 1 Dec adds 180,000 − 60,000 = 120,000 (60,000 each); A +60,000, B −60,000, C 0", async () => {
    const f = await leaveThenCut("h1d", "2026-11-30", "stop");
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const end = (await live(f.groupId)).find((e) => e.description === "Milk")!;
    expect([end.amount, shareMap(end)]).toEqual([120000, { [f.a]: 60000, [f.b]: 60000 }]);
    expect(await nets(f)).toEqual([60000, -60000, 0]);
    await settleUp(f);
  });
});

describe("H3 and H4: paused daily bills", () => {
  it("H3: stopping a paused daily bill that has no pause day closes it with nothing to add; the days are not charged; books at 0", async () => {
    const f = await flat("h3");
    await db.bill.update({ where: { id: f.billId }, data: { paused: true, pausedAt: null } });
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-25"))).ok).toBe(true);
    expect((await billOf(f)).deletedAt).not.toBeNull();
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    expect(await live(f.groupId)).toHaveLength(0);
    expect(await nets(f)).toEqual([0, 0, 0]);
    await settleUp(f);
  });

  it("H4: Skip on a bill paused 20 Nov is refused, so 1 Dec still adds the 19 days: 114,000 (38,000 each); A +76,000, B −38,000, C −38,000", async () => {
    const f = await flat("h4");
    expect((await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-20"))).ok).toBe(true);
    const skip = await billCommand(f.groupId, f.a, f.billId, "skip", at("2026-11-21"));
    expect(skip).toEqual({ ok: false, error: "There’s no coming month to skip." });
    expect(await db.billRun.count({ where: { billId: f.billId } })).toBe(0);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const end = (await live(f.groupId)).find((e) => e.description === "Milk")!;
    expect([end.amount, shareMap(end)]).toEqual([114000, { [f.a]: 38000, [f.b]: 38000, [f.c]: 38000 }]);
    expect(await nets(f)).toEqual([76000, -38000, -38000]);
    await settleUp(f);
  });
});

describe("H6, H7, H8: words, time zone cap, waiting month", () => {
  it("H6: with C's last day 20 Nov charged, the stop words count 1–20 Nov (₹1,200, less ₹400) and the note after the stop says the same", async () => {
    const f = await flat("h6a");
    await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-20", addDaily: true, requestKey: `bps-h6a-${stamp}-abcdefgh` }, at("2026-11-20"));
    expect((await stopWordsFor(f.billId, at("2026-11-20")))!.words.stop).toBe(
      "Stop Milk? Milk stops now. 1–20 Nov (₹1,200, less ₹400 C already paid when they moved out) is added on 1 Dec with the monthly bill. Expenses already added stay.",
    );
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"))).ok).toBe(true);
    expect((await stopWordsFor(f.billId, at("2026-11-20")))!.words.stoppedNote).toBe(
      "Stopped from 21 Nov. 1–20 Nov (₹1,200, less ₹400 C already paid when they moved out) is added on 1 Dec with the monthly bill, then Milk ends.",
    );
    expect(await nets(f)).toEqual([0, 0, 0]);
    await settleUp(f);
  });

  it("H6: with C's last day 30 Nov, November (₹1,800 − ₹600 = ₹1,200) is still to come, before and after the stop", async () => {
    const f = await flat("h6b");
    await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-30", addDaily: true, requestKey: `bps-h6b-${stamp}-abcdefgh` }, at("2026-11-30"));
    expect((await stopWordsFor(f.billId, at("2026-11-30")))!.words.stop).toBe("Stop Milk? November (₹1,200) is still added with the monthly bill. Expenses already added stay.");
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-30"))).ok).toBe(true);
    expect((await stopWordsFor(f.billId, at("2026-11-30")))!.words.stoppedNote).toBe("Stopped from 1 Dec. November (₹1,200) is added on 1 Dec with the monthly bill, then Milk ends.");
    expect(await nets(f)).toEqual([0, 0, 0]);
    await settleUp(f);
  });

  it("H7: a last day written as 25 Nov (ahead of today, 20 Nov) moves the cut only to 21 Nov, one day after today", async () => {
    const f = await flat("h7");
    await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-20", addDaily: true, requestKey: `bps-h7-${stamp}-abcdefgh` }, at("2026-11-20"));
    const pre = JSON.parse((await billOf(f)).prepaid) as Record<string, { d?: string }[]>;
    for (const x of pre["2026-11"]) x.d = "2026-11-25";
    await db.bill.update({ where: { id: f.billId }, data: { prepaid: JSON.stringify(pre) } });
    expect((await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-20"))).ok).toBe(true);
    expect((await billOf(f)).pausedAt).toEqual(new Date("2026-11-21T12:00:00Z"));
  });

  it("H8: stopping a paused bill with no pause day while October still waits keeps it (stopped) until October is skipped; then it goes; books at 0", async () => {
    const f = await flat("h8", { startMonth: "2026-10" });
    await db.billRun.create({ data: { billId: f.billId, period: "2026-10", status: "waiting", reason: "" } });
    await db.bill.update({ where: { id: f.billId }, data: { paused: true, pausedAt: null } });
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-25"))).ok).toBe(true);
    const mid = await billOf(f);
    expect([mid.deletedAt, mid.endMonth]).toEqual([null, "2026-11"]);
    expect((await billCommand(f.groupId, f.a, f.billId, "skip", at("2026-11-26"))).ok).toBe(true);
    expect((await billOf(f)).deletedAt).not.toBeNull();
    expect(await live(f.groupId)).toHaveLength(0);
    expect(await nets(f)).toEqual([0, 0, 0]);
    await settleUp(f);
  });
});

// ---------- A: the month end of a daily bill is shared day by day ----------
describe("day by day: someone moved in, someone moved out and paid at move-out", () => {
  it("case 5: C's last day is 20 Nov (charge 37,000 = 14 × 2,000 + 6 × 1,500, paid to A), D in on 15 Nov, no stop: 1 Dec adds 180,000 − 37,000 = 143,000 = A 57,000, B 57,000, D 29,000 (C takes none); A +86,000, B −57,000, C 0, D −29,000; settled to 0", async () => {
    const f = await flat("case5", { extra: true });
    const out = await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-20", addDaily: true, requestKey: `bps-case5-${stamp}-abcdefgh` }, at("2026-11-20"));
    expect(out).toMatchObject({ ok: true });
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([37000]);
    await checkBooks(f.groupId);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const end = (await live(f.groupId)).find((e) => e.description === "Milk")!;
    expect([end.amount, shareMap(end)]).toEqual([143000, { [f.a]: 57000, [f.b]: 57000, [f.d]: 29000 }]);
    const net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c], net[f.d]]).toEqual([86000, -57000, 0, -29000]);
    await settleUp(f);
  });

  it("the Add it form for a waiting month is filled in with the same amounts the job would have written (D in 15 Nov, stop 20 Nov: 114,000 = 35,500 / 35,500 / 35,500 / 7,500)", async () => {
    const f = await flat("prefill", { extra: true });
    await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"));
    const bill = await billOf(f);
    const members = await db.member.findMany({ where: { groupId: f.groupId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const input = billExpenseInput(bill, f.groupId, "INR", "2026-11", 114000, f.a, members, { entries: [], gone: [] });
    expect(input).toMatchObject({ forMode: "selected", splitType: "exact", amount: "1140" }); // (whole rupees are written without ".00")
    expect(input.exact).toEqual({ [f.a]: "355", [f.b]: "355", [f.c]: "355", [f.d]: "75" });
    // Without the charges the usual path is used (nothing written out).
    expect(billExpenseInput(bill, f.groupId, "INR", "2026-11", 114000, f.a, members).splitType).not.toBe("exact");
  });
});

// ---------- H5: no "Add it again" through a bill that has ended ----------
describe("H5: a month can't be added again through a bill that has ended; Restore still can", () => {
  const ENDED = "Milk has ended, so October can’t be added again here. To count it again, tap Restore on the deleted expense in Activity.";

  // Milk from October: October added whole (31 × 6,000 = 186,000, 62,000 each) and then deleted; stopped 20 Nov; 1 Dec adds November (114,000, 38,000 each) and the bill ends.
  async function endedFlat(label: string) {
    const f = await flat(label, { startMonth: "2026-10" });
    await runBillsForGroup(f.groupId, at("2026-11-01"));
    const oct = (await live(f.groupId))[0];
    expect(oct.amount).toBe(186000);
    expect((await setExpenseDeleted(oct.id, f.a, true)).ok).toBe(true);
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"))).ok).toBe(true);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    return { f, oct };
  }
  const octRun = (f: Flat) => db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-10" } } });
  const novRun = (f: Flat) => db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } });
  const octInput = async (f: Flat) => billExpenseInput(await billOf(f), f.groupId, "INR", "2026-10", 186000, f.a, await db.member.findMany({ where: { groupId: f.groupId } }));

  it("Add it again for October after the bill ended is refused in the exact words: no expense, October stays 'waiting · deleted'; A +76,000, B −38,000, C −38,000", async () => {
    const { f } = await endedFlat("h5a");
    expect((await billOf(f)).deletedAt).not.toBeNull();
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([114000]);
    const r = await addWaitingBill(await octInput(f), f.a, rateOk, { billId: f.billId, period: "2026-10" }, "h5a-again-key-aaaaaa1");
    expect(r).toEqual({ ok: false, error: ENDED });
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([114000]);
    const run = await octRun(f);
    expect([run.status, run.reason]).toEqual(["waiting", "deleted"]);
    expect(await nets(f)).toEqual([76000, -38000, -38000]);
    await settleUp(f);
  });

  it("Restore after the bill ended brings October back: 186,000 + 114,000 = 300,000; A +200,000, B −100,000, C −100,000; October is 'added'; a second tap is a quiet success; then Add it again is still refused", async () => {
    const { f, oct } = await endedFlat("h5b");
    expect((await setExpenseDeleted(oct.id, f.a, false)).ok).toBe(true);
    expect(sum((await live(f.groupId)).map((e) => e.amount))).toBe(300000);
    expect(await nets(f)).toEqual([200000, -100000, -100000]);
    expect((await octRun(f)).status).toBe("added");
    expect((await setExpenseDeleted(oct.id, f.a, false)).ok).toBe(true); // the second tap
    expect(sum((await live(f.groupId)).map((e) => e.amount))).toBe(300000);
    const r = await addWaitingBill(await octInput(f), f.a, rateOk, { billId: f.billId, period: "2026-10" }, "h5b-again-key-aaaaaa1");
    expect(r).toEqual({ ok: false, error: ENDED });
    expect(sum((await live(f.groupId)).map((e) => e.amount))).toBe(300000);
    expect(await nets(f)).toEqual([200000, -100000, -100000]);
    await settleUp(f);
  });

  it("a bill that has not ended: Restore and Add it again at the same moment — exactly one of them works and October is counted once (186,000; 62,000 each)", async () => {
    const f = await flat("h5c", { startMonth: "2026-10" });
    await runBillsForGroup(f.groupId, at("2026-11-01"));
    const oct = (await live(f.groupId))[0];
    expect((await setExpenseDeleted(oct.id, f.a, true)).ok).toBe(true);
    const input = await octInput(f);
    const [restored, again] = await Promise.all([
      setExpenseDeleted(oct.id, f.a, false),
      addWaitingBill(input, f.a, rateOk, { billId: f.billId, period: "2026-10" }, "h5c-again-key-aaaaaa1"),
    ]);
    expect([restored.ok, again.ok].filter(Boolean)).toHaveLength(1);
    const list = await live(f.groupId);
    expect(list.map((e) => e.amount)).toEqual([186000]);
    expect(shareMap(list[0])).toEqual({ [f.a]: 62000, [f.b]: 62000, [f.c]: 62000 });
    expect((await octRun(f)).status).toBe("added");
    expect(await nets(f)).toEqual([124000, -62000, -62000]);
    await settleUp(f);
  });

  it("stopDone: an October being added (status 'adding') holds the stopped bill back, and a deleted month does not", () => {
    const stopped = { paused: true, endMonth: "2026-11", startMonth: "2026-10", every: 1, nature: "daily", amount: 6000, missed: "{}", pausedAt: at("2026-11-20"), tz: "Asia/Kolkata" };
    const nov = { period: "2026-11", status: "added", reason: "" };
    expect(stopDone(stopped, [nov, { period: "2026-10", status: "adding", reason: "" }], at("2026-12-01"))).toBe(false);
    expect(stopDone(stopped, [nov, { period: "2026-10", status: "waiting", reason: "deleted" }], at("2026-12-01"))).toBe(true);
  });

  it("deleting November after the bill ended leaves its month 'added'; Restore brings 114,000 back; A +76,000, B −38,000, C −38,000", async () => {
    const f = await flat("h5d");
    await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"));
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    expect((await billOf(f)).deletedAt).not.toBeNull();
    const nov = (await live(f.groupId))[0];
    expect(nov.amount).toBe(114000);
    expect((await setExpenseDeleted(nov.id, f.a, true)).ok).toBe(true);
    expect((await novRun(f)).status).toBe("added");
    expect(await live(f.groupId)).toHaveLength(0);
    expect(await nets(f)).toEqual([0, 0, 0]);
    expect((await setExpenseDeleted(nov.id, f.a, false)).ok).toBe(true);
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([114000]);
    expect(await nets(f)).toEqual([76000, -38000, -38000]);
    await settleUp(f);
  });
});

// ---------- H11: the stop or pause note early on the 1st ----------
describe("H11: stopped or paused between 00:00 and 06:00 in India on the 1st, before the job has added last month", () => {
  const early = new Date("2026-11-30T19:00:00Z"); // 00:30 in India on 1 Dec
  const eventDetails = async (f: Flat, text: string) => {
    const e = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.groupId, kind: "bill_changed", text }, orderBy: { createdAt: "desc" } });
    return JSON.parse(e.details) as string[];
  };

  it("stop: the confirm and the note say November (₹1,800) is added on 1 Dec, the Activity line carries the note, the job adds 180,000 (60,000 each); A +120,000, B −60,000, C −60,000", async () => {
    const f = await flat("h11a");
    expect((await stopWordsFor(f.billId, early))!.words.stop).toBe("Stop Milk? November (₹1,800) is still added with the monthly bill. Expenses already added stay.");
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", early)).ok).toBe(true);
    const note = "Stopped from 1 Dec. November (₹1,800) is added on 1 Dec with the monthly bill, then Milk ends.";
    expect((await stopWordsFor(f.billId, early))!.words.stoppedNote).toBe(note);
    expect(await eventDetails(f, "stopped Milk")).toEqual([note]);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await live(f.groupId);
    expect(list.map((e) => e.amount)).toEqual([180000]);
    expect(shareMap(list[0])).toEqual({ [f.a]: 60000, [f.b]: 60000, [f.c]: 60000 });
    expect(await nets(f)).toEqual([120000, -60000, -60000]);
    await settleUp(f);
  });

  it("pause: the note says November (₹1,800) is added on 1 Dec; after the job it reads 'Paused from 1 Dec. Nothing more is added until you start it again.'", async () => {
    const f = await flat("h11b");
    expect((await billCommand(f.groupId, f.a, f.billId, "pause", early)).ok).toBe(true);
    const note = "Paused from 1 Dec. November (₹1,800) is added on 1 Dec with the monthly bill. Nothing more is added until you start it again.";
    expect((await stopWordsFor(f.billId, early))!.words.pausedNote).toBe(note);
    expect(await eventDetails(f, "paused Milk")).toEqual([note]);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([180000]);
    expect((await stopWordsFor(f.billId, at("2026-12-01")))!.words.pausedNote).toBe("Paused from 1 Dec. Nothing more is added until you start it again.");
    expect(await nets(f)).toEqual([120000, -60000, -60000]);
    await settleUp(f);
  });

  it("C moved out 10 Nov (20,000 charged): the note says November (₹1,600); the job adds 160,000 (80,000 each for A and B); A +80,000, B −80,000, C 0", async () => {
    const f = await flat("h11c");
    expect((await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-10", addDaily: true, requestKey: `bps-h11c-${stamp}-abcdefgh` }, at("2026-11-10"))).ok).toBe(true);
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", early)).ok).toBe(true);
    expect((await stopWordsFor(f.billId, early))!.words.stoppedNote).toBe("Stopped from 1 Dec. November (₹1,600) is added on 1 Dec with the monthly bill, then Milk ends.");
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const end = (await live(f.groupId)).find((e) => e.description === "Milk")!;
    expect([end.amount, shareMap(end)]).toEqual([160000, { [f.a]: 80000, [f.b]: 80000 }]);
    expect(await nets(f)).toEqual([80000, -80000, 0]);
    await settleUp(f);
  });

  it("stopped at 00:30 India time on 1 Mar 2027: the note says February (₹1,680) (28 × 6,000); the job adds 168,000 (56,000 each)", async () => {
    const f = await flat("h11d", { startMonth: "2027-02" });
    const t = new Date("2027-02-28T19:00:00Z");
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", t)).ok).toBe(true);
    expect((await stopWordsFor(f.billId, t))!.words.stoppedNote).toBe("Stopped from 1 Mar. February (₹1,680) is added on 1 Mar with the monthly bill, then Milk ends.");
    await runBillsForGroup(f.groupId, new Date("2027-03-01T06:00:00Z"));
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([168000]);
    expect(await nets(f)).toEqual([112000, -56000, -56000]);
    await settleUp(f);
  });
});

// ---------- Review fixes: a leaver with a live charge is there only up to the last day on it ----------
describe("review fixes: second leaver, percentage split, weights, stale Add it, moving out again, a change during the run", () => {
  // C moved out 10 Nov (charge 20,000 paid to A, asked of A by B), A says "Not received": C is back, the charge stands.
  async function backFlat(label: string, o: { extra?: boolean } = {}) {
    const f = await flat(label, o);
    await moveOut(f.groupId, f.b, { leaverId: f.c, lastDay: "2026-11-10", addDaily: true, requestKey: `bps-${label}-${stamp}-abcdefgh` }, at("2026-11-10"));
    const pay = await db.payment.findFirstOrThrow({ where: { groupId: f.groupId, fromId: f.c, toId: f.a } });
    expect((await rejectPayment(pay.id, f.a)).ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.c } })).leftAt).toBeNull();
    return f;
  }
  const milkOf = async (f: Flat) => (await live(f.groupId)).filter((e) => e.description === "Milk");

  it("M2: C (back, charge 20,000 up to 10 Nov) is there only to the 10th when B moves out on 25 Nov: B's charge is 10 × 2,000 + 15 × 3,000 = 65,000 (not 50,000); 1 Dec: 180,000 − 20,000 − 65,000 = 95,000, all A's (10 × 2,000 + 15 × 3,000 + 5 × 6,000); A +20,000, B 0, C −20,000", async () => {
    const f = await backFlat("m2");
    const out = await moveOut(f.groupId, f.a, { leaverId: f.b, lastDay: "2026-11-25", addDaily: true, requestKey: `bps-m2b-${stamp}-abcdefgh` }, at("2026-11-25"));
    expect(out).toMatchObject({ ok: true });
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([20000, 65000]);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await milkOf(f);
    expect(list.map((e) => [e.amount, shareMap(e)])).toEqual([[95000, { [f.a]: 95000 }]]);
    expect(await nets(f)).toEqual([20000, 0, -20000]);
    await settleUp(f);
  });

  it("M3: the bill is set to percentages (A 34%, B 33%, C 33%) after C moved out on 10 Nov (charge 20,000 on the flat's own split) and was brought back; stopped 20 Nov: 114,000 − 20,000 = 94,000 goes to A and B only, by days 1–10 at 34 : 33 of 100 and days 11–19 at 34 : 33 of 67: A 47,701, B 46,299; A +66,299, B −46,299, C −20,000", async () => {
    const f = await flat("m3");
    await moveOut(f.groupId, f.b, { leaverId: f.c, lastDay: "2026-11-10", addDaily: true, requestKey: `bps-m3-${stamp}-abcdefgh` }, at("2026-11-10"));
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([20000]);
    const pay = await db.payment.findFirstOrThrow({ where: { groupId: f.groupId, fromId: f.c, toId: f.a } });
    expect((await rejectPayment(pay.id, f.a)).ok).toBe(true);
    // (A person changing the bill to percentages now: a move-out of someone with a percentage puts the bill back on the flat's own split.)
    await db.bill.update({ where: { id: f.billId }, data: { split: JSON.stringify({ mode: "percent", ids: [], pct: { [f.a]: 3400, [f.b]: 3300, [f.c]: 3300 } }) } });
    await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"));
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await milkOf(f);
    expect(list.map((e) => [e.amount, shareMap(e)])).toEqual([[94000, { [f.a]: 47701, [f.b]: 46299 }]]);
    expect(await nets(f)).toEqual([66299, -46299, -20000]);
    await settleUp(f);
  });

  it("the flat's own split by weight through the database: A 1, B 2, C 1, D 1 (in 15 Nov), stopped 20 Nov, 114,000: days 1–14 total 4 (A, B×2, C), days 15–19 total 5; in 38,000ths A = 14×500 + 5×400 = 9,000, B = 18,000, C = 9,000, D = 5×400 = 2,000, and 114,000 ÷ 38,000 = 3 → A 27,000, B 54,000, C 27,000, D 6,000; A +87,000, B −54,000, C −27,000, D −6,000", async () => {
    const f = await flat("weighted", { extra: true });
    await db.bill.update({ where: { id: f.billId }, data: { split: JSON.stringify({ mode: "group" }) } });
    await db.member.update({ where: { id: f.b }, data: { splitWeight: 200 } });
    await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"));
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await milkOf(f);
    expect(list.map((e) => [e.amount, shareMap(e)])).toEqual([[114000, { [f.a]: 27000, [f.b]: 54000, [f.c]: 27000, [f.d]: 6000 }]]);
    const net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c], net[f.d]]).toEqual([87000, -54000, -27000, -6000]);
    await settleUp(f);
  });

  it("L6: an Add it page left open before the charge was deleted is refused ('Milk changed just now. Check it and try again.'), nothing is added; the page built again gives 114,000 = A 47,000, B 47,000, C 20,000 (the same helpers the page uses)", async () => {
    const f = await backFlat("l6");
    await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"));
    await db.billRun.create({ data: { billId: f.billId, period: "2026-11", status: "waiting", reason: "" } });
    const members = await db.member.findMany({ where: { groupId: f.groupId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const formFor = async () => {
      const bill = await billOf(f);
      const pre = await prepaidFor(bill, "2026-11");
      const known = dailyTotal(bill, "2026-11").amount - pre.total;
      return { known, input: billExpenseInput(bill, f.groupId, "INR", "2026-11", known, f.a, members, { entries: pre.entries, gone: pre.gone }) };
    };
    const old = await formFor();
    expect(old.known).toBe(94000);
    expect(old.input).toMatchObject({ forMode: "selected", splitType: "exact", amount: "940", selected: [f.a, f.b] });
    expect(old.input.exact).toEqual({ [f.a]: "470", [f.b]: "470" });
    const charge = (await live(f.groupId)).find((e) => e.description !== "Milk")!;
    expect((await setExpenseDeleted(charge.id, f.a, true)).ok).toBe(true);
    const refused = await addWaitingBill(old.input, f.a, rateOk, { billId: f.billId, period: "2026-11" }, "l6-old-form-key-aaaa1");
    expect(refused).toEqual({ ok: false, error: "Milk changed just now. Check it and try again." });
    expect(await milkOf(f)).toHaveLength(0);
    expect((await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } })).status).toBe("waiting");
    const fresh = await formFor();
    expect(fresh.known).toBe(114000);
    expect(fresh.input.exact).toEqual({ [f.a]: "470", [f.b]: "470", [f.c]: "200" });
    expect(errorOf(await asOf(at("2026-12-01"), () => addWaitingBill(fresh.input, f.a, rateOk, { billId: f.billId, period: "2026-11" }, "l6-new-form-key-aaaa1")))).toBe("");
    const end = (await milkOf(f))[0];
    expect([end.amount, shareMap(end)]).toEqual([114000, { [f.a]: 47000, [f.b]: 47000, [f.c]: 20000 }]);
    expect(await nets(f)).toEqual([67000, -47000, -20000]);
    await settleUp(f);
  });

  it("L7: C is back (settling up only), his charge was deleted, then someone tries to move him out again on 23 Nov (bill stopped 20 Nov): refused, nothing is charged; the month end keeps his days 1–10: 114,000 = A 47,000, B 47,000, C 20,000; A +67,000, B −47,000, C −20,000, then C pays A 20,000 and is moved out again", async () => {
    const f = await backFlat("l7");
    await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"));
    const charge = (await live(f.groupId)).find((e) => e.description !== "Milk")!;
    expect((await setExpenseDeleted(charge.id, f.a, true)).ok).toBe(true);
    // (Before this change C could be moved out again by hand and was charged 19 × 2,000 = 38,000. Now the app moves him out when he is square.)
    const again = await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-23", addDaily: true, requestKey: `bps-l7b-${stamp}-abcdefgh` }, at("2026-11-23"));
    expect(again).toEqual({ ok: false, error: SETTLING_NO_MOVE_OUT });
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([]);
    expect(await nets(f)).toEqual([0, 0, 0]);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const end = (await milkOf(f))[0];
    expect([end.amount, shareMap(end)]).toEqual([114000, { [f.a]: 47000, [f.b]: 47000, [f.c]: 20000 }]);
    expect(await nets(f)).toEqual([67000, -47000, -20000]);
    await payAsC(f, 20000, "l7c");
    expect((await db.member.findUniqueOrThrow({ where: { id: f.c } })).leftAt?.toISOString()).toBe("2026-11-10T12:00:00.000Z");
    await settleUp(f);
  });

  it("L5: C's charge is deleted behind the app's back while the month end is being saved: the save is refused (no expense, the claim is given back, nothing lost); the next run adds 114,000 = A 47,000, B 47,000, C 20,000", async () => {
    const f = await backFlat("l5");
    await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"));
    const charge = (await live(f.groupId)).find((e) => e.description !== "Milk")!;
    let fired = false;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await runBillsForGroup(f.groupId, at("2026-12-01"), {
        afterRead: async () => {
          if (fired) return;
          fired = true;
          await db.expense.update({ where: { id: charge.id }, data: { deletedAt: new Date() } }); // (the app itself locks it now: this stands for a change that got in first)
        },
      });
    } finally {
      quiet.mockRestore();
    }
    expect(fired).toBe(true);
    expect(await milkOf(f)).toHaveLength(0);
    expect(await db.billRun.findUnique({ where: { billId_period: { billId: f.billId, period: "2026-11" } } })).toBeNull(); // the month is still due: the claim is simply given back
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const end = (await milkOf(f))[0];
    expect([end.amount, shareMap(end)]).toEqual([114000, { [f.a]: 47000, [f.b]: 47000, [f.c]: 20000 }]);
  });
});

// ---------- Review round 2 ----------
describe("review round 2: harmless changes during the run, a deliberately edited total, moving out again and undoing it", () => {
  async function backFlat(label: string) {
    const f = await flat(label);
    await moveOut(f.groupId, f.b, { leaverId: f.c, lastDay: "2026-11-10", addDaily: true, requestKey: `bps-${label}-${stamp}-abcdefgh` }, at("2026-11-10"));
    const pay = await db.payment.findFirstOrThrow({ where: { groupId: f.groupId, fromId: f.c, toId: f.a } });
    expect((await rejectPayment(pay.id, f.a)).ok).toBe(true);
    await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"));
    await db.billRun.create({ data: { billId: f.billId, period: "2026-11", status: "waiting", reason: "" } });
    return f;
  }
  const milkOf = async (f: Flat) => (await live(f.groupId)).filter((e) => e.description === "Milk");
  // The Add it page for November as the page builds it: the pre-filled form and its fingerprint.
  async function page(f: Flat) {
    const bill = await billOf(f);
    const pre = await prepaidFor(bill, "2026-11");
    const members = await db.member.findMany({ where: { groupId: f.groupId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const input = billExpenseInput(bill, f.groupId, "INR", "2026-11", dailyTotal(bill, "2026-11").amount - pre.total, f.a, members, { entries: pre.entries, gone: pre.gone });
    return { input, fp: billFormFingerprint(dailyTotal(bill, "2026-11").amount, pre.entries) };
  }
  const runRow = (f: Flat) => db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } });

  it("a weight edit while the month end is being saved does not hold it up: one Milk expense, 180,000 (60,000 each); A +120,000, B −60,000, C −60,000", async () => {
    const f = await flat("w1");
    let fired = false;
    await runBillsForGroup(f.groupId, at("2026-12-01"), { afterRead: async () => { fired = true; await db.member.update({ where: { id: f.b }, data: { splitWeight: 150 } }); } });
    expect(fired).toBe(true);
    const list = await live(f.groupId);
    expect(list.map((e) => [e.amount, shareMap(e)])).toEqual([[180000, { [f.a]: 60000, [f.b]: 60000, [f.c]: 60000 }]]);
    expect(await nets(f)).toEqual([120000, -60000, -60000]);
  });

  it("someone unrelated joining while the month end is being saved does not hold it up either: one Milk expense of 180,000, the month is 'added', the books add up", async () => {
    const f = await flat("w2");
    await runBillsForGroup(f.groupId, at("2026-12-01"), { afterRead: async () => void (await db.member.create({ data: { groupId: f.groupId, name: "E" } })) });
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([180000]);
    expect((await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } })).status).toBe("added");
    await checkBooks(f.groupId);
  });

  it("an Add it page left open: a charge deleted since the page was built is refused ('Milk changed just now…') with the month still waiting; a form that would charge C again is refused in its own words", async () => {
    const f = await backFlat("fp1");
    const open = await page(f);
    const key = (n: string) => `fp1-${n}-key-aaaaaaa1`;
    // A form that charges C (whose charge stands) as well is refused, and the claim is given back.
    const withC = { ...open.input, forMode: "everyone" as const, selected: [], splitType: "equal" as const, exact: {} };
    expect(await addWaitingBill(withC, f.a, rateOk, { billId: f.billId, period: "2026-11", fp: open.fp }, key("c"))).toEqual({
      ok: false,
      error: "C already paid their part of Milk for this month when they moved out, so they can’t be in this split. Take them out and try again.",
    });
    expect((await runRow(f)).status).toBe("waiting");
    // The charge is deleted after the page was built.
    const charge = (await live(f.groupId)).find((e) => e.description !== "Milk")!;
    expect((await setExpenseDeleted(charge.id, f.a, true)).ok).toBe(true);
    expect(await addWaitingBill(open.input, f.a, rateOk, { billId: f.billId, period: "2026-11", fp: open.fp }, key("old"))).toEqual({ ok: false, error: "Milk changed just now. Check it and try again." });
    expect(await milkOf(f)).toHaveLength(0);
    expect((await runRow(f)).status).toBe("waiting");
  });

  it("a deliberately edited total goes through: the milkman billed 92,000, not 94,000: the page's amounts are shared again day by day, A 46,000, B 46,000, C nothing; A +66,000, B −46,000, C −20,000", async () => {
    const f = await backFlat("fp2");
    const open = await page(f);
    const edited = { ...open.input, amount: "920" }; // the typed amounts (470 + 470) no longer add up to it
    const r = await asOf(at("2026-12-01"), () => addWaitingBill(edited, f.a, rateOk, { billId: f.billId, period: "2026-11", fp: open.fp }, "fp2-edited-key-aaaaa1"));
    expect(errorOf(r)).toBe("");
    const end = (await milkOf(f))[0];
    expect([end.amount, shareMap(end)]).toEqual([92000, { [f.a]: 46000, [f.b]: 46000 }]);
    expect(await nets(f)).toEqual([66000, -46000, -20000]);
    await settleUp(f);
  });

  it("an older page without a fingerprint: accepted when its total is what the month comes to (94,000 = 47,000 + 47,000), refused when it is not (92,000)", async () => {
    const f = await backFlat("fp3");
    const open = await page(f);
    const odd = await addWaitingBill({ ...open.input, amount: "920" }, f.a, rateOk, { billId: f.billId, period: "2026-11" }, "fp3-odd-key-aaaaaaa1");
    expect(odd).toEqual({ ok: false, error: "Milk changed just now. Check it and try again." });
    expect((await runRow(f)).status).toBe("waiting");
    expect(errorOf(await asOf(at("2026-12-01"), () => addWaitingBill(open.input, f.a, rateOk, { billId: f.billId, period: "2026-11" }, "fp3-good-key-aaaaaa1")))).toBe("");
    const end = (await milkOf(f))[0];
    expect([end.amount, shareMap(end)]).toEqual([94000, { [f.a]: 47000, [f.b]: 47000 }]);
    expect(await nets(f)).toEqual([67000, -47000, -20000]);
    await settleUp(f);
  });

  it("L7 then a second move-out: refused (C is settling up only, so there is no later move-out to undo), C stays on the deleted-charge rule, sharing only days 1–10: 114,000 = A 47,000, B 47,000, C 20,000; A +67,000, B −47,000, C −20,000", async () => {
    const f = await flat("l7u");
    await moveOut(f.groupId, f.b, { leaverId: f.c, lastDay: "2026-11-10", addDaily: true, requestKey: `bps-l7u-${stamp}-abcdefgh` }, at("2026-11-10"));
    const pay = await db.payment.findFirstOrThrow({ where: { groupId: f.groupId, fromId: f.c, toId: f.a } });
    expect((await rejectPayment(pay.id, f.a)).ok).toBe(true);
    await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"));
    const charge = (await live(f.groupId)).find((e) => e.description !== "Milk")!;
    expect((await setExpenseDeleted(charge.id, f.a, true)).ok).toBe(true);
    const again = await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-23", addDaily: true, requestKey: `bps-l7u2-${stamp}-abcdefgh` }, at("2026-11-23"));
    expect(again).toEqual({ ok: false, error: SETTLING_NO_MOVE_OUT });
    expect((await db.member.findUniqueOrThrow({ where: { id: f.c } })).leftAt).toBeNull(); // still settling up only (the row says "in")
    expect((JSON.parse((await billOf(f)).prepaid) as Record<string, { d?: string }[]>)["2026-11"].map((x) => x.d)).toEqual(["2026-11-10"]); // only the old entry is there
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const end = (await milkOf(f))[0];
    expect([end.amount, shareMap(end)]).toEqual([114000, { [f.a]: 47000, [f.b]: 47000, [f.c]: 20000 }]);
    expect(await nets(f)).toEqual([67000, -47000, -20000]);
    await settleUp(f);
  });
  it("a form for one person, C, whose charge stands, is refused in the same words as an everyone split (C can't pay twice)", async () => {
    const f = await backFlat("one");
    const open = await page(f);
    const onlyC = { ...open.input, forMode: "one" as const, onePersonId: f.c, selected: [f.c], splitType: "equal" as const, exact: {} };
    expect(await addWaitingBill(onlyC, f.a, rateOk, { billId: f.billId, period: "2026-11", fp: open.fp }, "one-c-key-aaaaaaaaa1")).toEqual({
      ok: false,
      error: "C already paid their part of Milk for this month when they moved out, so they can’t be in this split. Take them out and try again.",
    });
    expect(await milkOf(f)).toHaveLength(0);
  });

  it("the old deleted charge can't be restored while C's newer move-out charge for the month stands (C would pay days 1–10 twice): C moves out 10 Nov (charge 20,000), is brought back, his charge is deleted, A notes he moved back in on 12 Nov, and he moves out again on 20 Nov: 9 days x 2,000 = 18,000", async () => {
    const f = await flat("rep");
    await moveOut(f.groupId, f.b, { leaverId: f.c, lastDay: "2026-11-10", addDaily: true, requestKey: `bps-rep-${stamp}-abcdefgh` }, at("2026-11-10"));
    const pay = await db.payment.findFirstOrThrow({ where: { groupId: f.groupId, fromId: f.c, toId: f.a } });
    expect((await rejectPayment(pay.id, f.a)).ok).toBe(true);
    const old = (await live(f.groupId)).find((e) => e.description !== "Milk")!;
    expect((await setExpenseDeleted(old.id, f.a, true)).ok).toBe(true);
    // C is settling up only, so he can't be moved out by hand: A notes he moved back in (from 12 Nov, a full member), and only then is he moved out again.
    expect(await moveBackInFor(f.groupId, f.a, f.c, at("2026-11-12"))).toMatchObject({ ok: true });
    // Days 12 to 20 Nov, all three of them in the flat, 6,000 a day shared three ways: 9 days x 2,000 = 18,000 (paid by A, who pays the milk).
    expect(await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-20", addDaily: true, requestKey: `bps-rep2-${stamp}-abcdefgh` }, at("2026-11-20"))).toMatchObject({ ok: true });
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([18000]);
    // C is brought back again ("Not received" on the new square-up), so nothing else stops the old charge coming back.
    const pay2 = await db.payment.findFirstOrThrow({ where: { groupId: f.groupId, fromId: f.c, toId: f.a, id: { not: pay.id } }, orderBy: { createdAt: "desc" } });
    expect(pay2.amount).toBe(18000);
    expect((await rejectPayment(pay2.id, f.a)).ok).toBe(true);
    expect(await setExpenseDeleted(old.id, f.a, false)).toEqual({ ok: false, error: "A newer move-out charge for this month’s Milk stands, so this one can’t come back." });
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([18000]);
    expect(await nets(f)).toEqual([18000, 0, -18000]);
  });

  it("on the last day the job still looks at November (31 Dec), a month refused because a charge changed mid-save becomes a waiting month a person sees, not released and lost", async () => {
    const f = await flat("last");
    await moveOut(f.groupId, f.b, { leaverId: f.c, lastDay: "2026-11-10", addDaily: true, requestKey: `bps-last-${stamp}-abcdefgh` }, at("2026-11-10"));
    const pay = await db.payment.findFirstOrThrow({ where: { groupId: f.groupId, fromId: f.c, toId: f.a } });
    expect((await rejectPayment(pay.id, f.a)).ok).toBe(true);
    await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"));
    const charge = (await live(f.groupId)).find((e) => e.description !== "Milk")!;
    let fired = false;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await runBillsForGroup(f.groupId, at("2026-12-31"), {
        afterRead: async () => {
          if (fired) return;
          fired = true;
          await db.expense.update({ where: { id: charge.id }, data: { deletedAt: new Date() } });
        },
      });
    } finally {
      quiet.mockRestore();
    }
    expect(fired).toBe(true);
    expect(await milkOf(f)).toHaveLength(0);
    expect((await runRow(f)).status).toBe("waiting");
  });
});
