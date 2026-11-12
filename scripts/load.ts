// Load test with realistic data and many people at once.
// 1. Fills the test database with a realistic amount of data:
//    - 400 people, 120 groups of 3–12 people, ~40 expenses each;
//    - one very busy 12-person trip with 1,200 expenses and 300 payments;
//    - one heavy user who is in 20 groups (including the busy one).
// 2. Opens the main screens as that heavy user, with 1, 10 and 25 people at
//    the same moment, and measures how long each takes (median and 95th %).
// 3. Saves 200 expenses from 20 people at the same moment and checks every
//    balance still adds up to zero.
// 4. One person at a time: for each screen, how many database calls, how many rows,
//    how long the database took and how long everything else took (JS and drawing).
//    Needs the server started with LOOPIN_PERF=1 and its log in LOOPIN_PERF_LOG
//    (without them the queries columns say n/a).
// Writes screenshots/uat/load.md and load.json (read by scripts/load-gates.mjs).
// Needs the app running on :3000.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { encodeSession, SESSION_COOKIE } from "../src/lib/session";
import { saveExpense } from "../src/lib/save-expense";
import { netBalances } from "../src/lib/balances";

const base = process.env.APP_URL ?? "http://localhost:3000";
const out = "screenshots/uat";
mkdirSync(out, { recursive: true });
const lines: string[] = ["# Load test", ""];
const log = (s = "") => {
  console.log(s);
  lines.push(s);
};
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]) => a[rnd(a.length)];

