import { describe, expect, it } from "vitest";
import { potResult, potResultLine, potSummary, potTransfers, spreadGap } from "@/lib/pot";

// The Pot's maths, with the example from the brief (₹ in paise).
const players = ["A", "B", "C", "D"];
const take = (memberId: string, rupees: number) => ({ memberId, kind: "take", amount: rupees * 100 });
const back = (memberId: string, rupees: number) => ({ memberId, kind: "return", amount: rupees * 100 });

describe("The Pot", () => {
  const moves = [take("A", 1000), take("B", 2000), take("C", 500), take("D", 1500), back("A", 1600), back("B", 1700), back("C", 300), back("D", 1400)];

  it("net = put back − taken: A +600, B −300, C −200, D −100, and it adds up", () => {
    const { lines, totals } = potSummary(players, moves);
    expect(lines.map((l) => [l.memberId, l.taken / 100, l.returned / 100, l.net / 100])).toEqual([
      ["A", 1000, 1600, 600],
      ["B", 2000, 1700, -300],
      ["C", 500, 300, -200],
      ["D", 1500, 1400, -100],
    ]);
    expect(totals).toMatchObject({ taken: 500000, returned: 500000, gap: 0, balanced: true, out: 0 });
  });

  it("settles in the fewest payments: B, C and D each pay A", () => {
    const { lines } = potSummary(players, moves);
    expect(potTransfers(lines).map((t) => [t.from, t.to, t.amount / 100]).sort()).toEqual([
      ["B", "A", 300],
      ["C", "A", 200],
      ["D", "A", 100],
    ]);
    expect(potResult(lines)).toEqual({ winners: [{ memberId: "A", amount: 60000 }], losers: [{ memberId: "B", amount: 30000 }, { memberId: "C", amount: 20000 }, { memberId: "D", amount: 10000 }], total: 60000 });
  });

  it("taking more during the game adds up (₹1,000 then ₹500 = ₹1,500)", () => {
    const { lines } = potSummary(["A"], [take("A", 1000), take("A", 500)]);
    expect(lines[0]).toMatchObject({ taken: 150000, takes: 2, returnedYet: false });
  });

  it("flags money missing, and money that appeared from nowhere", () => {
    const short = potSummary(players, [...moves.slice(0, 7), back("D", 1300)]);
    expect(short.totals).toMatchObject({ gap: -10000, balanced: false });
    const extra = potSummary(players, [...moves.slice(0, 7), back("D", 1500)]);
    expect(extra.totals).toMatchObject({ gap: 10000, balanced: false });
  });

  it("the host's fix closes the gap: spread over players (odd paisa first), or on one", () => {
    expect(spreadGap(-10000, players)).toEqual([
      { memberId: "A", amount: 2500 },
      { memberId: "B", amount: 2500 },
      { memberId: "C", amount: 2500 },
      { memberId: "D", amount: 2500 },
    ]);
    expect(spreadGap(10001, ["A", "B"]).map((p) => p.amount)).toEqual([-5001, -5000]);
    const fixed = potSummary(players, [...moves.slice(0, 7), back("D", 1300), ...spreadGap(-10000, players).map((p) => ({ ...p, kind: "adjust" }))]);
    expect(fixed.totals.balanced).toBe(true);
    expect(fixed.lines.reduce((s, l) => s + l.net, 0)).toBe(0);
  });

  it("deleted lines don't count; someone who took nothing breaks even", () => {
    const { lines, totals } = potSummary([...players, "E"], [...moves, { ...take("B", 999), deletedAt: new Date() }]);
    expect(totals.taken).toBe(500000);
    expect(lines.find((l) => l.memberId === "E")).toMatchObject({ taken: 0, net: 0 });
  });
});

// C136: "Game tally" while playing, "Money owed" once finished, and a question before the result goes into balances.
describe("the question before a game goes into Money owed", () => {
  // Asha takes 1000 and puts back 1500; Ravi 1000 → 700; Meera 1000 → 800.
  const moves = [take("Asha", 1000), take("Ravi", 1000), take("Meera", 1000), back("Asha", 1500), back("Ravi", 700), back("Meera", 800)];

  it("results are +50000, −30000, −20000 (they add up to 0)", () => {
    const { lines, totals } = potSummary(["Asha", "Ravi", "Meera"], moves);
    expect(lines.map((l) => l.net)).toEqual([50000, -30000, -20000]);
    expect(lines.reduce((s, l) => s + l.net, 0)).toBe(0);
    expect(totals.balanced).toBe(true);
  });

  it("says who is up and who is down, and that it can be reopened", () => {
    const { lines } = potSummary(["Asha", "Ravi", "Meera"], moves);
    expect(potResultLine(lines.map((l) => ({ name: l.memberId, net: l.net })), "INR")).toBe(
      "Put this game into Money owed? Asha +₹500, Ravi −₹300, Meera −₹200. You can reopen it.",
    );
  });

  it("leaves out people who came out even, and copes with a game nobody won", () => {
    expect(potResultLine([{ name: "Asha", net: 10000 }, { name: "Dev", net: 0 }, { name: "Ravi", net: -10000 }], "INR")).toBe("Put this game into Money owed? Asha +₹100, Ravi −₹100. You can reopen it.");
    expect(potResultLine([{ name: "Asha", net: 0 }], "INR")).toBe("Put this game into Money owed? Nobody won or lost. You can reopen it.");
  });
});
