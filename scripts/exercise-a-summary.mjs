// Exercise A: turns the downloaded results into one plain-English page, and FAILS CLOSED.
// Usage: node scripts/exercise-a-summary.mjs <results folder> <summary file to write>
//
// Exit code 0 only when every expected job succeeded and every expected piece of evidence is
// there, valid, for the right commit, and clean. Anything missing, corrupt, skipped without a
// reason, failed, cancelled, flaky or from another commit is a problem: the verdict says FAILED,
// the exit code is 1, and the word CLEAN is never printed.
//
// Environment:
//   COMMIT         the commit this run must be about (required; results stamped with another one fail)
//   JOBS           "uat=success unit=success e2e=success" (the needs.<job>.result of each job)
//   EXPECTED_JOBS  the jobs that must be listed and successful (default: "uat unit e2e")
//   REPO_ROOT      checkout used for the expected test inventory (default: current folder)
//   RUN_URL        link to the run (only shown)
//
// It reads (a missing piece is a problem, never skipped quietly):
//   <results>/uat-android|uat-iphone|uat-desktop/coverage.json + meta.json (and summary.txt, if the run crashed)
//   <results>/unit-junit/vitest-junit.xml + meta.json
//   <results>/e2e-json/**/results.json (Playwright, one per device) + e2e-meta.json
// Plain Node, no packages, so it runs anywhere.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

const [dir = "results", outFile = "results/exercise-a-summary.md"] = process.argv.slice(2);
const REPO = process.env.REPO_ROOT ?? ".";
const PROFILES = ["android", "iphone", "desktop"];
const EXPECTED_JOBS = (process.env.EXPECTED_JOBS ?? "uat unit e2e").split(/[\s,]+/).filter(Boolean);
const EXPECTED_COMMIT = (process.env.COMMIT ?? "").trim();

