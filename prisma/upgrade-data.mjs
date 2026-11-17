// Brings data saved by older versions of the app up to date.
// Safe to run any number of times: it only touches rows that still need it.
// The only things it deletes are expired housekeeping rows (old sign-in codes,
// rate-limit counters, old error logs). It never deletes groups: erasing groups
// deleted more than 30 days ago is the daily job's work (eraseExpiredGroups in
// src/lib/purge.ts). Runs before `npm run dev` and on deploy.
import { PrismaClient } from "@prisma/client";

// Preview builds of unfinished branches must never change live data.
if (process.env.VERCEL && process.env.VERCEL_ENV !== "production") {
  console.log(`upgrade-data: ${process.env.VERCEL_ENV} build, leaving the data alone.`);
  process.exit(0);
}

// Hosted app: Turso (online SQLite). Otherwise: the local file.
const db = process.env.TURSO_DATABASE_URL
  ? new PrismaClient({
      adapter: new (await import("@prisma/adapter-libsql")).PrismaLibSQL({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      }),
    })
  : new PrismaClient();

// Finished steps (OA-7). Steps 1, 2, 3 and 5 only repair rows saved by OLD versions of the app, and nothing writes such rows
// any more, so once a step has found nothing left to repair it is remembered here (AppSetting "data-upgrade:done", for
// example ["1","2","3","5"]) and later deploys skip it instead of reading whole tables again. Step 7 (housekeeping) always runs.
// Checked before relying on this:
//  - Step 2 (convertedAmount 0): every place that creates an expense sets convertedAmount (save-expense, splitwise-import,
//    moving-db, pot-db), and nothing reads a 0 as meaningful (fxLine shows no line for it, rebase starts from originalAmount).
//  - Step 5 (noon Indian time, 06:30 UTC): no live code writes that time any more. The one way it can come back is undoing a
//    very old edit whose saved copy still holds 06:30 UTC (src/lib/undo.ts restores the saved day as it was).
//    The day is still the right day in India and UTC; it only shifts for time zones more than 6.5 hours behind UTC.
const DONE_KEY = "data-upgrade:done";
const ALL_STEPS = ["1", "2", "3", "5"];
let done = new Set();
try {
  const saved = await db.appSetting.findUnique({ where: { key: DONE_KEY } });
  const list = saved ? JSON.parse(saved.value) : [];
  if (Array.isArray(list)) done = new Set(list.map(String).filter((x) => ALL_STEPS.includes(x)));
} catch {
  // can't read the list (a very old database): do every step, as before
}
const finished = new Set(done);
let moved = 0;
let old = [];
let noCreator = [];
let noRecorder = [];
let redated = 0;

// 1. Old categories → new categories.
const LEGACY = { drinks: "food", travel: "transport", stay: "accommodation", fun: "activities", health: "other" };
if (!done.has("1")) {
  for (const [from, to] of Object.entries(LEGACY)) {
    const r = await db.expense.updateMany({ where: { category: from }, data: { category: to } });
    moved += r.count;
  }
  if ((await db.expense.count({ where: { category: { in: Object.keys(LEGACY) } } })) === 0) finished.add("1");
}

// 2. Expenses saved before multi-currency: they were in the group's currency,
//    with no conversion and no card markup. Record exactly that.
if (!done.has("2")) {
  old = await db.expense.findMany({
    where: { convertedAmount: 0 },
    include: { group: { select: { currency: true } } },
  });
  for (const e of old) {
    await db.expense.update({
      where: { id: e.id },
      data: {
        originalAmount: e.amount,
        originalCurrency: e.group.currency,
        baseCurrency: e.group.currency,
        exchangeRate: "1",
        rateDate: e.createdAt.toISOString().slice(0, 10),
        rateSource: "same",
        convertedAmount: e.amount,
        paymentMethod: "",
        markupBp: 0,
        markupAmount: 0,
      },
    });
  }
  // A real expense can't have 0 converted (a 0 total is refused when saving), so none left means nothing is waiting.
  if ((await db.expense.count({ where: { convertedAmount: 0, amount: { gt: 0 } } })) === 0) finished.add("2");
}

// 3. Who added each expense / payment (older ones didn't record it): use the payer.
if (!done.has("3")) {
  noCreator = await db.expense.findMany({ where: { createdById: "" }, select: { id: true, paidById: true } });
  for (const e of noCreator) await db.expense.update({ where: { id: e.id }, data: { createdById: e.paidById } });
  noRecorder = await db.payment.findMany({ where: { createdById: "" }, select: { id: true, fromId: true } });
  for (const p of noRecorder) await db.payment.update({ where: { id: p.id }, data: { createdById: p.fromId } });
  if ((await db.expense.count({ where: { createdById: "" } })) === 0 && (await db.payment.count({ where: { createdById: "" } })) === 0) finished.add("3");
}

// 4. (Removed on purpose.) This step used to mark anyone who appeared as the "actor" of a group event as
//    "joined". But events are also written on someone else's behalf (a repeat bill, a reminder-link payment),
//    so a plain name like a flatmate got marked as joined on every deploy. Every way of joining now sets the
//    joined time itself, so nothing needs stamping here. Do not bring this back.

// 5. Expense days used to be stored as noon Indian time (06:30 UTC). Days are
//    now stored as noon UTC, which is the same calendar day everywhere.
if (!done.has("5")) {
  const dated = await db.expense.findMany({ where: { spentAt: { not: null } }, select: { id: true, spentAt: true } });
  for (const e of dated) {
    const d = e.spentAt;
    if (d.getUTCHours() === 6 && d.getUTCMinutes() === 30 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
      await db.expense.update({
        where: { id: e.id },
        data: { spentAt: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12)) },
      });
      redated++;
    }
  }
  finished.add("5"); // every such day was moved above, so none is left
}

// 6. (Erasing groups deleted over 30 days ago is the daily job's work: eraseExpiredGroups in src/lib/purge.ts. It also removes
//    photos, receipts, games and claims, and queues the stored files for deletion, which a build-time step cannot do.)

// 7. Housekeeping.
const dayAgo = new Date(Date.now() - 86_400_000);
await db.loginCode.deleteMany({ where: { expiresAt: { lt: dayAgo } } });
await db.rateLimit.deleteMany({ where: { resetAt: { lt: dayAgo } } });
await db.outbox.deleteMany({ where: { createdAt: { lt: dayAgo } } });
await db.requestKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
await db.errorLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });

// Remember the steps that have nothing left to do (only when the list changed).
if (finished.size !== done.size) {
  const value = JSON.stringify(ALL_STEPS.filter((x) => finished.has(x)));
  await db.appSetting.upsert({ where: { key: DONE_KEY }, create: { key: DONE_KEY, value }, update: { value } });
}
if (done.size) console.log(`upgrade-data: steps ${ALL_STEPS.filter((x) => done.has(x)).join(",")} already done, skipped.`);
if (redated) console.log(`Data upgrade: ${redated} expense days moved to noon UTC.`);
if (moved || old.length || noCreator.length || noRecorder.length) {
  console.log(
    `Data upgrade: ${moved} categories updated, ${old.length} expenses given currency details, ` +
      `${noCreator.length + noRecorder.length} items given an owner.`,
  );
}
await db.$disconnect();
