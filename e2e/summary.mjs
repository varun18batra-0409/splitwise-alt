// Turns Playwright's results.json into a short plain-English summary
// (printed, and shown on the GitHub run page). Exits 1 if anything failed.
import { readFileSync, appendFileSync } from "node:fs";

const file = process.argv[2] ?? "e2e-results/results.json";
let data;
try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch {
  console.log("No test results were written (the run stopped before the tests started; see the step above).");
  process.exit(1);
}
const rows = [];
const walk = (suite, path = []) => {
  for (const s of suite.suites ?? []) walk(s, [...path, s.title].filter(Boolean));
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const r = t.results?.[t.results.length - 1];
      const status = t.status === "expected" ? (r?.status === "skipped" ? "blocked/skipped" : t.expectedStatus === "failed" ? "passed (failed as expected)" : "passed") : t.status === "skipped" ? "blocked/skipped" : t.status === "flaky" ? "flaky" : "FAILED";
      const why = r?.status === "skipped" ? (t.annotations ?? []).map((a) => a.description).filter(Boolean).join("; ") : r?.error?.message?.split("\n")[0] ?? "";
      rows.push({ file: path[0] ?? "", title: spec.title, status, why: status === "passed" || status.startsWith("passed (") ? "" : why.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 200) });
    }
  }
};
walk(data);
const count = (s) => rows.filter((r) => r.status.startsWith(s)).length;
const head = `E2E: ${count("passed")} passed · ${count("FAILED")} failed · ${count("blocked")} blocked/skipped · ${count("flaky")} flaky`;
const table = ["| Result | Test | Note |", "|---|---|---|", ...rows.map((r) => `| ${r.status} | ${r.file} › ${r.title} | ${r.why.replace(/\|/g, "/")} |`)].join("\n");
console.log(head + "\n" + rows.map((r) => `- ${r.status}: ${r.file} › ${r.title}${r.why ? ` (${r.why})` : ""}`).join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${head}\n\n${table}\n`);
// Also as notes on the run (readable without opening the logs).
if (process.env.GITHUB_ACTIONS) {
  const esc = (t) => t.replace(/%/g, "%25").replace(/\r?\n/g, "%0A");
  console.log(`::notice title=E2E result::${esc(head + "\n" + rows.map((r) => `${r.status}: ${r.file} › ${r.title}${r.why ? ` (${r.why})` : ""}`).join("\n"))}`);
}
process.exit(count("FAILED") ? 1 : 0);
