import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// TEST-01: the Exercise A summary must fail closed. A clean, exact-head fixture passes;
// every kind of missing, broken or unexplained evidence must exit non-zero and never print CLEAN.
// (Evidence tooling only: it runs scripts/exercise-a-summary.mjs on small made-up result folders.)

const COMMIT = "a".repeat(40);
const PROFILES = ["android", "iphone", "desktop"] as const;
const SPECS = ["01-start.spec.ts", "05-splitwise-import.spec.ts", "10-auth.spec.ts", "38-gestures.spec.ts"];
const UNIT_FILES = ["tests/money.test.ts", "tests/backup.test.ts"];
const STEP_NAMES = ["Add a dinner", "Settle up", "Undo a payment"];

type Fx = { root: string; results: string; repo: string };
const put = (f: string, data: unknown) => {
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 2));
};

function uatCoverage(p: string, over: { steps?: unknown[]; profile?: string } = {}) {
  const steps =
    (over.steps as { n: number; name: string; status: string; detail: string; runsOn: string[] }[]) ??
    STEP_NAMES.map((name, i) => ({ n: i + 1, area: "Settle", coverage: "Money", name, status: "pass", detail: "", runsOn: [...PROFILES] }));
  const c = (s: string) => steps.filter((x) => x.status === s).length;
  return {
    profile: over.profile ?? p,
    label: `${p} phone`,
    totals: { steps: steps.length, passed: c("pass"), failed: c("fail"), notApplicable: c("na"), notRun: c("skip") },
    areas: { Money: { steps: steps.length, passed: c("pass"), failed: c("fail"), notApplicable: c("na"), notRun: c("skip") } },
    thinAreas: [],
    steps,
  };
}

function e2eResults(project: string, over: { tests?: { file: string; title: string; status: string; reason?: string; attempts?: number }[]; errors?: unknown[] } = {}) {
  const tests =
    over.tests ??
    SPECS.map((file) => ({ file, title: `test in ${file}`, status: "passed" as string, reason: undefined as string | undefined }));
  const suites = SPECS.map((file) => ({
    title: file,
    file,
    suites: [],
    specs: tests
      .filter((t) => t.file === file)
      .map((t) => ({
        title: t.title,
        tests: [
          {
            projectName: project,
            status: t.status === "skipped" ? "skipped" : t.status === "flaky" ? "flaky" : t.status === "failed" ? "unexpected" : "expected",
            annotations: t.reason ? [{ type: "skip", description: t.reason }] : [],
            results: Array.from({ length: t.attempts ?? 1 }, (_, i) => ({ status: t.status === "skipped" ? "skipped" : t.status === "failed" || (t.status === "flaky" && i < (t.attempts ?? 1) - 1) ? "failed" : "passed", error: undefined })),
          },
        ],
      })),
  }));
  return { config: {}, suites, errors: over.errors ?? [], stats: { expected: tests.length, unexpected: 0, flaky: 0, skipped: 0 } };
}

const junit = (files: string[], extra = "") =>
  `<?xml version="1.0"?>\n<testsuites name="vitest tests" tests="${files.length}" failures="0" errors="0">\n${files
    .map((f) => `<testsuite name="${f}" tests="1"><testcase classname="${f}" name="works"/>${extra}</testsuite>`)
    .join("\n")}\n</testsuites>\n`;