const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : null);
// state: "missing" | "corrupt" | "ok"
const load = (f) => {
  const raw = read(f);
  if (raw === null) return { state: "missing", data: null };
  try {
    return { state: "ok", data: JSON.parse(raw) };
  } catch {
    return { state: "corrupt", data: null };
  }
};
const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const short = (s, n = 400) => (cell(s).length > n ? cell(s).slice(0, n) + "…" : cell(s));
const unxml = (s) => String(s).replace(/&#10;/g, " ").replace(/&#13;/g, "").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attrs = (s) => Object.fromEntries([...String(s).matchAll(/([\w:.-]+)="([^"]*)"/g)].map((m) => [m[1], unxml(m[2])]));
const walk = (d) =>
  !existsSync(d) ? [] : readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

const problems = []; // each one makes the run FAIL
const warnings = []; // shown, but explained (a not-run step with its reason, an accepted skip)
const out = [];
const add = (...l) => out.push(...l);

// ---------------------------------------------------------------- the jobs themselves
const jobs = process.env.JOBS ?? "";
{
  const seen = Object.fromEntries([...jobs.matchAll(/([\w-]+)=([\w-]*)/g)].map((m) => [m[1], m[2]]));
  if (!EXPECTED_JOBS.length) problems.push("Jobs: no expected job list was given");
  for (const j of EXPECTED_JOBS) {
    if (!(j in seen) || seen[j] === "") problems.push(`Job "${j}": its result is missing from the run (expected success)`);
    else if (seen[j] !== "success") problems.push(`Job "${j}" ended as ${seen[j]} (expected success)`);
  }
  for (const [j, r] of Object.entries(seen)) if (!EXPECTED_JOBS.includes(j) && r !== "success") problems.push(`Job "${j}" ended as ${r || "unknown"}`);
}

// ---------------------------------------------------------------- commit stamp
if (!EXPECTED_COMMIT) problems.push("No expected commit was given (COMMIT), so the results cannot be tied to one version");
function checkStamp(label, file, extra = {}) {
  const m = load(file);
  if (m.state === "missing") return problems.push(`${label}: no commit stamp (${basename(file)}), so the results cannot be tied to this version`);
  if (m.state === "corrupt" || !m.data || typeof m.data !== "object") return problems.push(`${label}: the commit stamp is corrupt`);
  if (!m.data.commit) problems.push(`${label}: the commit stamp has no commit`);
  else if (EXPECTED_COMMIT && m.data.commit !== EXPECTED_COMMIT) problems.push(`${label}: results are for commit ${String(m.data.commit).slice(0, 7)}, not ${EXPECTED_COMMIT.slice(0, 7)}`);
  for (const [k, v] of Object.entries(extra)) if (m.data[k] !== v) problems.push(`${label}: the stamp says ${k} "${m.data[k]}", expected "${v}"`);
}

// ---------------------------------------------------------------- UAT
const uat = {};
for (const p of PROFILES) {
  const folder = join(dir, `uat-${p}`);
  const loaded = load(join(folder, "coverage.json"));
  const sum = read(join(folder, "summary.txt"));
  const cov = loaded.state === "ok" ? loaded.data : null;
  uat[p] = { cov, sum };
  const L = `UAT ${p}`;
  if (loaded.state !== "ok") {
    problems.push(`${L}: ${loaded.state === "corrupt" ? "the result file is corrupt JSON" : "no result was written"}${sum ? ` (${sum.split("\n")[0]})` : ""}`);
    uat[p].cov = null;
    continue;
  }
  const t = cov?.totals;
  const steps = cov?.steps;
  if (!t || !Array.isArray(steps) || ![t.steps, t.passed, t.failed, t.notApplicable, t.notRun].every(isNum)) {
    problems.push(`${L}: the result file is not in the expected format`);
    uat[p].cov = null;
    continue;
  }
  checkStamp(L, join(folder, "meta.json"), { profile: p });
  if (cov.profile !== p) problems.push(`${L}: the result file is for profile "${cov.profile}"`);
  const n = (s) => steps.filter((x) => x.status === s).length;
  const known = ["pass", "fail", "na", "skip"];
  if (steps.some((x) => !known.includes(x.status))) problems.push(`${L}: a step has an unknown result`);
  if (t.steps !== steps.length || t.passed !== n("pass") || t.failed !== n("fail") || t.notApplicable !== n("na") || t.notRun !== n("skip")) problems.push(`${L}: the totals do not match the steps listed`);
  if (!steps.length) problems.push(`${L}: no steps were recorded`);
  else if (n("pass") === 0) problems.push(`${L}: not one step passed`);
  if (t.failed > 0 || n("fail") > 0) problems.push(`${L}: ${Math.max(t.failed, n("fail"))} step(s) failed`);
  if (sum && /^crashed/.test(sum)) problems.push(`${L}: the run crashed part-way`);
  for (const s of steps) {
    if (s.status === "skip") {
      const why = String(s.detail ?? "").replace(/^not run:\s*/i, "").trim();
      if (!why || why === "no reason given") problems.push(`${L}: step "${short(s.name, 120)}" was skipped with no reason`);
      else warnings.push(`${L}: NOT RUN "${short(s.name, 120)}" (${short(why, 160)})`);
    }
    if (s.status === "na" && Array.isArray(s.runsOn) && s.runsOn.includes(p)) problems.push(`${L}: step "${short(s.name, 120)}" is marked not applicable but is meant to run here`);
    if (s.status === "fail") {
      const shot = /\(screenshot: ([\w.-]+\.png)\)/.exec(String(s.detail ?? ""))?.[1];
      if (shot && !existsSync(join(folder, shot))) problems.push(`${L}: the screenshot of failed step ${s.n} (${shot}) is missing`);
    }
  }
}
{
  // Every device lists the same steps (the ones for other devices show as "not applicable"), so a step
  // missing from one device means that device did not get that far.
  const have = PROFILES.filter((p) => uat[p].cov);
  if (have.length > 1) {
    const all = new Set(have.flatMap((p) => uat[p].cov.steps.map((s) => s.name)));
    for (const p of have) {
      const names = new Set(uat[p].cov.steps.map((s) => s.name));
      const missing = [...all].filter((x) => !names.has(x));
      if (missing.length) problems.push(`UAT ${p}: ${missing.length} step(s) other devices ran are missing, e.g. "${short(missing[0], 120)}"`);
    }
  }
}

// ---------------------------------------------------------------- unit tests (JUnit)
let unit = null;
{
  const L = "Unit tests";
  const xml = read(join(dir, "unit-junit", "vitest-junit.xml"));
  if (xml === null) problems.push(`${L}: no JUnit report was written`);
  else if (!/<testsuites?\b/.test(xml) || !/<\/testsuites?>\s*$/.test(xml)) problems.push(`${L}: the JUnit report is corrupt or cut short`);
  else {
    checkStamp(L, join(dir, "unit-junit", "meta.json"));
    const cases = [...xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)].map((m) => ({ a: attrs(m[1]), body: m[2] ?? "" }));
    const failed = cases.filter((c) => /<(failure|error)\b/.test(c.body));
    const skipped = cases.filter((c) => /<skipped\b/.test(c.body));
    const classes = new Set(cases.map((c) => c.a.classname));
    unit = {
      total: cases.length,
      failed: failed.length,
      skipped: skipped.length,
      passed: cases.length - failed.length - skipped.length,
      files: classes.size,
      list: failed.map((c) => ({ name: `${c.a.classname ?? ""} › ${c.a.name ?? ""}`, why: attrs((/<(?:failure|error)\b([^>]*)>/.exec(c.body) ?? [])[1] ?? "").message ?? "" })),
    };
    if (!unit.total) problems.push(`${L}: the JUnit report has no tests in it`);
    if (unit.failed) problems.push(`${L}: ${unit.failed} failed`);
    if (unit.skipped) problems.push(`${L}: ${unit.skipped} test(s) were skipped (a JUnit skip carries no reason)`);
    const top = attrs((/<testsuites\b([^>]*)>/.exec(xml) ?? [])[1] ?? "");
    if (Number(top.failures) > 0 || Number(top.errors) > 0) {
      if (!unit.failed) problems.push(`${L}: the report counts ${top.failures ?? 0} failure(s) and ${top.errors ?? 0} error(s)`);
    }
    const expectedFiles = walk(join(REPO, "tests")).filter((f) => /\.test\.ts$/.test(f)).map((f) => relative(REPO, f).replace(/\\/g, "/"));
    if (!expectedFiles.length) problems.push(`${L}: no expected test files found under ${join(REPO, "tests")}, so completeness cannot be checked`);
    else {
      const missing = expectedFiles.filter((f) => ![...classes].some((c) => c === f || String(c).endsWith("/" + f) || String(c).endsWith(f)));
      if (missing.length) problems.push(`${L}: ${missing.length} test file(s) have no results, e.g. ${missing.slice(0, 3).join(", ")}`);
    }
  }
}

