// Exercise A: turns the downloaded results into one plain-English page.
// Usage: node scripts/exercise-a-summary.mjs <results folder> <summary file to write>
//
// It reads (whatever exists; a missing piece is reported as missing, never skipped):
//   <results>/uat-android|uat-iphone|uat-desktop/coverage.json  (and summary.txt, if the run crashed)
//   <results>/unit-junit/vitest-junit.xml
//   <results>/e2e-json/**/results.json  (Playwright, one per device)
// Plain Node, no packages, so it runs anywhere.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [dir = "results", outFile = "results/exercise-a-summary.md"] = process.argv.slice(2);
const PROFILES = ["android", "iphone", "desktop"];
const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : null);
const json = (f) => {
  try {
    return JSON.parse(read(f));
  } catch {
    return null;
  }
};
const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const short = (s, n = 400) => (cell(s).length > n ? cell(s).slice(0, n) + "…" : cell(s));
const unxml = (s) => String(s).replace(/&#10;/g, " ").replace(/&#13;/g, "").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attrs = (s) => Object.fromEntries([...String(s).matchAll(/([\w:.-]+)="([^"]*)"/g)].map((m) => [m[1], unxml(m[2])]));
const walk = (d) =>
  !existsSync(d) ? [] : readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

const problems = [];
const out = [];
const add = (...l) => out.push(...l);

// ---------------------------------------------------------------- UAT
const uat = {};
for (const p of PROFILES) {
  const cov = json(join(dir, `uat-${p}`, "coverage.json"));
  const sum = read(join(dir, `uat-${p}`, "summary.txt"));
  uat[p] = { cov, sum };
  if (!cov) problems.push(`UAT ${p}: no result was written${sum ? ` (${sum.split("\n")[0]})` : ""}`);
  else {
    if (cov.totals.failed > 0) problems.push(`UAT ${p}: ${cov.totals.failed} step(s) failed`);
    if (sum && /^crashed/.test(sum)) problems.push(`UAT ${p}: the run crashed part-way`);
  }
}

// ---------------------------------------------------------------- unit tests (JUnit)
let unit = null;
{
  const xml = read(join(dir, "unit-junit", "vitest-junit.xml"));
  if (xml) {
    const cases = [...xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)].map((m) => ({ a: attrs(m[1]), body: m[2] ?? "" }));
    const failed = cases.filter((c) => /<(failure|error)\b/.test(c.body));
    const skipped = cases.filter((c) => /<skipped\b/.test(c.body));
    unit = {
      total: cases.length,
      failed: failed.length,
      skipped: skipped.length,
      passed: cases.length - failed.length - skipped.length,
      files: new Set(cases.map((c) => c.a.classname)).size,
      list: failed.map((c) => ({ name: `${c.a.classname ?? ""} › ${c.a.name ?? ""}`, why: attrs((/<(?:failure|error)\b([^>]*)>/.exec(c.body) ?? [])[1] ?? "").message ?? "" })),
    };
    if (!unit.total) problems.push("Unit tests: the JUnit report has no tests in it");
    if (unit.failed) problems.push(`Unit tests: ${unit.failed} failed`);
  } else problems.push("Unit tests: no JUnit report was written");
}

// ---------------------------------------------------------------- end-to-end (Playwright results.json)
const E2E = [
  ["Android", "e2e-results/results.json"],
  ["iPhone", "e2e-results-ios/results.json"],
  ["Desktop", "e2e-results-desktop/results.json"],
];
const e2e = {};
{
  const files = walk(join(dir, "e2e-json"));
  for (const [label, tail] of E2E) {
    const f = files.find((x) => relative(join(dir, "e2e-json"), x).replace(/\\/g, "/") === tail);
    const data = f ? json(f) : null;
    if (!data) {
      e2e[label] = null;
      problems.push(`End-to-end ${label}: no result file`);
      continue;
    }
    const rows = [];
    const visit = (suite, path = []) => {
      for (const s of suite.suites ?? []) visit(s, [...path, s.title].filter(Boolean));
      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests ?? []) {
          const r = t.results?.[t.results.length - 1];
          const status = t.status === "expected" ? (r?.status === "skipped" ? "skipped" : "passed") : t.status === "skipped" ? "skipped" : t.status === "flaky" ? "flaky" : "FAILED";
          const why = status === "FAILED" ? (r?.error?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" · ") : (t.annotations ?? []).map((a) => a.description).filter(Boolean).join("; ");
          rows.push({ file: path[0] ?? "", title: spec.title, status, why });
        }
      }
    };
    visit(data);
    const n = (s) => rows.filter((r) => r.status === s).length;
    e2e[label] = { passed: n("passed"), failed: n("FAILED"), skipped: n("skipped"), flaky: n("flaky"), total: rows.length, rows };
    if (!rows.length) problems.push(`End-to-end ${label}: the result file has no tests`);
    if (n("FAILED")) problems.push(`End-to-end ${label}: ${n("FAILED")} failed`);
  }
}

// ---------------------------------------------------------------- write it
const jobs = process.env.JOBS ?? "";
add("# Exercise A: results", "");
add(`Run: ${process.env.RUN_URL ?? "(local)"}  `);
add(`Commit: ${process.env.COMMIT ?? "(unknown)"}  `);
add(`Written: ${new Date().toISOString()}  `);
if (jobs) add(`Jobs: ${jobs}`);
add("");
add(problems.length ? `## Verdict: NOT CLEAN, ${problems.length} thing(s) to look at` : "## Verdict: CLEAN, nothing failed and nothing is missing", "");
for (const p of problems) add(`- ${p}`);
if (problems.length) add("");
add("The test accounts are all `@uat.loopin.test` or `@e2e.loopin.test`; every email stayed in a throwaway database file; nothing live was touched.", "");

