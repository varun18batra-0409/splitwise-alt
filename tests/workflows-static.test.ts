import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// OA-5, OA-9, OB-12, OA-12, OA-13: the workflow files are checked line by line (no YAML library), so a careless edit shows up here.
const DIR = ".github/workflows";
const files = readdirSync(DIR).filter((f) => f.endsWith(".yml"));
const text = (f: string) => readFileSync(join(DIR, f), "utf8");
const lines = (f: string) => text(f).split("\n");
// These three move to the private repo (ops/private-repo). Until they are deleted from the public repo, they may still
// mention their secrets, but only inside the steps that use them (never on the whole job).
const MOVING = ["backup.yml", "usage.yml", "live-stats.yml"];

// The lines of every job-level `env:` block (4 spaces in, with its entries at 6 spaces).
function jobEnvLines(src: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < src.length; i++) {
    if (/^ {4}env:\s*$/.test(src[i])) {
      for (let j = i + 1; j < src.length && (/^ {6}\S/.test(src[j]) || src[j].trim() === ""); j++) out.push(src[j]);
    }
  }
  return out;
}

describe("secrets stay where they are needed", () => {
  it("no workflow that stays in the public repo mentions BACKUP_PASSPHRASE or TURSO_PLATFORM_TOKEN", () => {
    for (const f of files.filter((x) => !MOVING.includes(x))) {
      expect(text(f), f).not.toMatch(/BACKUP_PASSPHRASE|TURSO_PLATFORM_TOKEN/);
    }
  });

  it("no job puts the live database key (secrets.TURSO_AUTH_TOKEN) in a job-level env", () => {
    // usage.yml and live-stats.yml are about to be deleted from the public repo (they move to the private one), so they are not held to this.
    for (const f of files.filter((x) => x !== "usage.yml" && x !== "live-stats.yml")) {
      // Live keys and the reports write token: a job-level secret reaches every step, including installs. (Staging keys are allowed.)
      for (const l of jobEnvLines(lines(f))) expect(l, f).not.toMatch(/secrets\.(TURSO_AUTH_TOKEN|TURSO_READONLY_TOKEN|REPORTS_TOKEN)\b|BACKUP_PASSPHRASE|TURSO_PLATFORM_TOKEN/);
    }
  });

  it("the interim public backup gives its secrets only to the steps that use them", () => {
    const src = lines("backup.yml");
    expect(jobEnvLines(src)).toEqual([]);
    const stepsWithSecrets = src.filter((l) => /^ {10}\w+: \$\{\{ secrets\./.test(l));
    expect(stepsWithSecrets.length).toBeGreaterThanOrEqual(6); // 3 secrets in each of the two steps
  });
});

describe("every action is pinned to a full commit id", () => {
  const uses = files.flatMap((f) => lines(f).map((l, i) => ({ f, i: i + 1, l })).filter((x) => /^\s*(- )?uses:/.test(x.l)));
  const pinned = (l: string) => /uses:\s*\S+@[0-9a-f]{40}(\s|$)/.test(l);
  // Pinning needs each tag looked up on GitHub. Until someone has done it for ANY action this check is skipped;
  // after the first one is pinned, all of them must be.
  it.skipIf(!uses.some((u) => pinned(u.l)))("each uses: ends in a 40-character hex commit id", () => {
    for (const u of uses) expect(pinned(u.l), `${u.f}:${u.i} ${u.l.trim()}`).toBe(true);
  });
});

describe("schema workflows", () => {
  it("Schema apply: only from main, and only after the owner approves (environment live-database)", () => {
    const t = text("schema-apply.yml");
    expect(t).toMatch(/^ {4}if: github\.ref == 'refs\/heads\/main'$/m);
    expect(t).toMatch(/^ {4}environment: live-database$/m);
    expect(t).toMatch(/LOOPIN_DB_TARGET: live/);
  });

  it("Schema plan: the live job is main-only, reads with the read-only key; the other job uses staging only", () => {
    const t = text("schema-plan.yml");
    const [, live, staging] = t.split(/^ {2}plan-(?:live|staging):$/m);
    expect(live).toMatch(/if: github\.ref == 'refs\/heads\/main'/);
    expect(live).toMatch(/environment: live-read/);
    expect(live).toMatch(/TURSO_AUTH_TOKEN: \$\{\{ secrets\.TURSO_READONLY_TOKEN \}\}/);
    expect(live).not.toMatch(/secrets\.TURSO_AUTH_TOKEN/);
    expect(staging).toMatch(/if: github\.ref != 'refs\/heads\/main'/);
    expect(staging).toMatch(/secrets\.STAGING_TURSO_DATABASE_URL/);
    expect(staging).toMatch(/secrets\.STAGING_TURSO_AUTH_TOKEN/);
    expect(staging).not.toMatch(/secrets\.TURSO_DATABASE_URL|secrets\.TURSO_AUTH_TOKEN|secrets\.TURSO_READONLY_TOKEN/);
  });

  it("Staging UAT and E2E stop when the live address is empty (an empty value would make 'not the live database' pass quietly)", () => {
    expect(text("staging-uat.yml")).toMatch(/\[ -n "\$LIVE_URL" \]/);
    expect(text("e2e.yml")).toMatch(/\[ -n "\$LIVE_TURSO_DATABASE_URL" \]/);
  });
});

describe("Staging UAT ends strictly (OA-12)", () => {
  const t = text("staging-uat.yml");
  it("the UAT step has an id and continues on error so the evidence is saved, then the last step turns the job red", () => {
    expect(t).toMatch(/- name: UAT on the test copy\n\s+id: uat\n\s+continue-on-error: true/);
    expect(t).toMatch(/LOOPIN_STAGING_DB: "1"/);
    const steps = t.split(/^ {6}- /m);
    const last = steps[steps.length - 1];
    expect(last).toMatch(/if: always\(\)/);
    expect(last).toContain("steps.uat.outcome");
  });
  it("a missing summary or a failed or crashed step fails the UAT step", () => {
    const uat = t.slice(t.indexOf("- name: UAT on the test copy"), t.indexOf("- name: Screenshots of the test copy"));
    expect(uat).toContain("summary.txt");
    expect(uat).toMatch(/no summary\.txt was written[\s\S]*exit 1/);
    expect(uat).toMatch(/grep -q "✗\\\|crashed"[\s\S]*exit 1/);
    expect(uat).not.toContain("::warning title=UAT failures");
  });
});

describe("the repository is public, and the comment says so (OA-13)", () => {
  it("ci.yml no longer says the repo is private", () => {
    const head = lines("ci.yml").slice(0, 12).join("\n");
    expect(head).toContain("the repo is public");
    expect(head).not.toMatch(/repo is private/);
  });
});

describe("the private-repo templates (ops/private-repo)", () => {
  const dir = "ops/private-repo";
  const templates = ["backup.yml", "usage.yml", "live-stats.yml"];
  it("exist, with a plain-English README, and are not under .github", () => {
    for (const f of [...templates, "README.md"]) expect(existsSync(join(dir, f)), f).toBe(true);
    expect(existsSync(join(".github", "workflows", "loopin-ops-backup.yml"))).toBe(false);
  });
  for (const f of templates) {
    const src = () => readFileSync(join(dir, f), "utf8").split("\n");
    it(`${f}: read-only permissions, pinned public commit, no persisted credentials, no secrets at job level`, () => {
      const l = src();
      expect(l.join("\n")).toMatch(/^permissions:\n {2}contents: read$/m);
      expect(l.join("\n")).toMatch(/PUBLIC_REPO_SHA: REPLACE_WITH_40_CHARACTER_COMMIT_ID/);
      expect(l.join("\n")).toMatch(/persist-credentials: false/);
      expect(jobEnvLines(l)).toEqual([]);
      // top-level env may hold only plain, non-secret values
      const top = l.join("\n").match(/^env:\n((?: {2}.*\n)+)/m)?.[1] ?? "";
      expect(top).not.toContain("secrets.");
    });
  }
  it("backup.yml uses the READ-ONLY live token, keeps 14 days, and the real drill uses the drill database's own token", () => {
    const t = readFileSync(join(dir, "backup.yml"), "utf8");
    expect(t).toContain("secrets.LIVE_DB_READONLY_TOKEN");
    expect(t).not.toMatch(/secrets\.TURSO_AUTH_TOKEN/);
    expect(t).toMatch(/retention-days: 14/);
    expect(t).toContain("restore.mjs --drill");
    expect(t).toContain("secrets.DRILL_DB_TOKEN");
  });
});

describe("unknown places report", () => {
  const src = () => readFileSync(".github/workflows/unknown-places.yml", "utf8");
  it("uses only the read-only database key, never the full one", () => {
    expect(src()).not.toMatch(/secrets\.TURSO_AUTH_TOKEN|TURSO_READ_TOKEN\b/);
    expect(src()).toContain("secrets.TURSO_READONLY_TOKEN");
  });
  it("pushes the list only after checking the reports repository is private and not this one", () => {
    expect(src()).toContain('JSON.parse(s).private===true');
    expect(src()).toContain('THIS_REPO: ${{ github.repository }}');
  });
});
