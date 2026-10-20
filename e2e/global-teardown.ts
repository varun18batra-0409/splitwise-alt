// After all tests: remove this run's test people and their groups.
// Set E2E_KEEP_DATA=1 to keep them for a look (they're cleared next run).
import { runId } from "./env";

export default async function globalTeardown() {
  if (process.env.E2E_KEEP_DATA === "1") return;
  const { cleanUp } = await import("./helpers/db");
  try {
    const r = await cleanUp({ runId });
    console.log(`Tidied up: ${r.groups} test group(s), ${r.accounts} test account(s).`);
  } catch (e) {
    console.warn(`Couldn't tidy up this run's test data (it will be cleared next run): ${(e as Error).message.split("\n")[0]}`);
  }
}
