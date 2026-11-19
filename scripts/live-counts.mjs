// Read-only counts on the live database, for five clean-up items. It only counts: nothing is fixed here.
// Run with tsx (it reads the app's own money working from src/lib):  npx tsx scripts/live-counts.mjs
// Needs TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (a READ-ONLY token). Prints counts and size bands only:
// no names, emails, amounts or ids ever leave this file (see safeLine).
//
// Safety, in order:
//   1. refuses if the address is missing, or it runs in GitHub on any branch that is not a live-counts one;
//   2. refuses if the token says it can write (when the token carries that claim);
//   3. guardReadOnly: a harmless write test that is always rolled back; the token must be refused.
//      Anything it does not recognise also means "refuse".
import { createClient } from "@libsql/client";
import { readFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { netBalances } from "../src/lib/balances.ts";
import { parsePayers } from "../src/lib/payers.ts";

// What the git history showed (see the notes in the report): the old history lines that carried an invited person's email were
// written until the Batch B release of 11 Nov 2026 (commit time 21:06 UTC); step 4 of the data upgrade stamped "joined" with one
// fresh time per run, on every deploy, from 15 Oct 2026 until it was removed on 16 Nov 2026.
export const DEFAULT_CUTOFF = "2026-11-11T21:06:07Z";

// ---- Copies of small pure rules from the app. Importing the files they live in would load the database module, so they are copied
// here and tests/live-counts.test.ts checks every one of them against the app's own version.
export const SELF_ACTION_KINDS = ["expense_added", "payment_recorded", "payment_confirmed", "group_settled_closed", "pot_started", "pot_finished", "pot_reopened"];
export const REPEAT_BILL_MARK = "· repeat bill";
export const PAY_LINK_MARK = "(from the reminder link)";
const isPending = (m) => (m.addedBy ?? "") !== "" && (m.seenAt ?? null) === null;
// `members` in the order they were added (createdAt, then id).
export function pickAdmin(members) {
  const here = members.filter((m) => !isPending(m));
  return here.find((m) => m.claimedAt && !m.leftAt) ?? here.find((m) => !m.leftAt);
}
const memberOfToken = (token) => (token.includes(".") ? token.split(".")[0] : "");
export const inviteMemberId = (inv) => inv.memberId || memberOfToken(inv.token);

// ---- Output filter: nothing but counts and plain words may be printed.
const ALLOWED = /^[A-Za-z0-9 .,:;|()<>≤≥·–—'’/+=%-]*$/;
export function safeLine(s) {
  const t = String(s);
  if (t.includes("@") || /[A-Za-z0-9]{20,}/.test(t) || !ALLOWED.test(t)) return "(line withheld)";
  return t;
}
const esc = (t) => t.replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");

export class Refusal extends Error {}

// ---- Dates may be stored as millisecond numbers or as ISO text (see live-stats.mjs): read both.
export function toMs(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  const s = String(v);
  if (/^-?\d+$/.test(s)) return Number(s);
  const t = Date.parse(s.includes("T") || s.includes(" ") ? s.replace(" ", "T") : s);
  return Number.isNaN(t) ? null : t;
}

const chunks = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};
const q = async (client, sql, args = []) => (await client.execute({ sql, args })).rows;
const one = async (client, sql, args = []) => Number(Object.values((await q(client, sql, args))[0] ?? { n: 0 })[0] ?? 0);
const marks = (n) => Array(n).fill("?").join(",");
const byTime = (a, b) => (toMs(a.createdAt) ?? 0) - (toMs(b.createdAt) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ---- The read-only guard.
const REFUSED_WRITE = /read.?only|readonly|not allowed|forbidden|unauthori[sz]ed|permission|attempt to write/i;

// The access claim in a Turso token ("a": "ro" or "rw"), if the token has one. The token is never printed.
export function tokenAccess(token) {
  try {
    const part = String(token ?? "").split(".")[1];
    if (!part) return undefined;
    const claims = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof claims?.a === "string" ? claims.a : undefined;
  } catch {
    return undefined;
  }
}

export async function guardReadOnly(client, token) {
  const access = tokenAccess(token);
  if (access !== undefined && access !== "ro") throw new Refusal("REFUSING: this token is not read-only. Nothing was changed.");
  let tx;
  let canWrite = false;
  try {
    tx = await client.transaction("write");
    await tx.execute("UPDATE AppSetting SET value = value WHERE 0"); // changes no row even if allowed
    canWrite = true;
  } catch (e) {
    if (!REFUSED_WRITE.test(String(e?.message ?? ""))) throw new Refusal("REFUSING: could not prove the token is read-only. Nothing was changed.");
  } finally {
    try {
      await tx?.rollback();
    } catch {
      /* already closed */
    }
    try {
      tx?.close();
    } catch {
      /* already closed */
    }
  }
  if (canWrite) throw new Refusal("REFUSING: this token can write. Nothing was changed.");
}

// ---- The schema file tells which columns point at which tables (so the list of links is never typed by hand).
export function readSchema(text) {
  const models = new Map();
  let cur = null;
  const scalars = new Set(["String", "Int", "Boolean", "DateTime", "Bytes", "Float", "BigInt", "Decimal", "Json"]);
  for (const line of text.split("\n")) {
    const m = /^model (\w+) \{/.exec(line);
    if (m) {
      cur = { cols: new Set(), links: [] };
      models.set(m[1], cur);
      continue;
    }
    if (cur && /^\}/.test(line)) {
      cur = null;
      continue;
    }
    if (!cur) continue;
    const f = /^\s+(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
    if (!f) continue;
    if (scalars.has(f[2]) && !f[3]) cur.cols.add(f[1]);
    const r = /@relation\([^)]*fields:\s*\[(\w+)\][^)]*references:\s*\[(\w+)\]/.exec(f[5]);
    if (r) cur.links.push({ col: r[1], target: f[2], ref: r[2] });
  }
  return models;
}

// ================= Item 1: history lines showing an invited person's email =================
export async function countEmailsInHistory(client, cutoffMs) {
  const cand = await q(client, "SELECT id, groupId, kind, createdAt, text, details, undo FROM GroupEvent WHERE text LIKE '%@%' OR details LIKE '%@%'");
  const groupIds = [...new Set(cand.map((r) => r.groupId))];
  const invites = new Map(); // groupId -> [{email, memberId, token, createdAt}]
  const memberRows = new Map(); // groupId -> Set of member ids
  const renamed = new Map(); // groupId -> [{memberId, at}]
  for (const part of chunks(groupIds, 200)) {
    for (const i of await q(client, `SELECT groupId, lower(email) AS email, memberId, token, createdAt FROM Invite WHERE groupId IN (${marks(part.length)})`, part)) {
      if (!invites.has(i.groupId)) invites.set(i.groupId, []);
      invites.get(i.groupId).push({ email: String(i.email), memberId: String(i.memberId ?? ""), token: String(i.token ?? ""), createdAt: toMs(i.createdAt) });
    }
    for (const m of await q(client, `SELECT id, groupId FROM Member WHERE groupId IN (${marks(part.length)})`, part)) {
      if (!memberRows.has(m.groupId)) memberRows.set(m.groupId, new Set());
      memberRows.get(m.groupId).add(m.id);
    }
    for (const e of await q(client, `SELECT groupId, createdAt, undo FROM GroupEvent WHERE kind = 'member_renamed' AND groupId IN (${marks(part.length)})`, part)) {
      let id = "";
      try {
        id = String(JSON.parse(String(e.undo))?.memberId ?? "");
      } catch {
        /* not a rename with an undo record */
      }
      if (!id) continue;
      if (!renamed.has(e.groupId)) renamed.set(e.groupId, []);
      renamed.get(e.groupId).push({ memberId: id, at: toMs(e.createdAt) });
    }
  }
  const c = { lines: 0, before: 0, after: 0, invited: 0, added: 0, other: 0, exact: 0, certain: 0, resent: 0, noRow: 0, gone: 0, several: 0, renamed: 0, emailLike: 0, details: 0 };
  for (const e of cand) {
    const text = String(e.text ?? "");
    const details = String(e.details ?? "");
    const low = `${text}\n${details}`.toLowerCase();
    const hits = (invites.get(e.groupId) ?? []).filter((i) => i.email.includes("@") && low.includes(i.email));
    const emails = [...new Set(hits.map((h) => h.email))];
    if (!emails.length) {
      if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(`${text} ${details}`)) c.emailLike++;
      continue;
    }
    c.lines++;
    const at = toMs(e.createdAt);
    if (at !== null && at < cutoffMs) c.before++;
    else c.after++;
    if (e.kind === "member_invited") c.invited++;
    else if (e.kind === "members_added") c.added++;
    else c.other++;
    if (details.toLowerCase().includes(emails[0]) || emails.some((m) => details.toLowerCase().includes(m))) c.details++;
    const rows = memberRows.get(e.groupId) ?? new Set();
    // Which name row the line is about, when it can be known.
    let who = "";
    let undoIds = [];
    try {
      const u = JSON.parse(String(e.undo));
      if (Array.isArray(u?.memberIds)) undoIds = u.memberIds;
    } catch {
      /* no undo record */
    }
    if (e.kind === "members_added" && undoIds.length === 1 && rows.has(undoIds[0])) {
      c.exact++;
      who = undoIds[0];
    } else if (emails.length > 1) c.several++;
    else {
      const inv = hits[0];
      const mid = inviteMemberId(inv);
      if (inv.createdAt !== null && at !== null && inv.createdAt > at + 5000) c.resent++;
      else if (!mid) c.noRow++;
      else if (!rows.has(mid)) c.gone++;
      else {
        c.certain++;
        who = mid;
      }
    }
    if (who && (renamed.get(e.groupId) ?? []).some((r) => r.memberId === who && at !== null && r.at !== null && r.at > at)) c.renamed++;
  }
  const emailNames = await one(client, "SELECT COUNT(*) FROM Member WHERE name LIKE '%_@_%._%'");
  return `lines with an invite's email: ${c.lines} (before cutoff ${c.before}, after ${c.after}) | by kind: member_invited ${c.invited}, members_added ${c.added}, other ${c.other} | exact ${c.exact}, certain ${c.certain}, unsure-resent ${c.resent}, unsure-no-row ${c.noRow}, row gone ${c.gone}, several emails ${c.several} | renamed since ${c.renamed} | email-like but no invite ${c.emailLike} | details field ${c.details} | name rows that are an email ${emailNames}`;
}

// ================= Item 2 (OA-1): names wrongly stamped as "joined" =================
export async function countWrongJoined(client) {
  const sus = await q(client, "SELECT id, groupId, createdAt, claimedAt, grantEpoch, seenAt, seenEventsAt FROM Member WHERE claimedAt IS NOT NULL AND (accountId IS NULL OR accountId = '')");
  const ids = sus.map((s) => String(s.id));
  const subs = new Map();
  const reacts = new Map();
  const first = new Map();
  const selfActs = new Map();
  const key = (g, m) => `${g}|${m}`;
  for (const part of chunks(ids, 200)) {
    const ph = marks(part.length);
    for (const r of await q(client, `SELECT memberId, COUNT(*) AS n FROM PushSubscription WHERE memberId IN (${ph}) GROUP BY memberId`, part)) subs.set(r.memberId, Number(r.n));
    for (const t of ["Reaction", "MomentReaction"])
      for (const r of await q(client, `SELECT memberId, COUNT(*) AS n FROM ${t} WHERE memberId IN (${ph}) GROUP BY memberId`, part)) reacts.set(r.memberId, (reacts.get(r.memberId) ?? 0) + Number(r.n));
    for (const r of await q(client, `SELECT groupId, actorId, createdAt, kind, text FROM GroupEvent WHERE actorId IN (${ph})`, part)) {
      const k = key(r.groupId, r.actorId);
      const t = toMs(r.createdAt);
      if (t !== null && (!first.has(k) || t < first.get(k))) first.set(k, t);
      const text = String(r.text ?? "");
      if (SELF_ACTION_KINDS.includes(String(r.kind)) && !text.includes(REPEAT_BILL_MARK) && !text.includes(PAY_LINK_MARK)) selfActs.set(k, (selfActs.get(k) ?? 0) + 1);
    }
  }
  const rows = sus.map((s) => ({
    id: String(s.id),
    groupId: String(s.groupId),
    claimed: toMs(s.claimedAt),
    created: toMs(s.createdAt),
    epoch: Number(s.grantEpoch ?? 0),
    seen: s.seenAt !== null && s.seenAt !== undefined,
    opened: s.seenEventsAt !== null && s.seenEventsAt !== undefined,
    subs: subs.get(s.id) ?? 0,
    reacts: reacts.get(s.id) ?? 0,
    first: first.get(key(s.groupId, s.id)) ?? null,
    selfActs: selfActs.get(key(s.groupId, s.id)) ?? 0,
  }));
  // Same stamp: the exact value shared by 2 or more rows.
  const stampCount = new Map();
  for (const r of rows) if (r.claimed !== null) stampCount.set(r.claimed, (stampCount.get(r.claimed) ?? 0) + 1);
  const sameStamp = new Set(rows.filter((r) => r.claimed !== null && stampCount.get(r.claimed) >= 2).map((r) => r.id));
  const shared = [...stampCount.values()].filter((n) => n >= 2);
  const largest = Math.max(0, ...shared);
  const sameGroups = shared.length;
  // Burst: 3 or more stamps within 120 seconds, across at least 2 groups.
  const burst = new Set();
  const sorted = rows.filter((r) => r.claimed !== null).sort((a, b) => a.claimed - b.claimed);
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j].claimed - sorted[i].claimed <= 120_000) j++;
    const win = sorted.slice(i, j);
    if (win.length >= 3 && new Set(win.map((w) => w.groupId)).size >= 2) {
      for (const w of win) burst.add(w.id);
      i = j;
    } else i++;
  }
  const real = { epoch: 0, subs: 0, selfActs: 0, opened: 0, atCreate: 0, reacts: 0 };
  const wrong = new Set();
  let realN = 0;
  let unsure = 0;
  for (const r of rows) {
    const signs = {
      epoch: r.epoch > 0,
      subs: r.subs > 0,
      reacts: r.reacts > 0,
      selfActs: r.selfActs > 0,
      opened: r.opened,
      atCreate: r.claimed !== null && r.created !== null && Math.abs(r.claimed - r.created) <= 5000,
    };
    for (const k of Object.keys(signs)) if (signs[k]) real[k]++;
    if (Object.values(signs).some(Boolean)) {
      realN++;
      continue;
    }
    const late = r.claimed !== null && r.first !== null && r.claimed > r.first;
    if (!r.seen && (sameStamp.has(r.id) || burst.has(r.id) || late)) wrong.add(r.id);
    else unsure++;
  }
  // Payments to wrong-stamped names still waiting for a "Got it".
  let waiting = 0;
  for (const part of chunks([...wrong], 200)) waiting += await one(client, `SELECT COUNT(*) FROM Payment WHERE needsOk = 1 AND okAt IS NULL AND deletedAt IS NULL AND toId IN (${marks(part.length)})`, part);
  // Groups whose admin would change if the wrong stamps were cleared.
  const wrongGroups = [...new Set(rows.filter((r) => wrong.has(r.id)).map((r) => r.groupId))];
  let adminChanges = 0;
  for (const part of chunks(wrongGroups, 100)) {
    const all = await q(client, `SELECT id, groupId, createdAt, claimedAt, leftAt, addedBy, seenAt FROM Member WHERE groupId IN (${marks(part.length)})`, part);
    const per = new Map();
    for (const m of all) {
      if (!per.has(m.groupId)) per.set(m.groupId, []);
      per.get(m.groupId).push(m);
    }
    for (const list of per.values()) {
      list.sort(byTime);
      const as = (m, clear) => ({ id: m.id, claimedAt: clear && wrong.has(m.id) ? null : m.claimedAt ?? null, leftAt: m.leftAt ?? null, addedBy: String(m.addedBy ?? ""), seenAt: m.seenAt ?? null });
      if (pickAdmin(list.map((m) => as(m, false)))?.id !== pickAdmin(list.map((m) => as(m, true)))?.id) adminChanges++;
    }
  }
  return `claimed but no account: ${rows.length} | certainly real ${realN} (deleted account ${real.epoch}, phone alerts ${real.subs}, own actions ${real.selfActs}, opened alerts ${real.opened}, claimed when created ${real.atCreate}, reactions ${real.reacts}) | certainly wrong ${wrong.size} (same-stamp groups ${sameGroups}, largest ${largest}, in a burst ${[...burst].filter((b) => wrong.has(b)).length}) | unsure ${unsure} | payments to wrong-stamped names still waiting for OK: ${waiting} | groups whose admin would change: ${adminChanges}`;
}