async function seed() {
  const t0 = Date.now();
  const stamp = Date.now();
  const accounts = [];
  for (let i = 0; i < 400; i++) accounts.push({ id: `la${stamp}${i}`, email: `load${i}-${stamp}@load.test`, name: `Person ${i}` });
  await db.account.createMany({ data: accounts });
  const heavy = accounts[0];
  const memberships: Record<string, string> = {};
  let expenseCount = 0, paymentCount = 0;

  async function makeGroup(name: string, size: number, expenses: number, payments: number, withHeavy: boolean) {
    const people = new Set<(typeof accounts)[number]>(withHeavy ? [heavy] : []);
    while (people.size < size) people.add(pick(accounts.slice(1)));
    const g = await db.group.create({
      data: {
        name, currency: "INR", inviteCode: `load-${stamp}-${name.replace(/\W/g, "")}-${rnd(1e9)}`, cardMarkupBp: 300,
        members: { create: [...people].map((a) => ({ name: a.name, accountId: a.id, claimedAt: new Date() })) },
      },
      include: { members: true },
    });
    const ids = g.members.map((m) => m.id);
    if (withHeavy) memberships[g.id] = g.members.find((m) => m.accountId === heavy.id)!.id;
    const rows = [];
    for (let i = 0; i < expenses; i++) {
      const amount = (rnd(5000) + 100) * 100;
      const who = ids.filter(() => Math.random() < 0.7);
      const forIds = who.length ? who : ids;
      const each = Math.floor(amount / forIds.length);
      const shares = forIds.map((id, k) => ({ memberId: id, amount: each + (k === 0 ? amount - each * forIds.length : 0) }));
      rows.push({ amount, payer: pick(ids), shares, day: new Date(Date.now() - rnd(90) * 86_400_000) });
    }
    // createMany can't nest shares, so expenses go in small transactions.
    for (let i = 0; i < rows.length; i += 50) {
      await db.$transaction(
        rows.slice(i, i + 50).map((r, k) =>
          db.expense.create({
            data: {
              groupId: g.id, description: `Expense ${i + k}`, category: pick(["food", "transport", "accommodation", "activities", "groceries"]),
              amount: r.amount, splitType: "equal", forMode: "selected", paidById: r.payer, createdById: r.payer,
              originalAmount: r.amount, originalCurrency: "INR", baseCurrency: "INR", exchangeRate: "1", rateDate: "2026-10-01",
              rateSource: "same", convertedAmount: r.amount, paymentMethod: "cash", markupBp: 0, markupAmount: 0, spentAt: r.day,
              shares: { create: r.shares },
            },
          }),
        ),
      );
    }
    if (payments) {
      await db.payment.createMany({
        data: Array.from({ length: payments }, () => {
          const [a, b] = [pick(ids), pick(ids)];
          return { groupId: g.id, fromId: a, toId: a === b ? ids[(ids.indexOf(a) + 1) % ids.length] : b, amount: (rnd(2000) + 50) * 100, createdById: a };
        }),
      });
    }
    await db.groupEvent.createMany({
      data: Array.from({ length: Math.min(200, expenses) }, (_, i) => ({ groupId: g.id, actorId: pick(ids), kind: "expense_added", text: `added Expense ${i}`, details: "[]", undo: "" })),
    });
    expenseCount += expenses;
    paymentCount += payments;
    return g;
  }

  // The awkward cases real trips have: split payers, refunds, deleted things, another currency,
  // someone who left, and changes with real Undo text.
  async function addHardCases(g: { id: string; members: { id: string; accountId: string | null }[] }) {
    const ids = g.members.map((m) => m.id);
    const heavyMember = g.members.find((m) => m.accountId === heavy.id)!.id;
    const others = ids.filter((i) => i !== heavyMember);
    const equal = (amount: number, who: string[]) => {
      const each = Math.floor(amount / who.length);
      return who.map((memberId, k) => ({ memberId, amount: each + (k === 0 ? amount - each * who.length : 0) }));
    };
    const base = { groupId: g.id, splitType: "equal", forMode: "selected", originalCurrency: "INR", baseCurrency: "INR", exchangeRate: "1", rateDate: "2026-10-01", rateSource: "same", paymentMethod: "cash", markupBp: 0, markupAmount: 0 };
    const some = (n: number) => [...ids].sort(() => Math.random() - 0.5).slice(0, n);
    // Two people paid together (60 / 40).
    for (let i = 0; i < 20; i++) {
      const amount = (rnd(5000) + 1000) * 100;
      const [a, b] = some(2);
      const first = Math.floor(amount * 0.6);
      await db.expense.create({
        data: { ...base, description: `Split payers ${i}`, category: "food", amount, originalAmount: amount, convertedAmount: amount, paidById: a, createdById: a, payers: JSON.stringify([{ m: a, a: first }, { m: b, a: amount - first }]), spentAt: new Date(Date.now() - rnd(60) * 86_400_000), shares: { create: equal(amount, some(4 + rnd(6))) } },
      });
    }
    // Money back.
    for (let i = 0; i < 10; i++) {
      const amount = (rnd(1000) + 100) * 100;
      const [a] = some(1);
      await db.expense.create({
        data: { ...base, description: `Refund ${i}`, category: "shopping", kind: "refund", amount, originalAmount: amount, convertedAmount: amount, paidById: a, createdById: a, spentAt: new Date(Date.now() - rnd(60) * 86_400_000), shares: { create: equal(amount, some(3)) } },
      });
    }
    // Deleted expenses and payments (kept in history, never counted).
    for (let i = 0; i < 15; i++) {
      const amount = (rnd(3000) + 100) * 100;
      const [a] = some(1);
      await db.expense.create({
        data: { ...base, description: `Deleted expense ${i}`, category: "other", amount, originalAmount: amount, convertedAmount: amount, paidById: a, createdById: a, deletedAt: new Date(), deletedById: a, shares: { create: equal(amount, some(4)) } },
      });
    }
    await db.payment.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({ groupId: g.id, fromId: ids[i % ids.length], toId: ids[(i + 1) % ids.length], amount: (rnd(2000) + 50) * 100, createdById: ids[i % ids.length], deletedAt: new Date() })),
    });
    // Spending in Thai baht on a card (3% fee): the saved rate and fee are part of the total.
    for (let i = 0; i < 30; i++) {
      const original = (rnd(3000) + 200) * 100;
      const converted = Math.round(original * 2.8367);
      const markupAmount = Math.round(converted * 0.03);
      const amount = converted + markupAmount;
      const [a] = some(1);
      await db.expense.create({
        data: { ...base, description: `Baht ${i}`, category: "food", amount, originalAmount: original, originalCurrency: "THB", exchangeRate: "2.8367", rateSource: "api", paymentMethod: "card", convertedAmount: converted, markupBp: 300, markupAmount, paidById: a, createdById: a, spentAt: new Date(Date.now() - rnd(60) * 86_400_000), shares: { create: equal(amount, some(3 + rnd(8))) } },
      });
    }
    // Someone who left the trip.
    await db.member.update({ where: { id: others[others.length - 1] }, data: { leftAt: new Date(Date.now() - 5 * 86_400_000) } });
    // Recent changes with real wording and a real way to undo them.
    const recent = await db.expense.findMany({ where: { groupId: g.id, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, description: true, amount: true, paidById: true } });
    let lastEvent = "";
    for (const e of recent) {
      const ev = await db.groupEvent.create({
        data: { groupId: g.id, actorId: e.paidById, kind: "expense_added", text: `added ${e.description} (₹${(e.amount / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })})`, details: JSON.stringify([`Amount: ₹${e.amount / 100}`, "Split: equally"]), expenseId: e.id, touches: ids.slice(0, 6).join(","), undo: JSON.stringify({ type: "expense_delete", expenseId: e.id }) },
      });
      lastEvent = ev.id;
    }
    expenseCount += 75;
    return lastEvent;
  }

  const busy = await makeGroup("Busy 12-person trip", 12, 1200, 300, true);
  const undoEventId = await addHardCases(busy);
  // A trip the heavy user has left (the leaver view has its own, slower code path).
  const left = await makeGroup("Left trip", 6, 60, 10, true);
  await db.member.update({ where: { id: memberships[left.id] }, data: { leftAt: new Date(Date.now() - 20 * 86_400_000) } });
  for (let i = 0; i < 19; i++) await makeGroup(`Heavy user group ${i}`, 3 + rnd(10), 20 + rnd(60), rnd(15), true);
  for (let i = 0; i < 100; i++) await makeGroup(`Other group ${i}`, 3 + rnd(10), 10 + rnd(60), rnd(10), false);
  log(`Seeded 400 people, 120 groups, ${expenseCount} expenses, ${paymentCount} payments in ${Math.round((Date.now() - t0) / 1000)} s.`);
  log(`Heavy user: in ${Object.keys(memberships).length} groups. Busy trip: about 1,275 expenses (split payers, refunds, deleted ones, Thai baht with card fee), 310 payments (10 deleted), 12 people, one who left, real Undo wording.`);
  log("Also a trip the heavy user left.");
  return { heavy, memberships, busy, left, undoEventId };
}

