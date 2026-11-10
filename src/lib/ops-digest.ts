import { db } from "./db";
import { sendMail } from "./mail";

// A short email to the admin when something needs a look: daily-job parts that
// failed, errors people hit, emails that didn't go out, and data that has lost
// its partner row (e.g. a passkey whose account is gone). Nothing personal is
// included: counts, page paths and error messages only. Quiet days send nothing.

export async function orphanCounts() {
  const [accounts, passkeys, postcards, receipts, expenses] = await Promise.all([
    db.account.findMany({ select: { id: true }, take: 50_000 }),
    db.passkey.findMany({ select: { accountId: true }, take: 50_000 }),
    db.postcard.findMany({ select: { fromId: true, toId: true }, take: 50_000 }),
    db.receipt.findMany({ where: { expenseId: { not: "" } }, select: { expenseId: true }, take: 50_000 }),
    db.expense.findMany({ select: { id: true }, take: 200_000 }),
  ]);
  const acc = new Set(accounts.map((a) => a.id));
  const exp = new Set(expenses.map((e) => e.id));
  return {
    passkeysWithoutAccount: passkeys.filter((p) => !acc.has(p.accountId)).length,
    postcardsWithoutSender: postcards.filter((p) => p.fromId && !acc.has(p.fromId)).length,
    billPhotosWithoutExpense: receipts.filter((r) => !exp.has(r.expenseId)).length,
  };
}

export async function sendOpsDigest(now: Date, failedParts: string[]) {
  const to = (process.env.ADMIN_EMAIL ?? "").split(",")[0]?.trim();
  if (!to) return { sent: false, reason: "no ADMIN_EMAIL" };
  const since = new Date(now.getTime() - 86_400_000);
  const [errors, mailFailed, orphans] = await Promise.all([
    db.errorLog.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 200, select: { path: true, message: true } }),
    db.notifyLog.count({ where: { key: { startsWith: "mail-failed:" }, createdAt: { gte: since } } }),
    orphanCounts().catch(() => null),
  ]);
  const orphanTotal = orphans ? Object.values(orphans).reduce((a, b) => a + b, 0) : 0;
  if (!failedParts.length && !errors.length && !mailFailed && !orphanTotal) return { sent: false, reason: "all quiet" };
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
  ].filter(Boolean);
  const text = `Loopin check for ${now.toISOString().slice(0, 10)}\n\n${lines.join("\n")}\n\nNothing personal is included. Details: /stats`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px"><p style="font-size:16px;font-weight:600">Loopin check</p><pre style="white-space:pre-wrap;font-size:13px">${lines.join("\n").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre></div>`;
  return { sent: await sendMail(to, `Loopin: ${failedParts.length + (errors.length ? 1 : 0) + (mailFailed ? 1 : 0) + (orphanTotal ? 1 : 0)} thing(s) to look at`, text, html), reason: "issues" };
}