// ================= Item 3: people who left a group with a balance that isn't 0 =================
export async function countLeaversWithBalance(client) {
  const gids = (await q(client, "SELECT DISTINCT groupId FROM Member WHERE leftAt IS NOT NULL")).map((r) => String(r.groupId));
  const t = { groups: new Set(), people: 0, owe: 0, owed: 0, own: 0, removed: 0, rounding: 0, larger: 0, changed: 0, open: new Set(), closed: new Set(), deleted: new Set(), home: new Set(), trip: new Set(), other: new Set(), notZero: 0, strays: 0 };
  for (const part of chunks(gids, 100)) {
    const ph = marks(part.length);
    const groups = new Map((await q(client, `SELECT id, type, closed, deletedAt FROM "Group" WHERE id IN (${ph})`, part)).map((g) => [String(g.id), g]));
    const members = new Map();
    for (const m of await q(client, `SELECT id, groupId, createdAt, leftAt, removedAt FROM Member WHERE groupId IN (${ph})`, part)) {
      if (!members.has(m.groupId)) members.set(m.groupId, []);
      members.get(m.groupId).push(m);
    }
    const expenses = new Map();
    for (const e of await q(client, `SELECT id, groupId, paidById, amount, payers, kind, createdAt FROM Expense WHERE deletedAt IS NULL AND groupId IN (${ph})`, part)) {
      if (!expenses.has(e.groupId)) expenses.set(e.groupId, new Map());
      expenses.get(e.groupId).set(e.id, { id: String(e.id), paidById: String(e.paidById), amount: Number(e.amount), payers: e.payers === null ? "" : String(e.payers), kind: e.kind === null ? "expense" : String(e.kind), createdAt: toMs(e.createdAt), shares: [] });
    }
    for (const s of await q(client, `SELECT s.expenseId, s.memberId, s.amount, e.groupId FROM ExpenseShare s JOIN Expense e ON e.id = s.expenseId WHERE e.deletedAt IS NULL AND e.groupId IN (${ph})`, part))
      expenses.get(s.groupId)?.get(s.expenseId)?.shares.push({ memberId: String(s.memberId), amount: Number(s.amount) });
    const payments = new Map();
    for (const p of await q(client, `SELECT groupId, fromId, toId, amount, createdAt, deletedAt FROM Payment WHERE groupId IN (${ph})`, part)) {
      if (!payments.has(p.groupId)) payments.set(p.groupId, []);
      payments.get(p.groupId).push({ fromId: String(p.fromId), toId: String(p.toId), amount: Number(p.amount), createdAt: toMs(p.createdAt), deletedAt: toMs(p.deletedAt), live: p.deletedAt === null || p.deletedAt === undefined });
    }
    for (const gid of part) {
      const list = (members.get(gid) ?? []).slice().sort(byTime);
      const ids = list.map((m) => String(m.id));
      const exps = [...(expenses.get(gid)?.values() ?? [])];
      const pays = payments.get(gid) ?? [];
      const live = pays.filter((p) => p.live);
      const net = netBalances(ids, exps, live);
      if (Object.values(net).reduce((a, b) => a + b, 0) !== 0) t.notZero++;
      const known = new Set(ids);
      const touched = [...exps.flatMap((e) => [e.paidById, ...parsePayers(e.payers).map((p) => p.memberId), ...e.shares.map((s) => s.memberId)]), ...live.flatMap((p) => [p.fromId, p.toId])];
      if (touched.some((id) => id && !known.has(id))) t.strays++;
      for (const m of list) {
        if (m.leftAt === null || m.leftAt === undefined) continue;
        const bal = net[String(m.id)] ?? 0;
        if (bal === 0) continue;
        const g = groups.get(gid);
        t.groups.add(gid);
        t.people++;
        if (bal < 0) t.owe++;
        else t.owed++;
        if (m.removedAt !== null && m.removedAt !== undefined) t.removed++;
        else t.own++;
        if (Math.abs(bal) <= ids.length) t.rounding++;
        else t.larger++;
        const left = toMs(m.leftAt);
        const id = String(m.id);
        const after =
          exps.some((e) => e.createdAt !== null && left !== null && e.createdAt > left && (e.paidById === id || parsePayers(e.payers).some((p) => p.memberId === id) || e.shares.some((s) => s.memberId === id))) ||
          pays.some((p) => (p.fromId === id || p.toId === id) && left !== null && ((p.live && p.createdAt !== null && p.createdAt > left) || (!p.live && p.deletedAt !== null && p.deletedAt > left)));
        if (after) t.changed++;
        const kind = g?.deletedAt !== null && g?.deletedAt !== undefined ? t.deleted : Number(g?.closed) === 1 ? t.closed : t.open;
        kind.add(gid);
        (g?.type === "home" ? t.home : g?.type === "trip" ? t.trip : t.other).add(gid);
      }
    }
  }
  return `groups: ${t.groups.size} | people: ${t.people} (owe others ${t.owe}, are owed ${t.owed}) | left on own ${t.own}, removed ${t.removed} | groups open ${[...t.open].filter((g) => t.groups.has(g)).length}, closed ${t.closed.size}, deleted ${t.deleted.size} | by type: home ${t.home.size}, trip ${t.trip.size}, other ${t.other.size} | within rounding (1 or less per person in the group) ${t.rounding}, larger ${t.larger} | money changed after they left ${t.changed} | groups not adding to 0: ${t.notZero} (must be 0) | groups with money pointing at a non-member: ${t.strays}`;
}