// A complete, clean, exact-head set of results plus a checkout to take the expected inventory from.
function makeFixture(): Fx {
  const root = mkdtempSync(join(tmpdir(), "lp-exa-"));
  const results = join(root, "results");
  const repo = join(root, "repo");
  for (const f of SPECS) put(join(repo, "e2e", "tests", f), "// spec");
  for (const f of UNIT_FILES) put(join(repo, f), "// test");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  copyFileSync(join(process.cwd(), "scripts", "exercise-a-expected-skips.json"), join(repo, "scripts", "exercise-a-expected-skips.json"));
  for (const p of PROFILES) {
    put(join(results, `uat-${p}`, "coverage.json"), uatCoverage(p));
    put(join(results, `uat-${p}`, "meta.json"), { commit: COMMIT, profile: p });
    put(join(results, `uat-${p}`, "summary.txt"), "3 passed, 0 failed, 0 not applicable");
  }
  put(join(results, "unit-junit", "vitest-junit.xml"), junit(UNIT_FILES));
  put(join(results, "unit-junit", "meta.json"), { commit: COMMIT });
  put(join(results, "e2e-json", "e2e-meta.json"), { commit: COMMIT });
  const dirs = { phone: "e2e-results", iphone: "e2e-results-ios", desktop: "e2e-results-desktop" } as const;
  for (const [project, d] of Object.entries(dirs)) {
    const tests = SPECS.map((file) => {
      if (file === "05-splitwise-import.spec.ts") return { file, title: "real file", status: "skipped", reason: "BLOCKED: the Splitwise CSV wasn't supplied (secret E2E_SPLITWISE_CSV_B64 / E2E_SPLITWISE_CSV)." };
      if (file === "38-gestures.spec.ts" && project === "iphone") return { file, title: "Gestures", status: "skipped", reason: "Touch drags are built with Chrome's Touch objects (checked on Android)." };
      return { file, title: `test in ${file}`, status: "passed" };
    });
    put(join(results, "e2e-json", d, "results.json"), e2eResults(project, { tests }));
  }
  return { root, results, repo };
}

type Env = Record<string, string | undefined>;
function run(fx: Fx, env: Env = {}) {
  const summary = join(fx.root, "summary.md");
  const r = spawnSync("node", ["scripts/exercise-a-summary.mjs", fx.results, summary], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH, COMMIT, JOBS: "uat=success unit=success e2e=success", REPO_ROOT: fx.repo, ...env } as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  let file = "";
  try {
    file = readFileSync(summary, "utf8");
  } catch {
    /* not written */
  }
  return { code: r.status, stdout: r.stdout + r.stderr, file };
}

// The run must fail, say why, and never claim CLEAN anywhere (printout, annotations or the file).
function expectBlocked(fx: Fx, why: RegExp, env: Env = {}) {
  const r = run(fx, env);
  expect(r.code, r.stdout).not.toBe(0);
  expect(r.stdout + r.file).toMatch(why);
  expect(r.stdout).not.toMatch(/CLEAN/);
  expect(r.file).not.toMatch(/CLEAN/);
  expect(r.file).toMatch(/Verdict: FAILED/);
  return r;
}

const edit = (f: string, fn: (d: any) => unknown) => put(f, fn(JSON.parse(readFileSync(f, "utf8"))));

