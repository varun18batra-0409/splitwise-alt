import { describe, expect, it } from "vitest";
import { netBalances } from "@/lib/balances";
import { settledByGroup } from "@/lib/stats";

// AS-14: "is every group square" is worked out once per group from Maps, and gives what the old filter-per-group loop gave.
// Amounts in paise. Rs 900 = 90,000, split 30,000 each between Asha, Ravi and Zoe.

const groups = [
  { id: "g1", deletedAt: null },
  { id: "g2", deletedAt: null },
  { id: "g3", deletedAt: new Date("2026-10-01") }, // in the bin
];
const members = [
  ...["asha", "ravi", "zoe"].flatMap((n) => ["g1", "g2", "g3"].map((g) => ({ id: `${g}-${n}`, groupId: g }))),
];
const shares = (g: string) => ["asha", "ravi", "zoe"].map((n) => ({ memberId: `${g}-${n}`, amount: 30000 }));
const expenses = ["g1", "g2", "g3"].map((g) => ({ groupId: g, paidById: `${g}-asha`, amount: 90000, payers: null, kind: "expense", shares: shares(g) }));
const payments = [
  // g1: Ravi and Zoe each pay Asha 30,000: Asha +90,000 - 30,000 - 30,000 - 30,000 = 0, Ravi -30,000 + 30,000 = 0, Zoe the same: square.
  { groupId: "g1", fromId: "g1-ravi", toId: "g1-asha", amount: 30000 },
  { groupId: "g1", fromId: "g1-zoe", toId: "g1-asha", amount: 30000 },
  // g2: only Ravi pays: Zoe still owes 30,000 and Asha is still owed 30,000: not square.
  { groupId: "g2", fromId: "g2-ravi", toId: "g2-asha", amount: 30000 },
];

// The old way, as it was on the page.
function oldLoop() {
  const out: Record<string, boolean> = {};
  for (const g of groups) {
    const ids = members.filter((m) => m.groupId === g.id).map((m) => m.id);
    const net = netBalances(ids, expenses.filter((e) => e.groupId === g.id), payments.filter((p) => p.groupId === g.id));
    out[g.id] = Object.values(net).every((v) => v === 0);
  }
  return out;
}

describe("settledByGroup", () => {
  it("g1 is square, g2 is not, the group in the bin is left out", () => {
    expect(settledByGroup(groups, members, expenses, payments)).toEqual({ g1: true, g2: false });
  });
  it("matches the old filter-per-group loop for every group that is not in the bin", () => {
    const old = oldLoop();
    const now = settledByGroup(groups, members, expenses, payments);
    for (const g of groups.filter((x) => !x.deletedAt)) expect(now[g.id]).toBe(old[g.id]);
    expect(old).toEqual({ g1: true, g2: false, g3: false }); // (the bin group would have said "not square" too; the stats ignore it)
  });
  it("a group with no rows at all counts as square, as before", () => {
    expect(settledByGroup([{ id: "g9", deletedAt: null }], [], [], [])).toEqual({ g9: true });
  });
});
