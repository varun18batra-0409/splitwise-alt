// Checks a restored database is whole, not just the right number of rows (OPS-01).
// Used by scripts/restore.mjs (and so by the daily backup's restore drill). Read-only: it only runs SELECTs and PRAGMAs.
//
//   1. PRAGMA integrity_check says "ok".
//   2. PRAGMA foreign_key_check finds nothing (the restore loads with foreign keys off, so this is the real test).
//   3. Loopin's own rules, worked out from the rows:
//      - every expense's shares add up to its amount;
//      - an expense with several payers: the payers add up to its amount;
//      - no share, payment or payer points to a member (or expense) that isn't there;
//      - in every group, balances (paid minus shares, plus payments) add up to exactly 0.
// Returns { problems: string[], notes: string[] }. Any problem means the restore must not be trusted.

const q = (n) => `"${String(n).replace(/"/g, '""')}"`;
const num = (v) => Number(v ?? 0);

export async function checkRestored(client) {
  const problems = [];
  const notes = [];
  const run = async (what, sql) => {
    try {
      return (await client.execute(sql)).rows;
    } catch (e) {
      problems.push(`${what}: could not be checked (${String(e?.message ?? e).split("\n")[0].slice(0, 120)})`);
      return null;
    }
  };
  const has = new Set((await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map((r) => String(r.name)));

  // 1. The database file itself.
  const ic = await run("Database integrity", "PRAGMA integrity_check");
  if (ic) {
    const bad = ic.map((r) => String(Object.values(r)[0])).filter((v) => v !== "ok");
    if (bad.length) problems.push(`Database integrity: ${bad.slice(0, 3).join("; ")}`);
    else notes.push("database integrity ok");
  }

  // 2. Every child row has its parent.
  const fk = await run("Foreign keys", "PRAGMA foreign_key_check");
  if (fk) {
    if (fk.length) {
      const by = {};
      for (const r of fk) by[String(r.table)] = (by[String(r.table)] ?? 0) + 1;
      problems.push(`Foreign keys: ${fk.length} row(s) point to something that is missing (${Object.entries(by).slice(0, 5).map(([t, n]) => `${t}: ${n}`).join(", ")})`);
    } else notes.push("no orphaned rows (foreign_key_check)");
  }

  // 3. Loopin's rules. A table that isn't in the backup (a tiny test file) is simply not checked.
  const need = ["Group", "Member", "Expense", "ExpenseShare", "Payment"];
  const missing = need.filter((t) => !has.has(t));
  if (missing.length) {
    notes.push(`Loopin rules not checked (no ${missing.join(", ")} table)`);
    return { problems, notes };
  }

  const members = await run("Members", `SELECT id, groupId FROM ${q("Member")}`);
  const expenses = await run("Expenses", `SELECT id, groupId, amount, paidById, payers, deletedAt FROM ${q("Expense")}`);
  const shares = await run("Shares", `SELECT expenseId, memberId, amount FROM ${q("ExpenseShare")}`);
  const payments = await run("Payments", `SELECT id, groupId, fromId, toId, amount, deletedAt FROM ${q("Payment")}`);
  const groups = await run("Groups", `SELECT id FROM ${q("Group")}`);
  if (!members || !expenses || !shares || !payments || !groups) return { problems, notes };

  const memberIds = new Set(members.map((m) => String(m.id)));
  const groupIds = new Set(groups.map((g) => String(g.id)));
  const expById = new Map(expenses.map((e) => [String(e.id), e]));
  const sharesBy = new Map();
  let orphanShares = 0;
  let shareNoMember = 0;
  for (const s of shares) {
    const eid = String(s.expenseId);
    if (!expById.has(eid)) orphanShares++;
    if (!memberIds.has(String(s.memberId))) shareNoMember++;
    sharesBy.set(eid, (sharesBy.get(eid) ?? 0) + num(s.amount));
  }
  if (orphanShares) problems.push(`Shares: ${orphanShares} share(s) belong to an expense that is not there`);
  if (shareNoMember) problems.push(`Shares: ${shareNoMember} share(s) point to a member that is not there`);

  const balance = new Map(); // groupId -> { memberId -> minor units }
  const bump = (g, m, v) => {
    if (!balance.has(g)) balance.set(g, new Map());
    balance.get(g).set(m, (balance.get(g).get(m) ?? 0) + v);
  };
  const badSum = [];
  const badPayers = [];
  let payerNoMember = 0;
  let expNoGroup = 0;
  for (const e of expenses) {
    const id = String(e.id);
    const g = String(e.groupId);
    const amount = num(e.amount);
    if (!groupIds.has(g)) expNoGroup++;
    const got = sharesBy.get(id) ?? 0;
    if (got !== amount) badSum.push(`${id} (amount ${amount}, shares ${got})`);
    // Who paid: one payer, or the list saved with the expense.
    let paid = [[String(e.paidById), amount]];
    if (e.payers) {
      try {
        const list = JSON.parse(String(e.payers));
        paid = list.map((p) => [String(p.m), num(p.a)]);
        if (paid.reduce((a, [, v]) => a + v, 0) !== amount) badPayers.push(id);
      } catch {
        badPayers.push(id);
      }
    }
    for (const [m] of paid) if (!memberIds.has(m)) payerNoMember++;
    if (e.deletedAt) continue; // deleted expenses stay in history but don't count towards balances
    for (const [m, v] of paid) bump(g, m, v);
  }
  if (expNoGroup) problems.push(`Expenses: ${expNoGroup} expense(s) belong to a group that is not there`);
  if (badSum.length) problems.push(`Expenses: ${badSum.length} expense(s) whose shares do not add up to the amount, e.g. ${badSum.slice(0, 3).join(", ")}`);
  if (badPayers.length) problems.push(`Expenses: ${badPayers.length} expense(s) whose payers do not add up to the amount (or cannot be read), e.g. ${badPayers.slice(0, 3).join(", ")}`);
  if (payerNoMember) problems.push(`Expenses: ${payerNoMember} payer(s) point to a member that is not there`);
  for (const s of shares) {
    const e = expById.get(String(s.expenseId));
    if (e && !e.deletedAt) bump(String(e.groupId), String(s.memberId), -num(s.amount));
  }

  let payNoMember = 0;
  let payNoGroup = 0;
  for (const p of payments) {
    if (!memberIds.has(String(p.fromId)) || !memberIds.has(String(p.toId))) payNoMember++;
    if (!groupIds.has(String(p.groupId))) payNoGroup++;
    if (p.deletedAt) continue;
    bump(String(p.groupId), String(p.fromId), num(p.amount));
    bump(String(p.groupId), String(p.toId), -num(p.amount));
  }
  if (payNoMember) problems.push(`Payments: ${payNoMember} payment(s) point to a member that is not there`);
  if (payNoGroup) problems.push(`Payments: ${payNoGroup} payment(s) belong to a group that is not there`);

  const off = [];
  for (const [g, ms] of balance) {
    const total = [...ms.values()].reduce((a, v) => a + v, 0);
    if (total !== 0) off.push(`${g} (off by ${total})`);
  }
  if (off.length) problems.push(`Balances: ${off.length} group(s) whose balances do not add up to 0, e.g. ${off.slice(0, 3).join(", ")}`);

  if (!problems.length) notes.push(`${expenses.length} expenses, ${payments.length} payments and ${balance.size} group balance sheets add up exactly`);
  return { problems, notes };
}
