// Weekly check of Turso usage against the free plan. Fails (so GitHub emails
// the owner) when anything passes 70%. Needs TURSO_PLATFORM_TOKEN and TURSO_ORG.
const token = process.env.TURSO_PLATFORM_TOKEN, org = process.env.TURSO_ORG;
if (!token || !org) {
  console.log("::warning title=Usage check skipped::Add TURSO_PLATFORM_TOKEN and TURSO_ORG as repository secrets.");
  process.exit(0);
}
const LIMITS = { rows_read: 500_000_000, rows_written: 10_000_000, storage_bytes: 5 * 1024 ** 3 };
const find = (o, k) => {
  if (!o || typeof o !== "object") return null;
  for (const [kk, v] of Object.entries(o)) {
    if (kk === k && typeof v === "number") return v;
    const x = find(v, k);
    if (x !== null) return x;
  }
  return null;
};
const r = await fetch(`https://api.turso.tech/v1/organizations/${encodeURIComponent(org)}/usage`, { headers: { Authorization: `Bearer ${token}` } });
if (!r.ok) {
  console.log(`::error title=Usage check::Turso answered ${r.status}. Check the token.`);
  process.exit(1);
}
const j = await r.json();
let worst = 0;
const parts = [];
for (const [k, limit] of Object.entries(LIMITS)) {
  const used = find(j, k);
  if (used === null) continue;
  const p = Math.round((used / limit) * 1000) / 10;
  worst = Math.max(worst, p);
  parts.push(`${k.replace("_", " ")}: ${p}%`);
}
console.log(`::notice title=Turso usage::${parts.join(" · ") || "no figures returned"}`);
if (worst >= 70) {
  console.log(`::error title=Turso usage high::${parts.join(" · ")}. Time to tune or upgrade.`);
  process.exit(1);
}
