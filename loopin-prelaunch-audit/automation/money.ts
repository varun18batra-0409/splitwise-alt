// Financial correctness: runs Loopin's own money code (split, balances, settle,
// currency conversion, parsing, formatting) against answers worked out by hand
// in this file. No database, no network.
import { writeFileSync, mkdirSync } from "node:fs";
import { netBalances } from "../../src/lib/balances";
import { smartSettle } from "../../src/lib/settle";
import { splitEqual, splitExact, splitPercent, splitShares } from "../../src/lib/split";
import { convertAmount, markupAmountOf } from "../../src/lib/conversion";
import { formatMoney, parseAmount } from "../../src/lib/money";
import { splitByItems } from "../../src/lib/item-split";
import { computeSplit } from "../../src/lib/split";
import { passportMarks } from "../../src/lib/passport";

type R = { id: string; scenario: string; expected: string; actual: string; pass: boolean };
const out: R[] = [];
const check = (id: string, scenario: string, expected: unknown, actual: unknown) => {
  const e = JSON.stringify(expected), a = JSON.stringify(actual);
  out.push({ id, scenario, expected: e, actual: a, pass: e === a });
};
const shares = (r: ReturnType<typeof splitEqual>) => (r.ok ? Object.fromEntries(r.shares.map((s) => [s.memberId, s.amount])) : { error: r.error });
const exp = (paidById: string, amount: number, sh: Record<string, number>, extra: { payers?: string; kind?: string } = {}) => ({ paidById, amount, shares: Object.entries(sh).map(([memberId, a]) => ({ memberId, amount: a })), ...extra });
const ABCD = ["A", "B", "C", "D"];