async function timeGet(path: string, cookie: string) {
  const t = performance.now();
  const r = await fetch(base + path, { headers: { cookie } });
  await r.text();
  return { ms: performance.now() - t, ok: r.ok };
}
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

// ---- One person at a time, joined with the server's own log (LOOPIN_PERF=1) ----
type PerfQuery = { t: number; ms: number; m: string; op: string; rows: number };
type PerfLoop = { t: number; p99: number; max: number };
function readPerfLog(): { queries: PerfQuery[]; loop: PerfLoop[] } | null {
  const file = process.env.LOOPIN_PERF_LOG;
  if (!file || !existsSync(file)) return null;
  const queries: PerfQuery[] = [];
  const loop: PerfLoop[] = [];
  const Q = "LOOPIN_PERF_Q ";
  const L = "LOOPIN_PERF_LOOP ";
  for (const line of readFileSync(file, "utf8").split("\n")) {
    try {
      const i = line.indexOf(Q);
      if (i >= 0) {
        queries.push(JSON.parse(line.slice(i + Q.length)));
        continue;
      }
      const j = line.indexOf(L);
      if (j >= 0) loop.push(JSON.parse(line.slice(j + L.length)));
    } catch {
      /* a half-written line: skip it */
    }
  }
  return { queries, loop };
}

export type ScreenProfile = { totalMs: number; queries: number | null; rows: number | null; dbMs: number | null; otherMs: number | null; kb: number; slowest: string; loopP99: number | null };

