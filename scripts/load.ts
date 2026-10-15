// Load test with realistic data and many people at once.
// 1. Fills the test database with a realistic amount of data:
//    - 400 people, 120 groups of 3–12 people, ~40 expenses each;
//    - one very busy 12-person trip with 1,200 expenses and 300 payments;
//    - one heavy user who is in 20 groups (including the busy one).
// 2. Opens the main screens as that heavy user, with 1, 10 and 25 people at
//    the same moment, and measures how long each takes (median and 95th %).
// 3. Saves 200 expenses from 20 people at the same moment and checks every
//    balance still adds up to zero.
// Writes screenshots/uat/load.md. Needs the app running on :3000.
import { mkdirSync, writeFileSync } from "node:fs";
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

  const busy = await makeGroup("Busy 12-person trip", 12, 1200, 300, true);
  for (let i = 0; i < 19; i++) await makeGroup(`Heavy user group ${i}`, 3 + rnd(10), 20 + rnd(60), rnd(15), true);
  for (let i = 0; i < 100; i++) await makeGroup(`Other group ${i}`, 3 + rnd(10), 10 + rnd(60), rnd(10), false);
  log(`Seeded 400 people, 120 groups, ${expenseCount} expenses, ${paymentCount} payments in ${Math.round((Date.now() - t0) / 1000)} s.`);
  log(`Heavy user: in ${Object.keys(memberships).length} groups. Busy trip: 1,200 expenses, 300 payments, 12 people.`);
  return { heavy, memberships, busy };
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

async function main() {
  const { heavy, memberships, busy } = await seed();
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
  for (const [label, p] of pages) {
    const cells: string[] = [];
    let errors = 0;
    for (const users of [1, 10, 25]) {
      const times: number[] = [];
      for (let round = 0; round < 3; round++) {
        const rs = await Promise.all(Array.from({ length: users }, () => timeGet(p, cookie)));
        rs.forEach((r) => (r.ok ? times.push(r.ms) : errors++));
      }
      cells.push(times.length ? `${pct(times, 50)} / ${pct(times, 95)}` : "—");
    }
    log(`| ${label} | ${cells.join(" | ")} | ${errors} |`);
  }

  // 20 people adding 10 expenses each, all at the same time.
  log("");
  log("## Saving at the same time");
  const members = await db.member.findMany({ where: { groupId: busy.id } });
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
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    writeFileSync(`${out}/load.md`, `${lines.join("\n")}\n\nCrashed: ${String(e)}`);
    process.exit(0);
  });