// FIN-01: ₹4,000 dinner, 4 people, A paid. Each owes ₹1,000; A is owed ₹3,000.
{
  const s = splitEqual(400000, ABCD);
  check("FIN-01a", "₹4,000 split equally between 4", { A: 100000, B: 100000, C: 100000, D: 100000 }, shares(s));
  const net = netBalances(ABCD, [exp("A", 400000, shares(s) as Record<string, number>)]);
  check("FIN-01b", "Balances after ₹4,000 paid by A", { A: 300000, B: -100000, C: -100000, D: -100000 }, net);
  check("FIN-01c", "Settle up for FIN-01", [{ from: "B", to: "A", amount: 100000 }, { from: "C", to: "A", amount: 100000 }, { from: "D", to: "A", amount: 100000 }], smartSettle(net));
  const after = netBalances(ABCD, [exp("A", 400000, shares(s) as Record<string, number>)], smartSettle(net).map((t) => ({ fromId: t.from, toId: t.to, amount: t.amount })));
  check("FIN-01d", "Everyone square after the 3 settle-up payments", { A: 0, B: 0, C: 0, D: 0 }, after);
}
// FIN-02: ₹100 between 3: 33.34 / 33.33 / 33.33, totals exact.
check("FIN-02", "₹100 split equally between 3 (rounding)", { A: 3334, B: 3333, C: 3333 }, shares(splitEqual(10000, ["A", "B", "C"])));
// FIN-03: ₹10 between 3 then settle: nobody left with a paisa.
{
  const s = shares(splitEqual(1000, ["A", "B", "C"])) as Record<string, number>;
  const net = netBalances(["A", "B", "C"], [exp("C", 1000, s)]);
  check("FIN-03a", "₹10 paid by C, equal 3", { A: -334, B: -333, C: 667 }, net);
  const pay = smartSettle(net).map((t) => ({ fromId: t.from, toId: t.to, amount: t.amount }));
  check("FIN-03b", "Square after settle (₹10/3)", { A: 0, B: 0, C: 0 }, netBalances(["A", "B", "C"], [exp("C", 1000, s)], pay));
}
// FIN-04: two payers. ₹3,000 dinner, A paid ₹2,000 and B ₹1,000, split equally A/B/C.
{
  const e = exp("A", 300000, { A: 100000, B: 100000, C: 100000 }, { payers: JSON.stringify([{ m: "A", a: 200000 }, { m: "B", a: 100000 }]) });
  check("FIN-04", "Two payers (A ₹2,000, B ₹1,000), equal 3", { A: 100000, B: 0, C: -100000 }, netBalances(["A", "B", "C"], [e]));
}
// FIN-05: exact amounts ₹2,500 paid by C: A 1,000, B 500, C 1,000.
{
  const s = splitExact(250000, [{ memberId: "A", amount: 100000 }, { memberId: "B", amount: 50000 }, { memberId: "C", amount: 100000 }]);
  check("FIN-05a", "Exact split ₹2,500 (1,000/500/1,000)", { A: 100000, B: 50000, C: 100000 }, shares(s));
  check("FIN-05b", "Balances for FIN-05 (C paid)", { A: -100000, B: -50000, C: 150000 }, netBalances(["A", "B", "C"], [exp("C", 250000, shares(s) as Record<string, number>)]));
  check("FIN-05c", "Exact split that doesn't add up is refused", false, splitExact(250000, [{ memberId: "A", amount: 100000 }, { memberId: "B", amount: 50000 }]).ok);
}
// FIN-06: percentages 40/35/25 of ₹1,000.
check("FIN-06a", "40% / 35% / 25% of ₹1,000", { A: 40000, B: 35000, C: 25000 }, shares(splitPercent(100000, [{ memberId: "A", basisPoints: 4000 }, { memberId: "B", basisPoints: 3500 }, { memberId: "C", basisPoints: 2500 }])));
check("FIN-06b", "Percentages adding to 90% are refused", false, splitPercent(100000, [{ memberId: "A", basisPoints: 4000 }, { memberId: "B", basisPoints: 5000 }]).ok);
// FIN-07: shares 2:1:1 of ₹1,000.
check("FIN-07", "Shares 2:1:1 of ₹1,000", { A: 50000, B: 25000, C: 25000 }, shares(splitShares(100000, [{ memberId: "A", weight: 2 }, { memberId: "B", weight: 1 }, { memberId: "C", weight: 1 }])));
// FIN-08: 33.33% x3 of ₹100 still totals ₹100.
{
  const s = splitPercent(10000, [{ memberId: "A", basisPoints: 3334 }, { memberId: "B", basisPoints: 3333 }, { memberId: "C", basisPoints: 3333 }]);
  check("FIN-08", "33.34/33.33/33.33% of ₹100 adds to exactly ₹100", 10000, s.ok ? s.shares.reduce((t, x) => t + x.amount, 0) : -1);
}
// FIN-09: a payment partly settles; another expense later.
{
  const e1 = exp("A", 400000, { A: 100000, B: 100000, C: 100000, D: 100000 });
  const e2 = exp("B", 120000, { A: 40000, B: 40000, C: 40000 });
  const pays = [{ fromId: "C", toId: "A", amount: 50000 }];
  // By hand: A +300000 -40000 -50000(received) = 210000; B -100000 +80000 = -20000; C -100000 -40000 +50000 = -90000; D -100000.
  check("FIN-09", "Two expenses + a part payment", { A: 210000, B: -20000, C: -90000, D: -100000 }, netBalances(ABCD, [e1, e2], pays));
}
// FIN-10: money back (refund). Hotel refunds ₹900 to A, shared by A/B/C.
{
  const refund = exp("A", 90000, { A: 30000, B: 30000, C: 30000 }, { kind: "refund" });
  // By hand: A received 900 for everyone: owes B and C 300 each → A -60000, B +30000, C +30000.
  check("FIN-10", "₹900 money back received by A, shared by 3", { A: -60000, B: 30000, C: 30000 }, netBalances(["A", "B", "C"], [refund]));
}
// FIN-11: foreign currency with card fee. THB 1,200 at 2.55 INR/THB = ₹3,060; 3% card fee = ₹91.80.
check("FIN-11a", "THB 1,200 at 2.55 → ₹3,060.00", 306000, convertAmount(120000, "THB", "INR", "2.55"));
check("FIN-11b", "3% card fee on ₹3,060 → ₹91.80", 9180, markupAmountOf(306000, 300));
check("FIN-11c", "USD 19.99 at 83.4567 → ₹1,668.30 (rounded half up)", 166830, convertAmount(1999, "USD", "INR", "83.4567"));
check("FIN-11d", "JPY 5,000 at 0.56 → ₹2,800.00 (JPY has no decimals)", 280000, convertAmount(5000, "JPY", "INR", "0.56"));
// FIN-12: Smart Settle is never longer than people − 1, and clears everyone (1,000 random groups).
{
  let worst = 0, notZero = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let g = 0; g < 1000; g++) {
    const n = 2 + Math.floor(rnd() * 9);
    const ppl = Array.from({ length: n }, (_, i) => `P${i}`);
    const exps = Array.from({ length: 1 + Math.floor(rnd() * 30) }, () => {
      const amt = 1 + Math.floor(rnd() * 500000);
      const who = ppl.filter(() => rnd() > 0.3);
      const s = splitEqual(amt, who.length ? who : [ppl[0]]);
      return exp(ppl[Math.floor(rnd() * n)], amt, shares(s) as Record<string, number>);
    });
    const net = netBalances(ppl, exps);
    const sum = Object.values(net).reduce((a, b) => a + b, 0);
    if (sum !== 0) notZero++;
    const t = smartSettle(net);
    worst = Math.max(worst, t.length - (n - 1));
    const after = netBalances(ppl, exps, t.map((x) => ({ fromId: x.from, toId: x.to, amount: x.amount })));
    if (Object.values(after).some((v) => v !== 0)) notZero++;
  }
  check("FIN-12a", "1,000 random groups: balances always sum to zero and settle-up clears everyone", 0, notZero);
  check("FIN-12b", "Settle-up never needs more than people − 1 payments", true, worst <= 0);
}
// FIN-13: amount typing.
const P = (s: string, c = "INR") => parseAmount(s, c);
check("FIN-13a", "'₹ 1,23,456.78' → 12345678 paise", 12345678, P("₹ 1,23,456.78"));
check("FIN-13b", "'12,50' (comma decimal) → ₹12.50", 1250, P("12,50"));
check("FIN-13c", "'0', '-50', 'abc', '1e3', '' are refused", [null, null, null, null, null], ["0", "-50", "abc", "1e3", ""].map((s) => P(s)));
check("FIN-13d", "'10.555' (3 decimals) refused for INR", null, P("10.555"));
check("FIN-13e", "₹2 crore is the most one expense can be; more is refused", [2000000000, null], [P("20000000"), P("20000000.01")]);
check("FIN-13f", "JPY '1500.5' refused (no decimals)", null, P("1500.5", "JPY"));
// FIN-14: formatting.
check("FIN-14", "Formats: ₹1,23,456.78 / ₹500 / $1,234.50 / THB 1,200", ["₹1,23,456.78", "₹500", "$1,234.50", "THB 1,200"], [formatMoney(12345678), formatMoney(50000), formatMoney(123450, "USD"), formatMoney(120000, "THB")]);