// ---------------------------------------------------------------- end-to-end (Playwright results.json)
const E2E = [
  ["Android", "e2e-results/results.json", "phone"],
  ["iPhone", "e2e-results-ios/results.json", "iphone"],
  ["Desktop", "e2e-results-desktop/results.json", "desktop"],
];
// Skips that are known and explained. A skip not matching one of these (device, file and the start of the
// real reason from the run) is a problem. The reason shown is always the one the run itself recorded.
const ALLOWED_SKIPS = load(join(REPO, "scripts", "exercise-a-expected-skips.json")).data ?? [];
const e2e = {};
{
  const L0 = "End-to-end";
  const files = walk(join(dir, "e2e-json"));
  checkStamp(L0, join(dir, "e2e-json", "e2e-meta.json"));
  const expectedSpecs = walk(join(REPO, "e2e", "tests")).filter((f) => /\.spec\.ts$/.test(f)).map((f) => basename(f));
  if (!expectedSpecs.length) problems.push(`${L0}: no expected spec files found under ${join(REPO, "e2e", "tests")}, so completeness cannot be checked`);
  if (!Array.isArray(ALLOWED_SKIPS)) problems.push(`${L0}: scripts/exercise-a-expected-skips.json is missing or not a list`);
  for (const [label, tail, project] of E2E) {
    const L = `${L0} ${label}`;
    const f = files.find((x) => relative(join(dir, "e2e-json"), x).replace(/\\/g, "/") === tail);
    const loaded = f ? load(f) : { state: "missing", data: null };
    const data = loaded.data;
    if (loaded.state !== "ok") {
      e2e[label] = null;
      problems.push(`${L}: ${loaded.state === "corrupt" ? "the result file is corrupt JSON" : "no result file"}`);
      continue;
    }
    if (!data || !Array.isArray(data.suites) || !Array.isArray(data.errors) || !data.stats || typeof data.stats !== "object") {
      e2e[label] = null;
      problems.push(`${L}: the result file is not in the expected format`);
      continue;
    }
    const rows = [];
    const specFiles = new Set();
    const visit = (suite, path = [], top = null) => {
      for (const s of suite.suites ?? []) visit(s, [...path, s.title].filter(Boolean), top ?? s);
      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests ?? []) {
          const r = t.results?.[t.results.length - 1];
          const status = t.status === "expected" ? (r?.status === "skipped" ? "skipped" : "passed") : t.status === "skipped" ? "skipped" : t.status === "flaky" ? "flaky" : "FAILED";
          const why = status === "FAILED" ? (r?.error?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" · ") : (t.annotations ?? []).map((a) => a.description).filter(Boolean).join("; ");
          const file = basename(String(top?.file ?? path[0] ?? ""));
          specFiles.add(file);
          rows.push({ file, title: spec.title, status, why, project: t.projectName, attempts: t.results?.length ?? 0 });
        }
      }
    };
    visit(data);
    const n = (s) => rows.filter((r) => r.status === s).length;
    e2e[label] = { passed: n("passed"), failed: n("FAILED"), skipped: n("skipped"), flaky: n("flaky"), total: rows.length, rows };
    if (!rows.length) problems.push(`${L}: the result file has no tests`);
    else if (!n("passed")) problems.push(`${L}: not one test passed`);
    if (n("FAILED")) problems.push(`${L}: ${n("FAILED")} failed`);
    if (n("flaky")) problems.push(`${L}: ${n("flaky")} test(s) only passed on a retry (flaky)`);
    const retried = rows.filter((r) => r.attempts > 1 && r.status !== "flaky" && r.status !== "FAILED").length;
    if (retried) problems.push(`${L}: ${retried} test(s) needed more than one attempt`);
    if (data.errors.length) problems.push(`${L}: ${data.errors.length} global error(s) (setup or teardown): ${short((data.errors[0]?.message ?? "").replace(/\u001b\[[0-9;]*m/g, ""), 160)}`);
    if (isNum(data.stats.unexpected) && data.stats.unexpected > 0 && !n("FAILED")) problems.push(`${L}: the run counts ${data.stats.unexpected} unexpected result(s)`);
    const wrong = rows.filter((r) => r.project && r.project !== project).length;
    if (wrong) problems.push(`${L}: ${wrong} result(s) came from another device project (expected "${project}")`);
    const missingSpecs = expectedSpecs.filter((s) => !specFiles.has(s));
    if (rows.length && missingSpecs.length) problems.push(`${L}: ${missingSpecs.length} test file(s) have no results, e.g. ${missingSpecs.slice(0, 3).join(", ")}`);
    // Skips: each needs the run's own reason, and must be a known one for this device.
    for (const x of rows.filter((r) => r.status === "skipped")) {
      const where = `${x.file} › ${x.title}`;
      if (!x.why) {
        problems.push(`${L}: "${short(where, 120)}" was skipped with no reason`);
        continue;
      }
      const known = (Array.isArray(ALLOWED_SKIPS) ? ALLOWED_SKIPS : []).find((a) => a.file === x.file && (a.devices ?? []).includes(label) && x.why.includes(a.reasonIncludes ?? "\u0000"));
      if (!known) problems.push(`${L}: "${short(where, 120)}" was skipped for a reason nobody has accepted: ${short(x.why, 160)}`);
      else {
        x.owner = known.owner;
        x.compensating = known.compensating;
        warnings.push(`${L}: skipped "${short(where, 100)}" because "${short(x.why, 140)}"`);
      }
    }
  }
}

