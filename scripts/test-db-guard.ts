// Safety guard for the test and demo scripts (OB-10). Import it FIRST in any script that touches the database
// (import "./test-db-guard"), so it runs before the database module is even loaded.
//
// These scripts write fake people, rates and expenses and delete rate limits. They must never run against the live database.
// Allowed:
//   - no TURSO_DATABASE_URL at all (the local file), or a URL starting with "file:" (a throwaway file);
//   - an online database ONLY when all three are true: LOOPIN_STAGING_DB=1 (the staging workflow says so),
//     the live address is known (LIVE_URL or LIVE_TURSO_DATABASE_URL), and it is different from this one.
// Anything else stops with exit 1. The message never contains the address.

import { checkTestDb } from "./test-db-rule";

const verdict = checkTestDb(process.env);
if (!verdict.ok) {
  console.error(`Refusing to run a test or demo script: ${verdict.reason}. Use a file: database, or the staging database from the staging workflow.`);
  process.exit(1);
}
