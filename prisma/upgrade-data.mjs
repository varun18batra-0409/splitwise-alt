// Brings data saved by older versions of the app up to date.
// Safe to run any number of times: it only touches rows that still need it.
// The only things it deletes: groups deleted more than 30 days ago (they can
// be restored until then) and expired housekeeping rows (old sign-in codes,
// rate-limit counters, old error logs). Runs before `npm run dev` and on deploy.
import { PrismaClient } from "@prisma/client";

// Hosted app: Turso (online SQLite). Otherwise: the local file.
const db = process.env.TURSO_DATABASE_URL
  ? new PrismaClient({
      adapter: new (await import("@prisma/adapter-libsql")).PrismaLibSQL({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      }),
    })
  : new PrismaClient();

// 1. Old categories → new categories.
const LEGACY = { drinks: "food", travel: "transport", stay: "accommodation", fun: "activities", health: "other" };
let moved = 0;
for (const [from, to] of Object.entries(LEGACY)) {
  const r = await db.expense.updateMany({ where: { category: from }, data: { category: to } });
  moved += r.count;
}

// 2. Expenses saved before multi-currency: they were in the group's currency,
//    with no conversion and no card markup. Record exactly that.
const old = await db.expense.findMany({
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

// 3. Who added each expense / payment (older ones didn't record it): use the payer.
const noCreator = await db.expense.findMany({ where: { createdById: "" }, select: { id: true, paidById: true } });
for (const e of noCreator) await db.expense.update({ where: { id: e.id }, data: { createdById: e.paidById } });
const noRecorder = await db.payment.findMany({ where: { createdById: "" }, select: { id: true, fromId: true } });
for (const p of noRecorder) await db.payment.update({ where: { id: p.id }, data: { createdById: p.fromId } });

// 4. "Joined" status (new): anyone who has ever done something in their group
//    clearly picked their name on a phone.
const actors = await db.groupEvent.findMany({ select: { actorId: true }, distinct: ["actorId"] });
const joined = await db.member.updateMany({
  where: { claimedAt: null, id: { in: actors.map((a) => a.actorId) } },
  data: { claimedAt: new Date() },
});

// 5. Expense days used to be stored as noon Indian time (06:30 UTC). Days are
//    now stored as noon UTC, which is the same calendar day everywhere.
const dated = await db.expense.findMany({ where: { spentAt: { not: null } }, select: { id: true, spentAt: true } });
let redated = 0;
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

// 6. Groups deleted more than 30 days ago are erased for good.
const cutoff = new Date(Date.now() - 30 * 86_400_000);
const gone = await db.group.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true } });
for (const g of gone) {
  const members = await db.member.findMany({ where: { groupId: g.id }, select: { id: true } });
  const expenses = await db.expense.findMany({ where: { groupId: g.id }, select: { id: true } });
  await db.$transaction([
    db.expenseShare.deleteMany({ where: { expenseId: { in: expenses.map((e) => e.id) } } }),
    db.expense.deleteMany({ where: { groupId: g.id } }),
    db.payment.deleteMany({ where: { groupId: g.id } }),
    db.groupEvent.deleteMany({ where: { groupId: g.id } }),
    db.pushSubscription.deleteMany({ where: { memberId: { in: members.map((m) => m.id) } } }),
    db.member.deleteMany({ where: { groupId: g.id } }),
    db.group.delete({ where: { id: g.id } }),
  ]);
}

// 7. Housekeeping.
const dayAgo = new Date(Date.now() - 86_400_000);
await db.loginCode.deleteMany({ where: { expiresAt: { lt: dayAgo } } });
await db.rateLimit.deleteMany({ where: { resetAt: { lt: dayAgo } } });
await db.outbox.deleteMany({ where: { createdAt: { lt: dayAgo } } });
await db.errorLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });

if (redated || gone.length) console.log(`Data upgrade: ${redated} expense days moved to noon UTC, ${gone.length} deleted groups erased.`);
if (joined.count || moved || old.length || noCreator.length || noRecorder.length) {
  console.log(
    `Data upgrade: ${moved} categories updated, ${old.length} expenses given currency details, ` +
      `${noCreator.length + noRecorder.length} items given an owner.`,
  );
}
await db.$disconnect();