// ---------------------------------------------------------------- write it
add("# Exercise A: results", "");
add(`Run: ${process.env.RUN_URL ?? "(local)"}  `);
add(`Commit: ${EXPECTED_COMMIT || "(unknown)"}  `);
add(`Written: ${new Date().toISOString()}  `);
if (jobs) add(`Jobs: ${jobs}`);
add("");
// A clean run that still has steps not run or tests skipped says so in the verdict line itself (never a bare CLEAN).
const notRunNote = warnings.length ? ` (with ${warnings.length} step${warnings.length === 1 ? "" : "s"} not run, listed below)` : "";
add(problems.length ? `## Verdict: FAILED, ${problems.length} thing(s) to look at` : `## Verdict: CLEAN${notRunNote}, nothing failed and nothing is missing`, "");
for (const p of problems) add(`- ${p}`);
if (problems.length) add("");
if (warnings.length) {
  add("Not failures, but not passes either (each has its reason). These are the steps and tests that did not run:", "");
  for (const w of warnings) add(`- ${w}`);
  add("");
}
add("The test accounts are all `@uat.loopin.test` or `@e2e.loopin.test`; every email stayed in a throwaway database file; nothing live was touched.", "");

add("## UAT: a person tapping through every feature, on each device", "");
add("| Device | Profile | Passed | Failed | Not applicable | Not run | Steps |", "|---|---|---|---|---|---|---|");
for (const p of PROFILES) {
  const c = uat[p].cov;
  add(c ? `| ${p} | ${cell(c.label)} | ${c.totals.passed} | ${c.totals.failed} | ${c.totals.notApplicable} | ${c.totals.notRun} | ${c.totals.steps} |` : `| ${p} | no result | - | - | - | - | - |`);
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

add("### Steps that did not run (never counted as passed)", "");
{
  const rowsNR = PROFILES.flatMap((p) => (uat[p].cov?.steps ?? []).filter((s) => s.status === "skip").map((s) => ({ p, s })));
  if (!rowsNR.length) add("None.", "");
  else {
    add("| Device | Step | Why it did not run |", "|---|---|---|");
    for (const { p, s } of rowsNR) add(`| ${p} | ${short(s.name, 160)} | ${short(String(s.detail ?? "").replace(/^not run:\s*/i, "") || "NO REASON GIVEN", 200)} |`);
    add("");
  }
}

add("### Steps marked \"not applicable\" (only for other devices)", "");
add("These are listed on purpose, never skipped quietly. Each one runs on the devices named.", "");
{
  const seen = new Map();
  for (const p of PROFILES) for (const s of uat[p].cov?.steps ?? []) if (s.status === "na") seen.set(s.name, { runsOn: s.runsOn ?? [], why: String(s.detail ?? ""), on: [...(seen.get(s.name)?.on ?? []), p] });
  if (!seen.size) add("None.", "");
  else {
    add("| Step | Runs on | Not applicable on | Why |", "|---|---|---|---|");
    for (const [name, v] of seen) add(`| ${short(name, 160)} | ${v.runsOn.join(", ")} | ${v.on.join(", ")} | ${short(v.why.replace(/^not applicable on \w+: /, ""), 200)} |`);
    add("");
  }
}

add("### Coverage by area (steps, across the three devices)", "");
const AREAS = ["Money", "Onboarding", "Permissions", "Imports", "Sharing", "Notifications", "Privacy", "Regression"];
add("| Area | " + PROFILES.map((p) => `${p} (pass/fail/n.a./not run)`).join(" | ") + " |", "|---|" + PROFILES.map(() => "---").join("|") + "|");
for (const a of AREAS) {
  add(`| ${a} | ` + PROFILES.map((p) => { const x = uat[p].cov?.areas?.[a]; return x ? `${x.passed}/${x.failed}/${x.notApplicable}/${x.notRun ?? 0}` : "-"; }).join(" | ") + " |");
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
}
{
  // Skip reasons come straight from what each run recorded, never from hand-written text.
  const skips = E2E.flatMap(([label]) => (e2e[label]?.rows ?? []).filter((x) => x.status === "skipped").map((x) => ({ label, ...x })));
  add("### Skipped or blocked tests (the reason is the one the run recorded)", "");
  if (!skips.length) add("None.", "");
  else {
    add("| Device | Test | Reason the run recorded | Owner | What covers it instead |", "|---|---|---|---|---|");
    for (const x of skips) add(`| ${x.label} | ${short(`${x.file} › ${x.title}`, 160)} | ${short(x.why || "NO REASON RECORDED", 200)} | ${short(x.owner ?? "NOBODY", 60)} | ${short(x.compensating ?? "NOTHING LISTED", 200)} |`);
    add("");
  }
}
add("The test that needs a real Splitwise export shows as blocked here on purpose: Exercise A never uses a secret or real data. Real-iPhone checks (drag and swipe gestures, keyboard, back gesture, scroll recovery) are not covered by this run; they stay on the release checklist.", "");

add("## Where everything is", "");
add("- Artifacts of this run: `uat-android`, `uat-iphone`, `uat-desktop` (report.md, coverage.md, coverage.json, screenshots of failures), `unit-junit`, `e2e-report` (open `index.html` in each folder), `e2e-json`, `exercise-a-summary`.");
add("- The same files are saved on the `exercise-a-results` branch.", "");

try {
  writeFileSync(outFile, out.join("\n") + "\n");
} catch (e) {
  problems.push(`The summary file could not be written (${String(e.message).slice(0, 100)})`);
}
console.log(out.slice(0, 12).join("\n"));
console.log(`... written to ${outFile}`);
// Annotations, so the result can be read from the run page without opening any file.
for (const p of problems) console.log(`::error title=Exercise A::${p.replace(/%/g, "%25").replace(/\r?\n/g, "%0A")}`);
for (const w of warnings) console.log(`::warning title=Exercise A (not a pass)::${w.replace(/%/g, "%25").replace(/\r?\n/g, "%0A")}`);
if (problems.length) {
  console.log(`::error title=Exercise A::FAILED with ${problems.length} problem(s); the run must not be handed on.`);
  process.exit(1);
}
console.log(`::notice title=Exercise A::CLEAN${notRunNote}: every job succeeded and every expected result is present.`);