// ================= Item 4: rows pointing at things that no longer exist =================
// Plain-id columns that carry money (must be 0): [table, column, target table, may be empty]
const MONEY_PLAIN = [
  ["PotGame", "groupId", "Group"],
  ["PotGame", "hostId", "Member"],
  ["PotGame", "resultId", "Expense"],
  ["PotMove", "memberId", "Member"],
  ["GoalEntry", "memberId", "Member"],
  ["DepositShare", "memberId", "Member"],
  ["DepositShare", "toMemberId", "Member"],
  ["Bill", "payer", "Member"],
  ["BillRun", "expenseId", "Expense"],
  ["PaymentClaim", "groupId", "Group"],
  ["PaymentClaim", "fromId", "Member"],
  ["PaymentClaim", "toId", "Member"],
  ["PaymentClaim", "paymentId", "Payment"],
];
// Lists of member ids inside a text column: [label, table, column, SQL that finds the ids, owner's group column]
const MONEY_JSON = [
  // The text is only handed to json_each when it is valid (SQLite does not promise to skip it otherwise).
  ["Expense.payers", "Expense", "payers", `json_each(CASE WHEN json_valid(c.payers) THEN c.payers ELSE '[]' END) j`, "json_extract(j.value,'$.m')", "c.groupId"],
  ["PotGame.players", "PotGame", "players", `json_each(CASE WHEN json_valid(c.players) THEN c.players ELSE '[]' END) j`, "j.value", "c.groupId"],
  ["Bill.rotation", "Bill", "rotation", `json_each(CASE WHEN json_valid(c.rotation) THEN c.rotation ELSE '[]' END) j`, "j.value", "c.groupId"],
  ["Bill.split", "Bill", "split", `json_each(CASE WHEN json_valid(c.split) THEN c.split ELSE '{}' END, '$.ids') j`, "j.value", "c.groupId"],
];
// Expected after deletions (count only): [table, column, target table]
const EXPECTED = [
  ["GroupEvent", "actorId", "Member"],
  ["GroupEvent", "expenseId", "Expense"],
  ["GroupEvent", "undoneById", "Member"],
  ["Expense", "createdById", "Member"],
  ["Expense", "deletedById", "Member"],
  ["Payment", "createdById", "Member"],
  ["Invite", "invitedById", "Member"],
  ["Invite", "memberId", "Member"],
  ["Member", "accountId", "Account"],
  ["Member", "addedBy", "Member"],
  ["Member", "removedById", "Member"],
  ["ListItem", "addedById", "Member"],
  ["ListItem", "boughtById", "Member"],
  ["ListItem", "expenseId", "Expense"],
  ["Goal", "createdById", "Member"],
  ["GroupPhoto", "createdById", "Member"],
  ["Moment", "groupId", "Group"],
  ["Moment", "authorId", "Member"],
  ["Postcard", "groupId", "Group"],
  ["Postcard", "photoId", "PostcardPhoto"],
  ["PostcardPhoto", "accountId", "Account"],
  ["Collection", "accountId", "Account"],
  ["CollectionEntry", "accountId", "Account"],
  ["Block", "blockerId", "Account"],
  ["Block", "blockedId", "Account"],
  ["Report", "reporterId", "Account"],
  ["Report", "targetAccountId", "Account"],
];

