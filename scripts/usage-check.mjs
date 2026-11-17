// Weekly check of Turso usage against the free plan. Fails (so GitHub emails
// the owner) when anything passes 70%, and also when a figure can't be found
// (a check that can't see the numbers must not look like a pass). Needs TURSO_PLATFORM_TOKEN and TURSO_ORG.
// USAGE_CHECK_FIXTURE (tests only) is a JSON file read instead of calling Turso.
import { readFileSync } from "node:fs";
import { readOrgUsage } from "./usage-read.mjs";

const token = process.env.TURSO_PLATFORM_TOKEN, org = process.env.TURSO_ORG;
const fixture = process.env.USAGE_CHECK_FIXTURE;
if (!fixture && (!token || !org)) {
  console.log("::warning title=Usage check skipped::Add TURSO_PLATFORM_TOKEN and TURSO_ORG as repository secrets.");
  process.exit(0);
}
const LIMITS = { rows_read: 500_000_000, rows_written: 10_000_000, storage_bytes: 5 * 1024 ** 3 };
let j;
if (fixture) {
  j = JSON.parse(readFileSync(fixture, "utf8"));
} else {
  const r = await fetch(`https://api.turso.tech/v1/organizations/${encodeURIComponent(org)}/usage`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    console.log(`::error title=Usage check::Turso answered ${r.status}. Check the token.`);
    process.exit(1);
  }
  j = await r.json();
}
const usage = readOrgUsage(j);
if (usage.missing.length) {
  console.log(`::error title=Usage check::Turso's answer has no ${usage.missing.join(", ")} under organization.usage, so the usage is NOT known. The answer's shape may have changed.`);
  process.exit(1);
}
let worst = 0;
const parts = [];
for (const [k, limit] of Object.entries(LIMITS)) {
  const p = Math.round((usage[k] / limit) * 1000) / 10;
  worst = Math.max(worst, p);
  parts.push(`${k.replace("_", " ")}: ${p}%`);
}
console.log(`::notice title=Turso usage::${parts.join(" · ")}`);
if (worst >= 70) {
  console.log(`::error title=Turso usage high::${parts.join(" · ")}. Time to tune or upgrade.`);
  process.exit(1);
}