async function profileScreens(pages: [string, string][], cookie: string): Promise<Record<string, ScreenProfile>> {
  const RUNS = 5;
  const runs: Record<string, { t0: number; t1: number; bytes: number }[]> = {};
  for (const [label, p] of pages) {
    await fetch(base + p, { headers: { cookie } }).then((r) => r.text()); // warm up
    runs[label] = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = Date.now();
      const r = await fetch(base + p, { headers: { cookie } });
      const bytes = (await r.arrayBuffer()).byteLength;
      runs[label].push({ t0, t1: Date.now(), bytes });
      await new Promise((ok) => setTimeout(ok, 60)); // let background work from this request end
    }
  }
  await new Promise((ok) => setTimeout(ok, 1500)); // the server's log is written as it goes; give it a moment
  const perf = readPerfLog();
  const med = (xs: number[]) => pct(xs, 50);
  const result: Record<string, ScreenProfile> = {};
  log("");
  log(perf ? "## One person at a time (median of 5 requests, one after another)" : "## One person at a time (the server log was not available: query columns are n/a)");
  log("");
  log("| Screen | Total ms | DB calls | Rows read | DB ms | Other ms (JS + drawing) | KB sent | Slowest call |");
  log("|---|---|---|---|---|---|---|---|");
  for (const [label] of pages) {
    const rs = runs[label];
    const per = rs.map((r) => {
      const qs = perf ? perf.queries.filter((q) => q.t >= r.t0 - 2 && q.t <= r.t1 + 2) : [];
      const dbMs = qs.reduce((a, q) => a + q.ms, 0);
      const loops = perf ? perf.loop.filter((l) => l.t >= r.t0 && l.t <= r.t1 + 1000) : [];
      const slow = [...qs].sort((a, b) => b.ms - a.ms)[0];
      return {
        total: r.t1 - r.t0,
        n: qs.length,
        rows: qs.reduce((a, q) => a + q.rows, 0),
        dbMs,
        bytes: r.bytes,
        slow: slow ? `${slow.m}.${slow.op} ${Math.round(slow.ms)} ms (${slow.rows} rows)` : "",
        loop: loops.length ? Math.max(...loops.map((l) => l.p99)) : null,
      };
    });
    const total = med(per.map((x) => x.total));
    const have = Boolean(perf);
    const dbMs = med(per.map((x) => x.dbMs));
    const prof: ScreenProfile = {
      totalMs: total,
      queries: have ? med(per.map((x) => x.n)) : null,
      rows: have ? med(per.map((x) => x.rows)) : null,
      dbMs: have ? dbMs : null,
      // Database calls can overlap, so this is a guide, never below zero.
      otherMs: have ? Math.max(0, total - dbMs) : null,
      kb: Math.round(med(per.map((x) => x.bytes)) / 1024),
      slowest: per[per.length - 1].slow,
      loopP99: have ? per[per.length - 1].loop : null,
    };
    result[label] = prof;
    const n = (x: number | null) => (x === null ? "n/a" : String(x));
    log(`| ${label} | ${prof.totalMs} | ${n(prof.queries)} | ${n(prof.rows)} | ${n(prof.dbMs)} | ${n(prof.otherMs)} | ${prof.kb} | ${prof.slowest || "—"} |`);
  }
  if (perf && perf.loop.length) {
    const worst = Math.max(...perf.loop.map((l) => l.p99));
    log("");
    log(`Server busy-ness: the slowest second held the server's single thread up by ${worst} ms (99th percentile within that second).`);
  }
  return result;
}

