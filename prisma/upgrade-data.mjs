// Brings data saved by older versions of the app up to date.
// Safe to run any number of times: it only touches rows that still need it,
// and it never deletes anything. Runs automatically before `npm run dev`.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

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

if (moved || old.length) {
  console.log(`Data upgrade: ${moved} categories updated, ${old.length} older expenses given currency details.`);
}
await db.$disconnect();
