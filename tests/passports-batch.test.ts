import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { loadPassport, passportsForFriends, undatedTripFacts } from "@/lib/passport-db";

// SB-15 / SA-13: Friends' passports are read in one batch. Each person's passport must equal what loadPassport gives for them
// as a friend sees it, field for field: a leaver keeps their OWN cut in each group, and a trip still going on stays hidden.
// Today = 2026-11-17.

const TODAY = "2026-11-17";
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
const at = (s: string) => new Date(s);

async function account(name: string) {
  const a = await db.account.create({ data: { email: `pb-${name}-${stamp}@example.test`, name, passportChoiceAt: new Date() } });
  accountIds.push(a.id);
  return a;
}
type P = { name: string; accountId?: string; leftAt?: Date; pending?: boolean };
async function trip(name: string, tripStart: string, tripEnd: string, people: P[]) {
  const g = await db.group.create({
    data: {
      name: `${name} ${stamp}`, type: "trip", currency: "INR", tripStart, tripEnd, tripPlace: name, inviteCode: `pb-${name}-${stamp}`,
      members: { create: people.map((p) => ({ name: p.name, accountId: p.accountId ?? null, leftAt: p.leftAt ?? null, addedBy: p.pending ? "someone-else" : "", seenAt: null, claimedAt: p.accountId ? new Date() : null })) },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  return g;
}
async function spend(groupId: string, paidById: string, shareIds: string[], createdAt: Date, amount = 30000) {
  await db.expense.create({
    data: { groupId, description: "Spend", amount, splitType: "equal", paidById, createdAt, shares: { create: shareIds.map((memberId) => ({ memberId, amount: amount / shareIds.length })) } },
  });
}

afterAll(async () => {
  await db.expenseShare.deleteMany({ where: { expense: { groupId: { in: groupIds } } } });
  await db.expense.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.member.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("Friends' passports in one batch equal one by one", () => {
  it("three friends: a leaver's own cut, an undated trip, a trip still on, and a never-opened trip", async () => {
    const a = await account("Asha");
    const b = await account("Ravi"); // leaves the undated trip on 10 Oct
    const c = await account("Zoe");

    // Ended dated trip, all three.
    await trip("Goa", "2026-10-01", "2026-10-05", [{ name: "Asha", accountId: a.id }, { name: "Ravi", accountId: b.id }, { name: "Zoe", accountId: c.id }]);
    // Dated trip still going on: a friend must not see it.
    await trip("Hampi", "2026-11-15", "2026-11-20", [{ name: "Asha", accountId: a.id }, { name: "Zoe", accountId: c.id }]);
    // Undated trip shared by all three; Ravi left on 10 Oct. Dan has no account.
    const kerala = await trip("Kerala", "", "", [{ name: "Asha", accountId: a.id }, { name: "Ravi", accountId: b.id, leftAt: at("2026-10-10T00:00:00Z") }, { name: "Zoe", accountId: c.id }, { name: "Dan" }]);
    const m = (n: string) => kerala.members.find((x) => x.name === n)!.id;
    await spend(kerala.id, m("Dan"), [m("Dan"), m("Asha"), m("Ravi"), m("Zoe")], at("2026-10-05T06:00:00Z")); // Ravi is in it: he sees it
    await spend(kerala.id, m("Dan"), [m("Dan"), m("Asha"), m("Zoe")], at("2026-10-20T06:00:00Z")); // added after Ravi left, without him: he must not see it
    // Undated trip with spending yesterday: still on, so a friend must not see it.
    const spiti = await trip("Spiti", "", "", [{ name: "Asha", accountId: a.id }, { name: "Zoe", accountId: c.id }]);
    await spend(spiti.id, spiti.members[0].id, spiti.members.map((x) => x.id), at("2026-11-16T06:00:00Z"));
    // A trip Zoe was added to by someone but never opened: not hers. Another Ravi left before it began: he didn't go.
    await trip("Coorg", "2026-08-01", "2026-08-05", [{ name: "Asha", accountId: a.id }, { name: "Zoe", accountId: c.id, pending: true }]);
    await trip("Munnar", "2026-09-01", "2026-09-03", [{ name: "Asha", accountId: a.id }, { name: "Ravi", accountId: b.id, leftAt: at("2026-08-30T00:00:00Z") }]);

    const accounts = [a, b, c];
    const batch = await passportsForFriends(accounts, TODAY);
    expect(batch).toHaveLength(3);
    for (let i = 0; i < accounts.length; i++) {
      const one = await loadPassport(accounts[i], TODAY, { forFriend: true });
      expect(batch[i], accounts[i].name).toEqual(one);
    }

    // Hand-worked, so the equality above isn't two copies of the same mistake.
    const names = (p: (typeof batch)[number]) => p.trips.map((t) => t.name.replace(` ${stamp}`, "")).sort();
    expect(names(batch[0])).toEqual(["Goa", "Kerala", "Munnar", "Coorg"].sort()); // Asha: not Hampi, not Spiti (still on)
    expect(names(batch[1])).toEqual(["Goa", "Kerala"]); // Ravi: not Munnar (left before it began)
    expect(names(batch[2])).toEqual(["Goa", "Kerala"]); // Zoe: not Coorg (never opened), not Hampi, not Spiti
    // Ravi's Kerala stamp is dated by the only spending he may see (5 Oct); Asha's by the latest (20 Oct).
    expect(batch[1].trips.find((t) => t.name.startsWith("Kerala"))!.start).toBe("2026-10-05");
    expect(batch[0].trips.find((t) => t.name.startsWith("Kerala"))!.start).toBe("2026-10-20");
    // The same person looking at their own passport does see the trips still on.
    const own = await loadPassport(a, TODAY);
    expect(own.trips.map((t) => t.name.replace(` ${stamp}`, "")).sort()).toEqual(["Coorg", "Goa", "Hampi", "Kerala", "Munnar", "Spiti"]);
  });

  it("undatedTripFacts: counts and days per trip, each person's own cut, the same as asking one trip at a time", async () => {
    const x = await account("Xena");
    const y = await account("Yash");
    const g = await trip("Ladakh", "", "", [{ name: "Xena", accountId: x.id }, { name: "Yash", accountId: y.id, leftAt: at("2026-10-10T00:00:00Z") }, { name: "Dan" }]);
    const m = (n: string) => g.members.find((v) => v.name === n)!.id;
    await spend(g.id, m("Dan"), [m("Dan"), m("Xena")], at("2026-10-05T06:00:00Z")); // Yash not in it, but it was added before he left: he sees it
    await spend(g.id, m("Dan"), [m("Dan"), m("Xena")], at("2026-10-20T06:00:00Z")); // after he left, not his: hidden
    await spend(g.id, m("Dan"), [m("Dan"), m("Xena")], at("2026-10-20T06:00:00Z")); // same moment as the one above: the highest id is "latest"
    const empty = await trip("Nothing", "", "", [{ name: "Xena", accountId: x.id }]);
    const facts = await undatedTripFacts(
      [
        { groupId: g.id, me: { id: m("Xena"), leftAt: null } },
        { groupId: empty.id, me: { id: empty.members[0].id, leftAt: null } },
      ],
      "Asia/Kolkata",
    );
    expect(facts.get(g.id)).toEqual({ count: 3, day: "2026-10-20" }); // Xena sees all three
    expect(facts.get(empty.id)).toBeNull();
    const yash = await undatedTripFacts([{ groupId: g.id, me: { id: m("Yash"), leftAt: at("2026-10-10T00:00:00Z") } }], "Asia/Kolkata");
    expect(yash.get(g.id)).toEqual({ count: 1, day: "2026-10-05" }); // only what was added up to the day he left
  });
});