add("## UAT: a person tapping through every feature, on each device", "");
add("| Device | Profile | Passed | Failed | Not applicable | Steps |", "|---|---|---|---|---|---|");
for (const p of PROFILES) {
  const c = uat[p].cov;
  add(c ? `| ${p} | ${cell(c.label)} | ${c.totals.passed} | ${c.totals.failed} | ${c.totals.notApplicable} | ${c.totals.steps} |` : `| ${p} | no result | - | - | - | - |`);
}
add("");
for (const p of PROFILES) {
  const c = uat[p].cov;
  if (!c) {
    if (uat[p].sum) add(`### ${p}: no coverage file`, "", "```", uat[p].sum.slice(0, 1500), "```", "");
    continue;
  }
  const bad = c.steps.filter((s) => s.status === "fail");
  add(`### ${p}: failures`, "");
  if (!bad.length) add("None.", "");
  else {
    add("| # | Area | Step | What went wrong |", "|---|---|---|---|");
    for (const s of bad) add(`| ${s.n} | ${cell(s.coverage)} | ${short(s.name, 200)} | ${short(s.detail)} |`);
    add("");
  }
  if (uat[p].sum && /^crashed/.test(uat[p].sum)) add(`The ${p} run crashed: ${short(uat[p].sum.split("\n")[0])}`, "");
}

add("### Steps marked \"not applicable\" (only for other devices)", "");
add("These are listed on purpose, never skipped quietly. Each one runs on the devices named.", "");
{
  const seen = new Map();
  for (const p of PROFILES) for (const s of uat[p].cov?.steps ?? []) if (s.status === "na") seen.set(s.name, { runsOn: s.runsOn, why: s.detail, on: [...(seen.get(s.name)?.on ?? []), p] });
  if (!seen.size) add("None.", "");
  else {
    add("| Step | Runs on | Not applicable on | Why |", "|---|---|---|---|");
    for (const [name, v] of seen) add(`| ${short(name, 160)} | ${v.runsOn.join(", ")} | ${v.on.join(", ")} | ${short(v.why.replace(/^not applicable on \w+: /, ""), 200)} |`);
    add("");
  }
}

add("### Coverage by area (steps, across the three devices)", "");
const AREAS = ["Money", "Onboarding", "Permissions", "Imports", "Sharing", "Notifications", "Privacy", "Regression"];
add("| Area | " + PROFILES.map((p) => `${p} (pass/fail/n.a.)`).join(" | ") + " |", "|---|" + PROFILES.map(() => "---").join("|") + "|");
for (const a of AREAS) {
  add(`| ${a} | ` + PROFILES.map((p) => { const x = uat[p].cov?.areas?.[a]; return x ? `${x.passed}/${x.failed}/${x.notApplicable}` : "-"; }).join(" | ") + " |");
}
add("");
{
  const thin = [...new Set(PROFILES.flatMap((p) => uat[p].cov?.thinAreas ?? []))];
  add(thin.length ? `Areas with fewer than 5 steps: ${thin.join(", ")}.` : "Every area has at least 5 steps.", "");
}

add("## Unit tests (vitest)", "");
if (!unit) add("No result.", "");
else {
  add(`${unit.passed} passed · ${unit.failed} failed · ${unit.skipped} skipped · ${unit.total} tests in ${unit.files} files`, "");
  if (unit.list.length) {
    add("| Test | Why |", "|---|---|");
    for (const f of unit.list) add(`| ${short(f.name, 200)} | ${short(f.why)} |`);
    add("");
  }
}

add("## End-to-end (Playwright)", "");
add("| Device | Passed | Failed | Skipped or blocked | Flaky | Total |", "|---|---|---|---|---|---|");
for (const [label] of E2E) {
  const r = e2e[label];
  add(r ? `| ${label} | ${r.passed} | ${r.failed} | ${r.skipped} | ${r.flaky} | ${r.total} |` : `| ${label} | no result | - | - | - | - |`);
}
add("");
for (const [label] of E2E) {
  const r = e2e[label];
  if (!r) continue;
  const bad = r.rows.filter((x) => x.status === "FAILED");
  if (bad.length) {
    add(`### ${label}: failures`, "", "| Test | Why |", "|---|---|");
    for (const x of bad) add(`| ${short(`${x.file} › ${x.title}`, 200)} | ${short(x.why)} |`);
    add("");
  }
  const skipped = r.rows.filter((x) => x.status === "skipped");
  if (skipped.length) {
    add(`### ${label}: skipped or blocked`, "");
    for (const x of skipped) add(`- ${short(`${x.file} › ${x.title}`, 200)}${x.why ? ` (${short(x.why, 200)})` : ""}`);
    add("");
  }
}
add("The test that needs a real Splitwise export shows as blocked here on purpose: Exercise A never uses a secret or real data.", "");

add("## Where everything is", "");
add("- Artifacts of this run: `uat-android`, `uat-iphone`, `uat-desktop` (report.md, coverage.md, coverage.json, screenshots of failures), `unit-junit`, `e2e-report` (open `index.html` in each folder), `e2e-json`, `exercise-a-summary`.");
add("- The same files are saved on the `exercise-a-results` branch.", "");

writeFileSync(outFile, out.join("\n") + "\n");
console.log(out.slice(0, 12).join("\n"));
console.log(`... written to ${outFile}`);