// FIN-15: split by item. ₹1,180 bill: Pizza ₹600 (A, B), Beer ₹400 (B), ₹180 tax+tip shared by what each had.
// By hand: A had 300 (30%), B had 700 (70%). Extra 180 → A 54, B 126. A = 354, B = 826.
{
  const r = splitByItems([{ name: "Pizza", amount: 60000, people: ["A", "B"] }, { name: "Beer", amount: 40000, people: ["B"] }], 118000);
  check("FIN-15a", "Split by item ₹1,180 (Pizza ₹600 A+B, Beer ₹400 B, ₹180 tax+tip)", { A: 35400, B: 82600 }, r.ok ? r.amounts : r);
  check("FIN-15b", "Items adding to more than the bill are refused", false, splitByItems([{ name: "X", amount: 30000, people: ["A"] }], 20000).ok);
  const odd = splitByItems([{ name: "Starter", amount: 1000, people: ["A", "B", "C"] }, { name: "Main", amount: 2001, people: ["B"] }], 3337);
  check("FIN-15c", "Odd paise by item still add up to the bill (₹33.37)", 3337, odd.ok ? Object.values(odd.amounts).reduce((a, b) => a + b, 0) : -1);
}
// FIN-16: custom amounts typed in THB, converted with a 3% card fee: shares scale so they add to the final ₹ total.
// THB 1,000 at 2.5 = ₹2,500 + 3% = ₹2,575. Typed 600 / 400 THB → 60% / 40% → ₹1,545 / ₹1,030.
{
  const r = computeSplit({ total: 257500, originalAmount: 100000, originalCurrency: "THB", splitType: "exact", participants: ["A", "B"], exact: { A: "600", B: "400" }, percent: {} });
  check("FIN-16", "THB 1,000 custom 600/400 with 3% fee → ₹1,545 / ₹1,030", { A: 154500, B: 103000 }, r.ok ? Object.fromEntries(r.shares.map((x) => [x.memberId, x.amount])) : r);
}
// FIN-17: passport moments never mention money (privacy rule) and match the counts.
{
  const m = passportMarks({ countries: 10, continents: 3, cities: 10, trips: 5 }, true).map((x) => x.id);
  check("FIN-17a", "Passport moments for 10 countries / 3 continents / 10 cities / 5 trips", ["abroad-1", "countries-5", "countries-10", "continents-2", "continents-3", "cities-10", "trips-5"], m);
  const words = passportMarks({ countries: 100, continents: 7, cities: 100, trips: 100 }, true).map((x) => `${x.title} ${x.body}`).join(" ");
  check("FIN-17b", "No money words or amounts in passport moments", false, /₹|\$|€|£|spent|owe|paid/i.test(words));
}

mkdirSync("audit-out", { recursive: true });
writeFileSync("audit-out/money.json", JSON.stringify(out, null, 1));
console.log(`${out.filter((r) => r.pass).length}/${out.length} money checks passed`);
for (const r of out.filter((r) => !r.pass)) console.log("FAIL", r.id, r.scenario, "expected", r.expected, "got", r.actual);
