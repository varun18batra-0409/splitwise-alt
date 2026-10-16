// Numbers about the live app — speed on people's phones and whether invites
// turn into members. Counts and timings only: no names, emails or amounts.
// Run by the "Live stats" workflow (needs TURSO_DATABASE_URL / TURSO_AUTH_TOKEN).
import { createClient } from "@libsql/client";

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const hours = Number(process.env.HOURS ?? 24);
const since = new Date(Date.now() - hours * 3600_000).toISOString();
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const one = async (sql, args = []) => Number(Object.values((await q(sql, args))[0] ?? { n: 0 })[0] ?? 0);
const out = [];
const log = (s = "") => {
  console.log(s);
  out.push(s);
};
// DateTimes may be stored as ms numbers or ISO text, depending on the driver: match both.
const after = (col) => `((typeof(${col}) = 'integer' AND ${col} >= ?) OR (typeof(${col}) = 'text' AND ${col} >= ?))`;
const at = (ms) => [ms, new Date(ms).toISOString()];
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : 0);

log(`## Speed on phones, last ${hours} h`);
const exists = (await q("SELECT name FROM sqlite_master WHERE type='table' AND name='SpeedLog'")).length > 0;
if (!exists) log("(no speed numbers yet: SpeedLog not created)");
else {
  const rows = await q(`SELECT kind, route, ms FROM SpeedLog WHERE ${after("at")}`, at(Date.parse(since)));
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.kind} ${r.route}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(Number(r.ms));
  }
  log("| kind | screen | count | median ms | 90% ms | slowest ms |");
  log("|---|---|---|---|---|---|");
  for (const [k, v] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 40)) {
    v.sort((a, b) => a - b);
    const [kind, route] = k.split(" ");
    log(`| ${kind} | ${route} | ${v.length} | ${pct(v, 50)} | ${pct(v, 90)} | ${v[v.length - 1]} |`);
  }
  for (const kind of ["load", "nav", "submit", "search"]) {
    const v = rows.filter((r) => r.kind === kind).map((r) => Number(r.ms)).sort((a, b) => a - b);
    if (v.length) log(`- ${kind}: ${v.length} timings, median ${pct(v, 50)} ms, 90% ${pct(v, 90)} ms`);
  }
}

log("");
log("## People, groups and invites (all time)");
log(`- Accounts (verified emails): ${await one("SELECT COUNT(*) FROM Account")}`);
for (const r of await q("SELECT type, COUNT(*) n FROM \"Group\" WHERE deletedAt IS NULL GROUP BY type")) log(`- Groups (${r.type}): ${r.n}`);
log(`- Members: ${await one("SELECT COUNT(*) FROM Member")}, signed in: ${await one("SELECT COUNT(*) FROM Member WHERE accountId IS NOT NULL")}, left: ${await one("SELECT COUNT(*) FROM Member WHERE leftAt IS NOT NULL")}`);
log(`- Members without an account (old name-only adds): ${await one("SELECT COUNT(*) FROM Member WHERE accountId IS NULL AND leftAt IS NULL")}`);
log(`- Groups where nobody else has joined yet: ${await one("SELECT COUNT(*) FROM \"Group\" g WHERE deletedAt IS NULL AND (SELECT COUNT(*) FROM Member m WHERE m.groupId = g.id AND m.leftAt IS NULL) < 2")}`);
log(`- Emails sent in the current 24-hour window (sign-in codes, invites): ${await one(`SELECT COALESCE(MAX(count),0) FROM RateLimit WHERE key = 'mail:all' AND ${after("resetAt")}`, at(Date.now()))}`);
log(`- Emails that failed to send, last ${hours} h: ${await one(`SELECT COUNT(*) FROM NotifyLog WHERE key LIKE 'mail-failed:send:%' AND ${after("createdAt")}`, at(Date.parse(since)))} (daily cap hit: ${await one(`SELECT COUNT(*) FROM NotifyLog WHERE key LIKE 'mail-failed:cap:%' AND ${after("createdAt")}`, at(Date.parse(since)))})`);
log(`- Email invites: ${await one("SELECT COUNT(*) FROM Invite")}, accepted: ${await one("SELECT COUNT(*) FROM Invite WHERE acceptedAt IS NOT NULL")}, waiting: ${await one("SELECT COUNT(*) FROM Invite WHERE acceptedAt IS NULL")}`);
log(`- Invited people who have an account but are not in that group: ${await one("SELECT COUNT(*) FROM Invite i JOIN Account a ON a.email = i.email WHERE NOT EXISTS (SELECT 1 FROM Member m WHERE m.groupId = i.groupId AND m.accountId = a.id AND m.leftAt IS NULL)")}`);
log(`- Accepted invites without a member in the group: ${await one("SELECT COUNT(*) FROM Invite i WHERE i.acceptedAt IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Member m JOIN Account a ON a.id = m.accountId WHERE m.groupId = i.groupId AND a.email = i.email)")}`);
log(`- Joined by link (events): ${await one("SELECT COUNT(*) FROM GroupEvent WHERE text = 'joined the group'")}, added from search/email (events): ${await one("SELECT COUNT(*) FROM GroupEvent WHERE kind = 'members_added' AND text <> 'joined the group'")}`);
log(`- Sign-in codes sent, last ${hours} h: ${await one(`SELECT COUNT(*) FROM LoginCode WHERE ${after("createdAt")}`, at(Date.parse(since)))}`);
log("");
log(`## Errors, last 7 days (where they happened, not the messages)`);
for (const r of await q(`SELECT path, COUNT(*) n FROM ErrorLog WHERE ${after("createdAt")} GROUP BY path ORDER BY n DESC LIMIT 15`, at(Date.now() - 7 * 86_400_000)))
  log(`- ${String(r.path).split("?")[0].replace(/[^/]*@[^/]*/g, ":email").replace(/[a-z0-9]{20,}/gi, ":id")}: ${r.n}`);
log("");
log("## Table sizes");
for (const t of ["Expense", "ExpenseShare", "GroupEvent", "RateLimit", "RequestKey", "NotifyLog", "LoginCode"]) log(`- ${t}: ${await one(`SELECT COUNT(*) FROM "${t}"`)}`);

// Also as notes on the run (readable without opening the log), one per section.
const esc = (t) => t.replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
let title = "", body = [];
const emit = () => title && console.log(`::notice title=${title}::${esc(body.join("\n")).slice(0, 3800)}`);
for (const line of out) {
  if (line.startsWith("## ")) {
    emit();
    title = line.slice(3);
    body = [];
  } else if (line) body.push(line);
}
emit();

const { writeFileSync } = await import("node:fs");
writeFileSync("live-stats.md", out.join("\n"));