async function main() {
  const { heavy, memberships, busy, left, undoEventId } = await seed();
  const cookie = `${SESSION_COOKIE}=${await encodeSession({ m: memberships, a: heavy.id })}`;
  const pages: [string, string][] = [
    ["Home", "/"],
    ["Busy trip: activity", `/groups/${busy.id}?tab=activity`],
    ["Busy trip: balances", `/groups/${busy.id}?tab=balances`],
    ["Busy trip: charts", `/groups/${busy.id}?tab=charts`],
    ["Busy trip: settle up", `/groups/${busy.id}/settle`],
    ["Settle across groups", "/settle"],
    ["Search “Expense 1”", "/search?q=Expense%201"],
    ["Alerts", "/notifications"],
  ];
  for (const [, p] of pages) await timeGet(p, cookie); // warm up

  log("", );
  log("## Opening screens (milliseconds; median / 95th percentile)");
  log("");
  log("| Screen | 1 person | 10 at once | 25 at once | Errors |");
  log("|---|---|---|---|---|");
  const timing: Record<string, Record<number, { median: number; p95: number }>> = {};
  for (const [label, p] of pages) {
    const cells: string[] = [];
    let errors = 0;
    timing[label] = {};
    for (const users of [1, 10, 25]) {
      const times: number[] = [];
      for (let round = 0; round < 3; round++) {
        const rs = await Promise.all(Array.from({ length: users }, () => timeGet(p, cookie)));
        rs.forEach((r) => (r.ok ? times.push(r.ms) : errors++));
      }
      if (times.length) timing[label][users] = { median: pct(times, 50), p95: pct(times, 95) };
      cells.push(times.length ? `${pct(times, 50)} / ${pct(times, 95)}` : "—");
    }
    log(`| ${label} | ${cells.join(" | ")} | ${errors} |`);
  }

  // One person at a time: what each screen costs (needs the server's LOOPIN_PERF=1 log).
  const profile = await profileScreens(
    [
      ...pages,
      ["Busy trip: balances, with Undo bar", `/groups/${busy.id}?tab=balances&did=${undoEventId}`],
      ["Trip I left: balances", `/groups/${left.id}?tab=balances`],
      ["Trip I left: activity", `/groups/${left.id}?tab=activity`],
    ],
    cookie,
  );

  // 20 people adding 10 expenses each, all at the same time.
  log("");
  log("## Saving at the same time");
  const members = await db.member.findMany({ where: { groupId: busy.id, leftAt: null } }); // (someone who left can't add expenses)
  const rate = async () => ({ ok: true as const, rate: "1", date: "2026-10-16" });
  const t = performance.now();
  const results = await Promise.all(
    Array.from({ length: 200 }, (_, i) => {
      const me = members[i % members.length];
      return saveExpense(
        {
          groupId: busy.id, name: `Rush ${i}`, category: "", amount: String(100 + i), currency: "INR", paidById: me.id, forMode: "everyone",
          selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group",
          markupCustom: "", rateMode: "auto", manualRate: "",
        },
        me.id,
        rate,
        { requestKey: `load-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 10)}` },
      ).catch((e) => ({ ok: false as const, error: String(e).slice(0, 80) }));
    }),
  );
  const ms = performance.now() - t;
  const okCount = results.filter((r) => r.ok).length;
  const saved = await db.expense.count({ where: { groupId: busy.id, description: { startsWith: "Rush " } } });
  const all = await db.expense.findMany({ where: { groupId: busy.id, deletedAt: null }, include: { shares: true } });
  const pays = await db.payment.findMany({ where: { groupId: busy.id, deletedAt: null } });
  const net = netBalances(members.map((m) => m.id), all, pays);
  const sum = Object.values(net).reduce((a, b) => a + b, 0);
  log(`200 expenses from 12 people at once: ${okCount} saved OK, ${saved} in the database, ${Math.round(ms)} ms in total (${Math.round(ms / 200)} ms each on average).`);
  log(`Balances still add up to zero: ${sum === 0 ? "yes ✓" : `NO (off by ${sum})`}.`);
  const failed = results.filter((r) => !r.ok).slice(0, 3).map((r) => (r as { error: string }).error);
  if (failed.length) log(`First errors: ${failed.join(" | ")}`);

  writeFileSync(`${out}/load.md`, lines.join("\n"));
  writeFileSync(`${out}/load.json`, JSON.stringify({ timing, profile }, null, 1));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    writeFileSync(`${out}/load.md`, `${lines.join("\n")}\n\nCrashed: ${String(e)}`);
    process.exit(0);
  });
