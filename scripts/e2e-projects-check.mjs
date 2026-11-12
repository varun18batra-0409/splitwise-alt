// Proves each browser project really ran (AUTO-01): a run with the iPhone project quietly missing must not look green.
// Usage: node scripts/e2e-projects-check.mjs <results.json> <project> [<project> ...]
// For every project named it needs at least one test that actually executed (not skipped), and no test in the
// file may come from a project that wasn't asked for. Exits 1 with a plain message on anything else.
// Prints a ::notice per project (counts), so the evidence is readable from the run page.
import { existsSync, readFileSync } from "node:fs";

const [file, ...projects] = process.argv.slice(2);
if (!file || !projects.length) {
  console.error("Usage: node scripts/e2e-projects-check.mjs <results.json> <project> [...]");
  process.exit(2);
}
const fail = (m) => {
  console.log(`::error title=Browser projects::${m}`);
  process.exit(1);
};
if (!existsSync(file)) fail(`no result file at ${file}`);
let data;
try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch {
  fail(`${file} is not valid JSON`);
}
if (!data || !Array.isArray(data.suites)) fail(`${file} is not a Playwright result file`);
const per = {};
const visit = (s) => {
  for (const c of s.suites ?? []) visit(c);
  for (const spec of s.specs ?? [])
    for (const t of spec.tests ?? []) {
      const p = t.projectName ?? "(none)";
      const ran = (t.results ?? []).some((r) => r.status && r.status !== "skipped");
      per[p] ??= { ran: 0, skipped: 0 };
      per[p][ran ? "ran" : "skipped"]++;
    }
};
for (const s of data.suites) visit(s);
const problems = [];
for (const p of projects) {
  const c = per[p];
  if (!c) problems.push(`project "${p}" has no tests in the report`);
  else if (!c.ran) problems.push(`project "${p}" ran nothing (${c.skipped} skipped)`);
  else console.log(`::notice title=Browser project ${p}::${c.ran} test(s) ran, ${c.skipped} skipped`);
}
for (const p of Object.keys(per)) if (!projects.includes(p)) problems.push(`unexpected project "${p}" in the report`);
if (problems.length) fail(problems.join("; "));
