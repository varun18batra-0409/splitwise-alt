// Before any test: check it's safe and reachable, then clear leftovers from
// crashed runs (expired test accounts only, never another run's live data). Fails with a plain message if not.
import { assertSafeTarget, baseURL, bypassHeaders, hosted } from "./env";

export default async function globalSetup() {
  assertSafeTarget();
  let status = 0;
  try {
    const r = await fetch(`${baseURL}/api/health`, { headers: bypassHeaders, redirect: "manual" });
    status = r.status;
  } catch (e) {
    throw new Error(`Can't reach the app at ${baseURL} (${(e as Error).message}). Is the test copy up?`);
  }
  if (status === 401 || status === 403) throw new Error(`The test copy at ${baseURL} refused the tests (${status}). Check VERCEL_AUTOMATION_BYPASS_SECRET.`);
  if (status !== 200 && status !== 429) throw new Error(`The app at ${baseURL} answered ${status} on /api/health.`);
  const { db, cleanUp } = await import("./helpers/db");
  try {
    await db.account.count();
  } catch (e) {
    throw new Error(`Can't open the test database (${(e as Error).message.split("\n")[0]}). Check STAGING_TURSO_DATABASE_URL / STAGING_TURSO_AUTH_TOKEN.`);
  }
  // The throwaway copy on this machine only: start each pass with fresh anti-spam
  // counters (the Android and iPhone passes come from the same machine).
  if (!hosted) await db.rateLimit.deleteMany();
  // Leftovers of crashed runs only: test people older than the expiry age. Newer ones may belong to a run
  // that is still going (AUTO-03), so they are left alone; each run clears its own people in global-teardown.
  // On the hosted copy the age can't be set below an hour (the staging job is limited to 50 minutes).
  const hours = Number(process.env.E2E_STALE_HOURS ?? 6);
  const staleHours = Number.isFinite(hours) && hours > 0 ? hours : 6;
  const old = await cleanUp({ olderThanMs: (hosted ? Math.max(staleHours, 1) : staleHours) * 3_600_000 });
  if (old.accounts) console.log(`Cleared ${old.groups} test group(s) and ${old.accounts} test account(s) left by earlier runs (older than ${staleHours} h).`);
}
