import { db } from "./db";
import { sendMail } from "./mail";

// A short email to the admin when something needs a look: daily-job parts that
// failed, errors people hit, emails that didn't go out, and data that has lost
// its partner row (e.g. a passkey whose account is gone). Nothing personal is
// included: counts, page paths and error messages only. Quiet days send nothing.

// Counted inside the database (no row limits, so exact at any size). Links the
// database itself enforces can't break; these are the "none = empty text" columns.
export async function orphanCounts() {
  const count = async (sql: string) => Number(((await db.$queryRawUnsafe(sql)) as { n: number | bigint }[])[0]?.n ?? 0);
  const [billPhotosWithoutExpense, listItemsWithoutExpense, billRunsWithoutExpense, collectionEntriesWithoutAccount] = await Promise.all([
    count(`SELECT COUNT(*) AS n FROM "Receipt" r WHERE r."expenseId" <> '' AND NOT EXISTS (SELECT 1 FROM "Expense" e WHERE e."id" = r."expenseId")`),
    count(`SELECT COUNT(*) AS n FROM "ListItem" l WHERE l."expenseId" <> '' AND NOT EXISTS (SELECT 1 FROM "Expense" e WHERE e."id" = l."expenseId")`),
    count(`SELECT COUNT(*) AS n FROM "BillRun" b WHERE b."expenseId" <> '' AND NOT EXISTS (SELECT 1 FROM "Expense" e WHERE e."id" = b."expenseId")`),
    count(`SELECT COUNT(*) AS n FROM "CollectionEntry" c WHERE c."accountId" <> '' AND NOT EXISTS (SELECT 1 FROM "Account" a WHERE a."id" = c."accountId")`),
  ]);
  return { billPhotosWithoutExpense, listItemsWithoutExpense, billRunsWithoutExpense, collectionEntriesWithoutAccount };
}

export async function sendOpsDigest(now: Date, failedParts: string[]) {
  const to = (process.env.ADMIN_EMAIL ?? "").split(",")[0]?.trim();
  if (!to) return { sent: false, reason: "no ADMIN_EMAIL" };
  const since = new Date(now.getTime() - 86_400_000);
  const [errors, mailFailed, orphans, stuckPhotos] = await Promise.all([
    db.errorLog.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 200, select: { path: true, message: true } }),
    db.notifyLog.count({ where: { key: { startsWith: "mail-failed:" }, createdAt: { gte: since } } }),
    orphanCounts().catch(() => null),
    // Photo files that still couldn't be deleted after several tries.
    import("./photo-store").then((m) => m.stuckPhotoDeletes()).catch(() => null),
  ]);
  const stuckCheckFailed = stuckPhotos === null;
  const stuck = stuckPhotos ?? 0;
  const orphanTotal = orphans ? Object.values(orphans).reduce((a, b) => a + b, 0) : 0;
  // A check that couldn't run is a problem in itself, never "all quiet".
  const checkFailed = orphans === null;
  if (!failedParts.length && !errors.length && !mailFailed && !orphanTotal && !checkFailed && !stuckCheckFailed && !stuck) return { sent: false, reason: "all quiet" };
  const top = new Map<string, number>();
  for (const e of errors) {
    const k = `${e.path || "(no page)"} — ${e.message.slice(0, 120)}`;
    top.set(k, (top.get(k) ?? 0) + 1);
  }
  const lines = [
    failedParts.length ? `Daily job parts that failed: ${failedParts.join(", ")}` : "",
    errors.length ? `Errors people hit in the last 24 hours: ${errors.length}` : "",
    ...[...top].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `  ${n}× ${k}`),
    mailFailed ? `Emails that couldn't be sent (or hit the daily cap): ${mailFailed}` : "",
    orphanTotal && orphans ? `Rows that lost their partner: ${Object.entries(orphans).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ")}` : "",
    stuck ? `Photo files that could not be deleted yet (tried 3 times or more): ${stuck}` : "",
    stuckCheckFailed ? "The check for photo files that could not be deleted couldn't run today." : "",
    checkFailed ? "The check for rows that lost their partner couldn't run today." : "",
  ].filter(Boolean);
  const text = `Loopin check for ${now.toISOString().slice(0, 10)}\n\n${lines.join("\n")}\n\nNothing personal is included. Details: /stats`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px"><p style="font-size:16px;font-weight:600">Loopin check</p><pre style="white-space:pre-wrap;font-size:13px">${lines.join("\n").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre></div>`;
  return { sent: await sendMail(to, `Loopin: ${failedParts.length + (errors.length ? 1 : 0) + (mailFailed ? 1 : 0) + (orphanTotal ? 1 : 0) + (checkFailed ? 1 : 0) + (stuck ? 1 : 0) + (stuckCheckFailed ? 1 : 0)} thing(s) to look at`, text, html), reason: "issues" };
}
