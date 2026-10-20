// Where the tests run, and the safety rules around it. Read once by every test.
//
// E2E_BASE_URL   the app to test. Default http://localhost:3000 (a throwaway
//                copy started by the test workflow). For the Vercel test copy
//                the workflow fills this in itself.
// VERCEL_AUTOMATION_BYPASS_SECRET   lets the tests past Vercel's login on the
//                private test copy (only sent to that copy's own address).
// TURSO_DATABASE_URL / TURSO_AUTH_TOKEN   the STAGING database (or a local file):
//                the tests read sign-in codes from it and tidy up their data.
// E2E_SPLITWISE_CSV   path to the Splitwise export for the import test.

export const baseURL = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
export const appHost = new URL(baseURL).host;
export const hosted = baseURL.startsWith("https://");

// Never the live app (or anything that forwards to it).
const LIVE = /(^|\.)loopinapps\.com$|^getloopin\.vercel\.app$|^splitwise-alt-bovz\.vercel\.app$/;
export function assertSafeTarget() {
  if (LIVE.test(appHost)) throw new Error(`Refusing to run tests against the live app (${appHost}). Use the staging test copy.`);
  if (process.env.TURSO_DATABASE_URL && process.env.LIVE_TURSO_DATABASE_URL && process.env.TURSO_DATABASE_URL === process.env.LIVE_TURSO_DATABASE_URL) {
    throw new Error("The test database is the LIVE database. Stopping.");
  }
  if (hosted && !process.env.TURSO_DATABASE_URL) {
    throw new Error("Missing TURSO_DATABASE_URL for the staging database (GitHub secret STAGING_TURSO_DATABASE_URL).");
  }
  if (hosted && !process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    throw new Error("Missing VERCEL_AUTOMATION_BYPASS_SECRET (needed to open the private Vercel test copy).");
  }
}

const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
// Sent only to the test copy's own address; also skips Vercel's preview toolbar.
export const bypassHeaders: Record<string, string> = hosted && secret ? { "x-vercel-protection-bypass": secret, "x-vercel-skip-toolbar": "1" } : {};

// One id per run, so this run's people and groups are easy to find and remove.
export const runId = (process.env.GITHUB_RUN_ID ? `gh${process.env.GITHUB_RUN_ID}` : `local${Date.now().toString(36)}`).slice(0, 20);
export const TEST_DOMAIN = "e2e.loopin.test"; // ".test" never reaches a real inbox
export const testEmail = (who: string) => `e2e-${runId}-${who}@${TEST_DOMAIN}`.toLowerCase();
export const groupName = (what: string) => `E2E ${what} ${runId}`;
