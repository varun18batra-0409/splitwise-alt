// Soft speed gates for the CI load test. They only WARN (a yellow note on the run); they never fail it.
// Reads screenshots/uat/load.json written by scripts/load.ts.
//   Busy-trip Balances: 1 person, median over 120 ms; 25 at once, 95th percentile over 2.0 s; more than 10 database calls or 2,500 rows read (the same two for the busy trip saved as type trip).
//   Home: 10 at once, 95th percentile over 1.0 s; more than 25 database calls.
import { existsSync, readFileSync } from "node:fs";

const file = "screenshots/uat/load.json";
const warn = (msg) => console.log(`::warning title=Speed target missed::${msg}`);
try {
  if (!existsSync(file)) {
    console.log("::notice title=Speed targets::no load.json (the load test did not finish), so nothing was checked");
  } else {
    const { timing = {}, profile = {} } = JSON.parse(readFileSync(file, "utf8"));
    const bal = "Busy trip: balances";
    const home = "Home";
    let missed = 0;
    const check = (bad, msg) => {
      if (bad) {
        missed++;
        warn(msg);
      }
    };
    const t = (label, users) => timing[label]?.[users];
    if (t(bal, 1)) check(t(bal, 1).median > 120, `Busy-trip Balances, one person: median ${t(bal, 1).median} ms (target 120 ms or less)`);
    if (t(bal, 25)) check(t(bal, 25).p95 > 2000, `Busy-trip Balances, 25 at once: 95th percentile ${t(bal, 25).p95} ms (target 2000 ms or less)`);
    if (t(home, 10)) check(t(home, 10).p95 > 1000, `Home, 10 at once: 95th percentile ${t(home, 10).p95} ms (target 1000 ms or less)`);
    const hq = profile[home]?.queries;
    const bq = profile[bal]?.queries;
    const br = profile[bal]?.rows;
    const trip = "Busy trip (type trip): balances";
    const tq = profile[trip]?.queries;
    const tr = profile[trip]?.rows;
    if (typeof hq === "number") check(hq > 25, `Home makes ${hq} database calls (target 25 or fewer)`);
    if (typeof bq === "number") check(bq > 10, `Busy-trip Balances makes ${bq} database calls (target 10 or fewer)`);
    if (typeof br === "number") check(br > 2500, `Busy-trip Balances reads ${br} rows (target 2,500 or fewer)`);
    if (typeof tq === "number") check(tq > 10, `Busy trip (type trip) Balances makes ${tq} database calls (target 10 or fewer)`);
    if (typeof tr === "number") check(tr > 2500, `Busy trip (type trip) Balances reads ${tr} rows (target 2,500 or fewer)`);
    const fmt = (v) => (typeof v === "number" ? v : "n/a");
    console.log(
      `::notice title=Speed targets::${missed ? `${missed} missed (see warnings)` : "all met"}. Balances: ${fmt(t(bal, 1)?.median)} ms alone, ${fmt(t(bal, 25)?.p95)} ms p95 with 25, ${fmt(bq)} calls, ${fmt(br)} rows (trip type: ${fmt(tq)} calls, ${fmt(tr)} rows). Home: ${fmt(t(home, 10)?.p95)} ms p95 with 10, ${fmt(hq)} calls.`,
    );
  }
} catch (e) {
  console.log(`::notice title=Speed targets::could not check (${String(e).slice(0, 120)})`);
}
process.exit(0);
