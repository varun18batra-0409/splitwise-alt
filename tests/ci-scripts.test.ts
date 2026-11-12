import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// AUTO-02 (schema workflows keep the real command status) and AUTO-01 (per-project browser evidence).
// Both are tiny scripts the workflows call, so they can be proven here with stubs and no network.

function schema(mode: "apply" | "plan", opts: { apply?: number; plan?: number; target?: string; noTarget?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lp-schema-"));
  const stub = join(dir, "stub.sh");
  // Pretends to be turso-sync: exits with the chosen status, and prints a line so the log has something.
  writeFileSync(stub, `#!/usr/bin/env bash\nif [ "\${1:-}" = "--plan" ]; then echo "plan output"; exit ${opts.plan ?? 0}; fi\necho "apply output"; exit ${opts.apply ?? 0}\n`, { mode: 0o755 });
  const env = {
    PATH: process.env.PATH,
    SCHEMA_SYNC_CMD: `bash ${stub}`,
    SCHEMA_LOG: join(dir, "plan.log"),
    SCHEMA_RESULT: join(dir, "schema-result.env"),
    TURSO_DATABASE_URL: opts.target ?? "libsql://stub-not-real.invalid",
    NO_TARGET: opts.noTarget ?? "skip",
  } as NodeJS.ProcessEnv;
  const ran = spawnSync("bash", ["scripts/schema-run.sh", "run", mode], { cwd: process.cwd(), env, encoding: "utf8" });
  const verdict = spawnSync("bash", ["scripts/schema-run.sh", "verdict"], { cwd: process.cwd(), env, encoding: "utf8" });
  return { runCode: ran.status, code: verdict.status, out: verdict.stdout + verdict.stderr, log: existsSync(env.SCHEMA_LOG!) ? readFileSync(env.SCHEMA_LOG!, "utf8") : "" };
}

describe("schema workflows keep the real command status", () => {
  it("a valid add-only apply and a no-op plan pass", () => {
    const r = schema("apply");
    expect(r.runCode).toBe(0);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("::notice title=Schema apply::OK: apply=0 plan=0");
  });

  it("apply failing (exit 7) fails the job, and the log is still kept", () => {
    const r = schema("apply", { apply: 7 });
    expect(r.runCode).toBe(0); // the run step itself never hides the status: the verdict step decides
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("::error title=Schema apply FAILED::apply exited 7");
    expect(r.log).toContain("apply output");
    expect(r.log).toContain("exit: 7");
  });

  it("plan failing (exit 9) fails the job, in apply and in plan-only runs", () => {
    const a = schema("apply", { plan: 9 });
    expect(a.code, a.out).toBe(1);
    expect(a.out).toContain("plan exited 9");
    const p = schema("plan", { plan: 9 });
    expect(p.code, p.out).toBe(1);
    expect(p.out).toContain("::error title=Schema plan FAILED::plan exited 9");
    expect(p.log).toContain("plan output");
  });

  it("both failing reports both", () => {
    const r = schema("apply", { apply: 7, plan: 9 });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("apply exited 7; plan exited 9");
  });

  it("no target is reported as SKIPPED (a warning, not a success) for the plan, and a failure for a hand-run apply", () => {
    const skipped = schema("plan", { target: "", noTarget: "skip" });
    expect(skipped.code, skipped.out).toBe(0);
    expect(skipped.out).toContain("::warning title=Schema plan SKIPPED::");
    expect(skipped.out).toContain("NOT a successful plan");
    expect(skipped.out).not.toContain("::notice title=Schema plan::OK");
    const failed = schema("apply", { target: "", noTarget: "fail" });
    expect(failed.code, failed.out).toBe(1);
    expect(failed.out).toContain("no database target is set");
  });

  it("the verdict fails when nothing was recorded (an earlier step stopped)", () => {
    const dir = mkdtempSync(join(tmpdir(), "lp-schema-"));
    const r = spawnSync("bash", ["scripts/schema-run.sh", "verdict"], { cwd: process.cwd(), env: { PATH: process.env.PATH, SCHEMA_RESULT: join(dir, "none.env"), SCHEMA_LOG: join(dir, "none.log") } as NodeJS.ProcessEnv, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("nothing was recorded");
  });
});

function projects(data: unknown, ...names: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "lp-proj-"));
  const f = join(dir, "results.json");
  writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data));
  const r = spawnSync("node", ["scripts/e2e-projects-check.mjs", f, ...names], { cwd: process.cwd(), encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}
const test = (projectName: string, status: string) => ({ projectName, results: [{ status }] });
const report = (...tests: ReturnType<typeof test>[]) => ({ suites: [{ title: "a.spec.ts", specs: [{ title: "x", tests }] }] });

describe("staging E2E proves both browser projects ran", () => {
  it("passes when phone and iphone each ran something", () => {
    const r = projects(report(test("phone", "passed"), test("iphone", "passed"), test("iphone", "skipped")), "phone", "iphone");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("Browser project iphone::1 test(s) ran, 1 skipped");
  });

  it("fails when the iPhone project is missing, only skipped, or the file is bad", () => {
    expect(projects(report(test("phone", "passed")), "phone", "iphone").out).toContain('project "iphone" has no tests in the report');
    expect(projects(report(test("phone", "passed"), test("iphone", "skipped")), "phone", "iphone").out).toContain('project "iphone" ran nothing');
    expect(projects("not json", "phone", "iphone").code).toBe(1);
    expect(projects({ nope: 1 }, "phone").code).toBe(1);
    expect(projects(report(test("phone", "passed"), test("desktop", "passed")), "phone").out).toContain('unexpected project "desktop"');
  });
});