describe("Exercise A summary fails closed", () => {
  it("passes a complete, clean fixture for the exact commit", () => {
    const fx = makeFixture();
    const r = run(fx);
    expect(r.code, r.stdout).toBe(0);
    expect(r.file).toMatch(/## Verdict: CLEAN/);
    // The skip table shows the reasons the run itself recorded, plus device, owner and what covers it.
    expect(r.file).toContain("Touch drags are built with Chrome's Touch objects");
    expect(r.file).toMatch(/iPhone \| 38-gestures\.spec\.ts/);
    expect(r.file).toContain("founder (release checklist)");
    rmSync(fx.root, { recursive: true });
  });

  it("blocks a failed job even when every artifact looks fine", () => {
    const fx = makeFixture();
    expectBlocked(fx, /Job "e2e" ended as failure/, { JOBS: "uat=success unit=success e2e=failure" });
  });

  it("blocks cancelled and skipped jobs", () => {
    const fx = makeFixture();
    expectBlocked(fx, /Job "uat" ended as cancelled/, { JOBS: "uat=cancelled unit=success e2e=success" });
    expectBlocked(fx, /Job "unit" ended as skipped/, { JOBS: "uat=success unit=skipped e2e=success" });
  });

  it("blocks a job that is missing from the list, and an empty list", () => {
    const fx = makeFixture();
    expectBlocked(fx, /Job "e2e": its result is missing/, { JOBS: "uat=success unit=success" });
    expectBlocked(fx, /Job "uat": its result is missing/, { JOBS: "" });
  });

  it("blocks empty results (nothing downloaded)", () => {
    const fx = makeFixture();
    rmSync(fx.results, { recursive: true });
    mkdirSync(fx.results);
    const r = expectBlocked(fx, /no result was written/);
    expect(r.stdout).toMatch(/no JUnit report/);
    expect(r.stdout).toMatch(/End-to-end Android: no result file|no result file/);
  });

  it("blocks a missing step (one device ran fewer steps than the others)", () => {
    const fx = makeFixture();
    // Totals stay consistent with the shorter list, so only the cross-device comparison can catch it.
    put(join(fx.results, "uat-iphone", "coverage.json"), uatCoverage("iphone", { steps: STEP_NAMES.slice(0, 2).map((name, i) => ({ n: i + 1, area: "Settle", coverage: "Money", name, status: "pass", detail: "", runsOn: [...PROFILES] })) }));
    expectBlocked(fx, /UAT iphone: 1 step\(s\) other devices ran are missing, e\.g\. "Undo a payment"/);
  });

  it("blocks a skip with no reason, and counts a skip with a reason as not run (never passed)", () => {
    const fx = makeFixture();
    const noReason = STEP_NAMES.map((name, i) => ({ n: i + 1, area: "Settle", coverage: "Money", name, status: i === 2 ? "skip" : "pass", detail: i === 2 ? "" : "", runsOn: [...PROFILES] }));
    put(join(fx.results, "uat-android", "coverage.json"), uatCoverage("android", { steps: noReason }));
    expectBlocked(fx, /UAT android: step "Undo a payment" was skipped with no reason/);

    const withReason = STEP_NAMES.map((name, i) => ({ n: i + 1, area: "Settle", coverage: "Money", name, status: i === 2 ? "skip" : "pass", detail: i === 2 ? "not run: nothing left to pay" : "", runsOn: [...PROFILES] }));
    put(join(fx.results, "uat-android", "coverage.json"), uatCoverage("android", { steps: withReason }));
    const r = run(fx);
    expect(r.code, r.stdout).toBe(0);
    expect(r.file).toContain("NOT RUN");
    expect(r.file).toContain("nothing left to pay");
    // android: 2 passed (not 3), 1 not run
    expect(r.file).toMatch(/\| android \| android phone \| 2 \| 0 \| 0 \| 1 \| 3 \|/);
  });

  it("blocks a missing profile", () => {
    const fx = makeFixture();
    rmSync(join(fx.results, "uat-iphone"), { recursive: true });
    expectBlocked(fx, /UAT iphone: no result was written/);
  });

  it("blocks corrupt JSON and corrupt reports", () => {
    const fx = makeFixture();
    writeFileSync(join(fx.results, "uat-desktop", "coverage.json"), "{ not json");
    expectBlocked(fx, /UAT desktop: the result file is corrupt JSON/);
    const fy = makeFixture();
    writeFileSync(join(fy.results, "e2e-json", "e2e-results-ios", "results.json"), "garbage");
    expectBlocked(fy, /End-to-end iPhone: the result file is corrupt JSON/);
    const fz = makeFixture();
    writeFileSync(join(fz.results, "unit-junit", "vitest-junit.xml"), "<testsuites><testsuite>");
    expectBlocked(fz, /JUnit report is corrupt or cut short/);
  });

  it("blocks results for the wrong commit, and results with no commit stamp", () => {
    const fx = makeFixture();
    put(join(fx.results, "uat-android", "meta.json"), { commit: "b".repeat(40), profile: "android" });
    expectBlocked(fx, /UAT android: results are for commit bbbbbbb, not aaaaaaa/);
    const fy = makeFixture();
    rmSync(join(fy.results, "e2e-json", "e2e-meta.json"));
    expectBlocked(fy, /End-to-end: no commit stamp/);
    const fz = makeFixture();
    expectBlocked(fz, /No expected commit was given/, { COMMIT: "" });
  });

  it("blocks a stamp for another profile", () => {
    const fx = makeFixture();
    put(join(fx.results, "uat-iphone", "meta.json"), { commit: COMMIT, profile: "android" });
    expectBlocked(fx, /UAT iphone: the stamp says profile "android"/);
  });

  it("blocks zero UAT steps and zero passes", () => {
    const fx = makeFixture();
    put(join(fx.results, "uat-android", "coverage.json"), uatCoverage("android", { steps: [] }));
    expectBlocked(fx, /UAT android: no steps were recorded/);
  });

  it("blocks UAT totals that do not match the steps", () => {
    const fx = makeFixture();
    edit(join(fx.results, "uat-android", "coverage.json"), (d) => ({ ...d, totals: { ...d.totals, passed: 99 } }));
    expectBlocked(fx, /UAT android: the totals do not match the steps/);
  });

  it("blocks a failed UAT step, a crash, and a missing failure screenshot", () => {
    const fx = makeFixture();
    const steps = STEP_NAMES.map((name, i) => ({ n: i + 1, area: "Settle", coverage: "Money", name, status: i === 1 ? "fail" : "pass", detail: i === 1 ? "boom (screenshot: fail-01.png)" : "", runsOn: [...PROFILES] }));
    put(join(fx.results, "uat-android", "coverage.json"), uatCoverage("android", { steps }));
    put(join(fx.results, "uat-android", "summary.txt"), "crashed: x");
    const r = expectBlocked(fx, /UAT android: 1 step\(s\) failed/);
    expect(r.stdout).toMatch(/the run crashed part-way/);
    expect(r.stdout).toMatch(/screenshot of failed step 2 \(fail-01\.png\) is missing/);
  });

  it("blocks a step marked not applicable on a device it should run on", () => {
    const fx = makeFixture();
    const steps = STEP_NAMES.map((name, i) => ({ n: i + 1, area: "Settle", coverage: "Money", name, status: i === 0 ? "na" : "pass", detail: "n/a", runsOn: [...PROFILES] }));
    put(join(fx.results, "uat-desktop", "coverage.json"), uatCoverage("desktop", { steps }));
    expectBlocked(fx, /meant to run here/);
  });

  it("blocks all-skipped end-to-end results", () => {
    const fx = makeFixture();
    const tests = SPECS.map((file) => ({ file, title: "t", status: "skipped", reason: "BLOCKED: the Splitwise CSV wasn't supplied" }));
    put(join(fx.results, "e2e-json", "e2e-results", "results.json"), e2eResults("phone", { tests }));
    expectBlocked(fx, /End-to-end Android: not one test passed/);
  });

  it("blocks an end-to-end skip with no recorded reason, and one nobody accepted", () => {
    const fx = makeFixture();
    const mk = (reason?: string) => SPECS.map((file) => (file === "38-gestures.spec.ts" ? { file, title: "g", status: "skipped", reason } : { file, title: `t ${file}`, status: "passed" }));
    put(join(fx.results, "e2e-json", "e2e-results", "results.json"), e2eResults("phone", { tests: mk(undefined) }));
    expectBlocked(fx, /End-to-end Android: "38-gestures\.spec\.ts › g" was skipped with no reason/);
    put(join(fx.results, "e2e-json", "e2e-results", "results.json"), e2eResults("phone", { tests: mk("hosted copy only") }));
    expectBlocked(fx, /skipped for a reason nobody has accepted: hosted copy only/);
  });

  it("blocks a global Playwright teardown error", () => {
    const fx = makeFixture();
    put(join(fx.results, "e2e-json", "e2e-results-desktop", "results.json"), e2eResults("desktop", { errors: [{ message: "Error in global teardown" }] }));
    // keep the fixture's own skips out of the way: desktop has none to explain
    expectBlocked(fx, /End-to-end Desktop: 1 global error\(s\)/);
  });

  it("blocks flaky and retried end-to-end tests", () => {
    const fx = makeFixture();
    const tests = SPECS.map((file) => (file === "01-start.spec.ts" ? { file, title: "flaky one", status: "flaky", attempts: 2 } : file === "05-splitwise-import.spec.ts" ? { file, title: "real file", status: "skipped", reason: "BLOCKED: the Splitwise CSV wasn't supplied" } : { file, title: `t ${file}`, status: "passed" }));
    put(join(fx.results, "e2e-json", "e2e-results", "results.json"), e2eResults("phone", { tests }));
    expectBlocked(fx, /End-to-end Android: 1 test\(s\) only passed on a retry/);
  });

  it("blocks end-to-end results with a test file missing, or from the wrong device", () => {
    const fx = makeFixture();
    const tests = SPECS.filter((f) => f !== "10-auth.spec.ts").map((file) => (file === "05-splitwise-import.spec.ts" ? { file, title: "real file", status: "skipped", reason: "BLOCKED: the Splitwise CSV wasn't supplied" } : { file, title: `t ${file}`, status: "passed" }));
    const data = e2eResults("phone", { tests });
    data.suites = data.suites.filter((s) => s.file !== "10-auth.spec.ts");
    put(join(fx.results, "e2e-json", "e2e-results", "results.json"), data);
    expectBlocked(fx, /End-to-end Android: 1 test file\(s\) have no results, e\.g\. 10-auth\.spec\.ts/);
    const fy = makeFixture();
    // An iPhone result file that is really the Android run copied over.
    copyFileSync(join(fy.results, "e2e-json", "e2e-results", "results.json"), join(fy.results, "e2e-json", "e2e-results-ios", "results.json"));
    expectBlocked(fy, /End-to-end iPhone: \d+ result\(s\) came from another device project/);
  });

  it("blocks a failed end-to-end test and an end-to-end file in the wrong format", () => {
    const fx = makeFixture();
    const tests = SPECS.map((file) => (file === "01-start.spec.ts" ? { file, title: "broken", status: "failed" } : file === "05-splitwise-import.spec.ts" ? { file, title: "real file", status: "skipped", reason: "BLOCKED: the Splitwise CSV wasn't supplied" } : { file, title: `t ${file}`, status: "passed" }));
    put(join(fx.results, "e2e-json", "e2e-results", "results.json"), e2eResults("phone", { tests }));
    expectBlocked(fx, /End-to-end Android: 1 failed/);
    const fy = makeFixture();
    put(join(fy.results, "e2e-json", "e2e-results", "results.json"), { suites: [] });
    expectBlocked(fy, /End-to-end Android: the result file is not in the expected format/);
  });

  it("blocks skipped unit tests, failed unit tests, and test files with no results", () => {
    const fx = makeFixture();
    put(join(fx.results, "unit-junit", "vitest-junit.xml"), junit(UNIT_FILES, '<testcase classname="tests/money.test.ts" name="later"><skipped/></testcase>'));
    expectBlocked(fx, /Unit tests: 2 test\(s\) were skipped/);
    const fy = makeFixture();
    put(join(fy.results, "unit-junit", "vitest-junit.xml"), junit(UNIT_FILES.slice(0, 1)));
    expectBlocked(fy, /Unit tests: 1 test file\(s\) have no results, e\.g\. tests\/backup\.test\.ts/);
    const fz = makeFixture();
    put(join(fz.results, "unit-junit", "vitest-junit.xml"), junit(UNIT_FILES, '<testcase classname="tests/money.test.ts" name="bad"><failure message="expected 1 to be 2"/></testcase>'));
    expectBlocked(fz, /Unit tests: 2 failed/);
    const fw = makeFixture();
    put(join(fw.results, "unit-junit", "vitest-junit.xml"), '<?xml version="1.0"?><testsuites tests="0"></testsuites>');
    expectBlocked(fw, /the JUnit report has no tests in it/);
  });

  it("blocks when the expected inventory itself cannot be found", () => {
    const fx = makeFixture();
    rmSync(join(fx.repo, "e2e"), { recursive: true });
    expectBlocked(fx, /no expected spec files found/);
  });
});