export async function countOrphans(client, schemaText) {
  const models = readSchema(schemaText);
  const tables = new Set((await q(client, "SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => String(r.name)));
  const has = (t, c) => tables.has(t) && models.get(t)?.cols.has(c);
  const orphans = (t, c, u, r = "id") => one(client, `SELECT COUNT(*) FROM "${t}" c WHERE c."${c}" IS NOT NULL AND c."${c}" <> '' AND NOT EXISTS (SELECT 1 FROM "${u}" u WHERE u."${r}" = c."${c}")`);

  // Declared links (a foreign key exists).
  let declaredTotal = 0;
  let declaredLinks = 0;
  const declaredBad = [];
  for (const [t, m] of models)
    for (const l of m.links) {
      if (!tables.has(t) || !tables.has(l.target)) continue;
      declaredLinks++;
      const n = await orphans(t, l.col, l.target, l.ref);
      declaredTotal += n;
      if (n) declaredBad.push(`${t}.${l.col} ${n}`);
    }
  let fkCheck = "not available";
  try {
    fkCheck = String((await q(client, "PRAGMA foreign_key_check")).length);
  } catch {
    /* refused: reported as not available */
  }

  // Plain-id columns that carry money.
  const money = [];
  for (const [t, c, u] of MONEY_PLAIN) if (has(t, c) && tables.has(u)) money.push(`${t}.${c} ${await orphans(t, c, u)}`);
  for (const [label, t, c, from, idExpr, grp] of MONEY_JSON) {
    if (!has(t, c)) continue;
    const n = await one(client, `SELECT COUNT(*) FROM "${t}" c, ${from} WHERE c."${c}" <> '' AND json_valid(c."${c}") AND NOT EXISTS (SELECT 1 FROM Member m WHERE m.id = ${idExpr} AND m.groupId = ${grp})`);
    const bad = await one(client, `SELECT COUNT(*) FROM "${t}" c WHERE c."${c}" <> '' AND NOT json_valid(c."${c}")`);
    money.push(`${label} ${n}${bad ? ` (not valid JSON ${bad})` : ""}`);
  }
  if (has("ExpenseItem", "people") && tables.has("Expense")) {
    const n = await one(client, `SELECT COUNT(*) FROM ExpenseItem c JOIN Expense e ON e.id = c.expenseId, json_each(CASE WHEN json_valid(c.people) THEN c.people ELSE '[]' END) j WHERE c.people <> '' AND json_valid(c.people) AND NOT EXISTS (SELECT 1 FROM Member m WHERE m.id = j.value AND m.groupId = e.groupId)`);
    const bad = await one(client, "SELECT COUNT(*) FROM ExpenseItem WHERE people <> '' AND NOT json_valid(people)");
    money.push(`ExpenseItem.people ${n}${bad ? ` (not valid JSON ${bad})` : ""}`);
  }
  // Cross-group: a link that points into a different group.
  const cross = [
    ["ExpenseShare member in another group", "SELECT COUNT(*) FROM ExpenseShare s JOIN Expense e ON e.id = s.expenseId JOIN Member m ON m.id = s.memberId WHERE m.groupId <> e.groupId"],
    ["Expense payer in another group", "SELECT COUNT(*) FROM Expense e JOIN Member m ON m.id = e.paidById WHERE m.groupId <> e.groupId"],
    ["Payment from in another group", "SELECT COUNT(*) FROM Payment p JOIN Member m ON m.id = p.fromId WHERE m.groupId <> p.groupId"],
    ["Payment to in another group", "SELECT COUNT(*) FROM Payment p JOIN Member m ON m.id = p.toId WHERE m.groupId <> p.groupId"],
  ];
  for (const [label, sql] of cross) money.push(`${label} ${await one(client, sql)}`);

  // Expected after deletions.
  const expected = [];
  for (const [t, c, u] of EXPECTED) if (has(t, c) && tables.has(u)) expected.push(`${t}.${c} ${await orphans(t, c, u)}`);
  if (has("GroupEvent", "paymentId") && tables.has("Payment") && tables.has("PaymentClaim")) {
    const n = await one(
      client,
      `SELECT COUNT(*) FROM GroupEvent c WHERE c.paymentId IS NOT NULL AND c.paymentId <> '' AND CASE WHEN c.paymentId LIKE 'claim:%' THEN NOT EXISTS (SELECT 1 FROM PaymentClaim u WHERE u.id = substr(c.paymentId, 7)) ELSE NOT EXISTS (SELECT 1 FROM Payment u WHERE u.id = c.paymentId) END`,
    );
    expected.push(`GroupEvent.paymentId ${n}`);
  }
  return [
    `declared links, should be 0: ${declaredTotal} over ${declaredLinks} links${declaredBad.length ? ` (${declaredBad.join(", ")})` : ""} | foreign key check: ${fkCheck}`,
    `Orphans (money, must be 0): ${money.join(" | ")}`,
    `Orphans (expected after deletions): ${expected.join(" | ")}`,
  ];
}

// ================= Item 5: old PaymentClaim rows =================
export async function countClaims(client, nowMs) {
  const by = new Map();
  for (const r of await q(client, "SELECT status, COUNT(*) AS n FROM PaymentClaim GROUP BY status")) by.set(String(r.status), Number(r.n));
  const known = ["waiting", "confirmed", "declined", "withdrawn", "covered", "expired"];
  const other = [...by.entries()].filter(([k]) => !known.includes(k)).reduce((a, [, n]) => a + n, 0);
  const waiting = await q(client, "SELECT groupId, fromId, toId, currency, createdAt FROM PaymentClaim WHERE status = 'waiting'");
  const gids = [...new Set(waiting.map((w) => String(w.groupId)))];
  const groups = new Map();
  const people = new Map();
  for (const part of chunks(gids, 200)) {
    for (const g of await q(client, `SELECT id, currency, closed, deletedAt FROM "Group" WHERE id IN (${marks(part.length)})`, part)) groups.set(String(g.id), g);
    for (const m of await q(client, `SELECT id, leftAt FROM Member WHERE groupId IN (${marks(part.length)})`, part)) people.set(String(m.id), m);
  }
  const age = { young: 0, mid: 0, old: 0 };
  let gone = 0;
  let wrongCur = 0;
  let missing = 0;
  for (const w of waiting) {
    const days = (nowMs - (toMs(w.createdAt) ?? nowMs)) / 86_400_000;
    if (days < 30) age.young++;
    else if (days <= 90) age.mid++;
    else age.old++;
    const g = groups.get(String(w.groupId));
    if (!g || (g.deletedAt !== null && g.deletedAt !== undefined) || Number(g.closed) === 1) gone++;
    if (g && String(g.currency) !== String(w.currency)) wrongCur++;
    const a = people.get(String(w.fromId));
    const b = people.get(String(w.toId));
    if (!a || !b || (a.leftAt ?? null) !== null || (b.leftAt ?? null) !== null) missing++;
  }
  const covered = await one(client, "SELECT COUNT(*) FROM PaymentClaim c WHERE c.status = 'covered' AND NOT EXISTS (SELECT 1 FROM Payment p WHERE p.id = c.paymentId AND p.deletedAt IS NULL)");
  const n = (k) => by.get(k) ?? 0;
  return `by status: waiting ${n("waiting")}, confirmed ${n("confirmed")}, declined ${n("declined")}, withdrawn ${n("withdrawn")}, covered ${n("covered")}, expired ${n("expired")}${other ? `, other ${other}` : ""} | waiting by age: <30d ${age.young}, 30–90d ${age.mid}, >90d ${age.old} | waiting in gone/closed groups ${gone} | waiting in another currency than the group's ${wrongCur} | waiting with a person missing or left ${missing} | covered pointing at a missing payment ${covered}`;
}

// ---- Putting it together.
export async function countAll(client, opts = {}) {
  const cutoffMs = opts.cutoffMs ?? Date.parse(DEFAULT_CUTOFF);
  const schemaText = opts.schemaText ?? readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const sections = [
    ["1 · Emails in history", () => countEmailsInHistory(client, cutoffMs)],
    ["2 · Names marked joined (OA-1)", () => countWrongJoined(client)],
    ["3 · Left with a balance", () => countLeaversWithBalance(client)],
    ["4 · Orphans", async () => (await countOrphans(client, schemaText)).join("\n")],
    ["5 · Old I've-paid notes", () => countClaims(client, opts.nowMs ?? Date.now())],
  ];
  const out = [];
  for (const [title, run] of sections) {
    try {
      out.push({ title, text: await run() });
    } catch (e) {
      // Only the kind of error, never its message (a message can hold a value from the data).
      out.push({ title, text: `Failed: ${String(e?.code ?? e?.constructor?.name ?? "Error").replace(/[^A-Za-z0-9_]/g, "")}`, failed: true });
    }
  }
  return out;
}

// Prints and returns the exit code (0 ok, 1 refused or failed). `write` is for tests.
export async function run({ env = process.env, client, write = (s) => console.log(s), summaryFile = env.GITHUB_STEP_SUMMARY } = {}) {
  const say = (s) => write(safeLine(s));
  try {
    if (!env.TURSO_DATABASE_URL) throw new Refusal("REFUSING: TURSO_DATABASE_URL is not set.");
    if (env.GITHUB_ACTIONS === "true" && !["ops-live-counts", "ops-live-counts-staging"].includes(String(env.GITHUB_REF_NAME))) throw new Refusal("REFUSING: this only runs on a live-counts branch.");
    const cutoffMs = Date.parse(env.CUTOFF || DEFAULT_CUTOFF);
    if (Number.isNaN(cutoffMs)) throw new Refusal("REFUSING: CUTOFF is not a date.");
    const db = client ?? createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN || undefined });
    await guardReadOnly(db, env.TURSO_AUTH_TOKEN);
    say("Read-only check passed. Counting.");
    const results = await countAll(db, { cutoffMs });
    let code = 0;
    const lines = [];
    for (const r of results) {
      if (r.failed) code = 1;
      for (const [i, part] of r.text.split("\n").entries()) {
        const title = r.title === "4 · Orphans" ? `4 · Orphans (${["declared", "money, must be 0", "expected after deletions"][i] ?? "more"})` : r.title;
        const text = r.title === "4 · Orphans" ? part.replace(/^Orphans \([^)]*\): /, "") : part;
        const line = safeLine(`${title}: ${text}`);
        write(line === "(line withheld)" ? line : `::notice title=${safeLine(title)}::${esc(safeLine(text))}`);
        lines.push(line === "(line withheld)" ? `- ${title}: (line withheld)` : `- ${title}: ${text}`);
      }
    }
    if (summaryFile) {
      try {
        appendFileSync(summaryFile, `## Live counts (read-only)\n\n${lines.map((l) => safeLine(l)).join("\n")}\n`);
      } catch {
        /* no summary file: the notices above are enough */
      }
    }
    return code;
  } catch (e) {
    if (e instanceof Refusal) {
      write(e.message);
      return 1;
    }
    write(`Failed: ${String(e?.code ?? e?.constructor?.name ?? "Error").replace(/[^A-Za-z0-9_]/g, "")}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run();
}
