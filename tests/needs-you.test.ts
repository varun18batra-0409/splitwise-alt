import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { loadNeedsYou, withoutRepeats } from "@/lib/needs-you";

// Alerts: "Needs you" lists only what the signed-in person must answer, once each; "Activity" doesn't repeat it.
//
// Cast: Asha (the viewer, looks after the Flat and runs a collection), Ravi, Meera.
//   1 claim:    Ravi says he paid Asha ₹500 (waiting)
//   1 payment:  an older payment Meera → Asha ₹300 still waiting for Asha's Confirm received
//   1 bill:     Electricity waits for Asha's amount (she is the payer)  [and Rent is recorded, so it's not listed]
//   1 collect:  Zoya in Asha's collection says she paid ₹200
//   2 invitations are counted (the page draws them) = total 6 with the four above.
// Not listed: a claim already confirmed, a claim to Ravi (not Asha), a collection entry that's still due.

const groups: string[] = [];
let accountId = "";
const collectionIds: string[] = [];
let gid = "", asha = "", ravi = "", meera = "";
const nov1 = new Date("2026-11-01T06:00:00Z");

beforeAll(async () => {
  const acc = await db.account.create({ data: { email: `needs-${Date.now()}@example.test`, name: "Asha" } });
  accountId = acc.id;
  const g = await db.group.create({
    data: {
      name: "Flat 402",
      type: "home",
      currency: "INR",
      inviteCode: `needs-${Date.now()}-${Math.random()}`,
      members: { create: [{ name: "Asha", claimedAt: new Date(), accountId }, { name: "Ravi", claimedAt: new Date() }, { name: "Meera", claimedAt: new Date() }] },
    },
    include: { members: true },
  });
  groups.push(g.id);
  gid = g.id;
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  [asha, ravi, meera] = [id("Asha"), id("Ravi"), id("Meera")];
  await db.paymentClaim.create({ data: { groupId: gid, fromId: ravi, toId: asha, amount: 50000, currency: "INR", status: "waiting" } });
  await db.paymentClaim.create({ data: { groupId: gid, fromId: meera, toId: asha, amount: 10000, currency: "INR", status: "confirmed", slot: "done-1" } });
  await db.paymentClaim.create({ data: { groupId: gid, fromId: asha, toId: ravi, amount: 20000, currency: "INR", status: "waiting" } }); // to Ravi: not mine to answer
  await db.payment.create({ data: { groupId: gid, fromId: meera, toId: asha, amount: 30000, createdById: meera, needsOk: true } });
  await db.bill.create({ data: { groupId: gid, name: "Electricity", nature: "varies", amount: 242000, day: 1, startMonth: "2026-11", payer: asha, tz: "Asia/Kolkata" } });
  await db.bill.create({ data: { groupId: gid, name: "Rent", nature: "fixed", amount: 3000000, day: 1, startMonth: "2026-11", payer: asha, tz: "Asia/Kolkata" } });
  const { runBillsForGroup } = await import("@/lib/home/bills-db");
  await runBillsForGroup(gid, nov1); // Rent is recorded; Electricity waits for Asha's amount
  const c = await db.collection.create({ data: { code: `nc-${Date.now()}`, title: "Farewell gift", accountId, organiser: "Asha", currency: "INR", amount: 20000 } });
  collectionIds.push(c.id);
  await db.collectionEntry.create({ data: { collectionId: c.id, name: "Zoya", amount: 20000, status: "paid", paidAt: new Date() } });
  await db.collectionEntry.create({ data: { collectionId: c.id, name: "Kabir", status: "due" } });
});

afterAll(async () => {
  await db.collection.deleteMany({ where: { id: { in: collectionIds } } });
  await eraseGroups(groups);
  await db.account.delete({ where: { id: accountId } }).catch(() => {});
});

describe("Needs you", () => {
  it("lists each thing to answer once: the claim, the old payment, the bill, the collection payment (+2 invitations = 6)", async () => {
    const n = await loadNeedsYou({ [gid]: asha }, { id: accountId }, 2, nov1);
    expect(n.items.map((i) => i.kind).sort()).toEqual(["bill", "claim", "collect", "payment"]);
    expect(n.invitations).toBe(2);
    expect(n.total).toBe(6);
    const text = (k: string) => n.items.find((i) => i.kind === k)!.text;
    expect(text("claim")).toBe("Ravi says they paid you ₹500");
    expect(text("payment")).toBe("Meera says they paid you ₹300");
    expect(text("bill")).toBe("Electricity is waiting for its amount");
    expect(text("collect")).toBe("Zoya says they paid ₹200");
    // Nothing twice.
    expect(new Set(n.items.map((i) => i.id)).size).toBe(n.items.length);
    // Each one goes to where it is answered.
    expect(n.items.find((i) => i.kind === "claim")!.href).toBe(`/groups/${gid}/settle`);
    expect(n.items.find((i) => i.kind === "bill")!.href).toMatch(new RegExp(`^/groups/${gid}/add\\?bill=.+&period=2026-11$`));
    expect(n.items.find((i) => i.kind === "collect")!.href).toMatch(/^\/c\/nc-/);
  });

  it("nothing for a person with nothing to answer", async () => {
    const n = await loadNeedsYou({ [gid]: meera }, null, 0, nov1);
    expect(n).toEqual({ items: [], invitations: 0, total: 0 });
  });

  it("someone else's bill, claim to somebody else or a collection still due is not listed for Ravi", async () => {
    const n = await loadNeedsYou({ [gid]: ravi }, null, 0, nov1);
    expect(n.items.map((i) => i.kind)).toEqual(["claim"]); // only Asha's claim to him (₹200)
    expect(n.items[0].text).toBe("Asha says they paid you ₹200");
  });

  it("a confirmed claim leaves the list", async () => {
    const c = await db.paymentClaim.findFirstOrThrow({ where: { groupId: gid, fromId: ravi, toId: asha, status: "waiting" } });
    await db.paymentClaim.update({ where: { id: c.id }, data: { status: "confirmed", slot: c.id } });
    const n = await loadNeedsYou({ [gid]: asha }, { id: accountId }, 0, nov1);
    expect(n.items.some((i) => i.kind === "claim")).toBe(false);
    await db.paymentClaim.update({ where: { id: c.id }, data: { status: "waiting", slot: "" } });
  });

  it("a closed group asks for nothing (a claim can't be confirmed there)", async () => {
    await db.group.update({ where: { id: gid }, data: { closed: true } });
    const n = await loadNeedsYou({ [gid]: asha }, null, 0, nov1);
    expect(n.items.length).toBe(0);
    await db.group.update({ where: { id: gid }, data: { closed: false } });
  });
});

describe("Activity doesn't repeat what Needs you shows", () => {
  it("drops the 'says they paid' line for a waiting claim and the collection note for an entry still to check; keeps everything else", async () => {
    const n = await loadNeedsYou({ [gid]: asha }, { id: accountId }, 0, nov1);
    const claimAt = n.items.find((i) => i.kind === "claim")!.at;
    const claimEvent = { type: "event" as const, groupId: gid, kind: "payment_claimed", actorId: ravi, at: claimAt };
    const otherEvent = { type: "event" as const, groupId: gid, kind: "expense_added", actorId: ravi, at: claimAt };
    const claimByMeera = { type: "event" as const, groupId: gid, kind: "payment_claimed", actorId: meera, at: claimAt }; // Meera's claim isn't waiting any more
    const code = n.items.find((i) => i.kind === "collect")!.href;
    const zoyaNote = { type: "note" as const, kind: "collect_ticked", url: code, body: "Zoya says they paid ₹200. Tap to check it off." };
    const kabirNote = { type: "note" as const, kind: "collect_ticked", url: code, body: "Kabir says they paid ₹200. Tap to check it off." }; // not waiting: kept
    const added = { type: "note" as const, kind: "collect_added", url: code, body: "Asha added you" };
    const kept = withoutRepeats([claimEvent, otherEvent, claimByMeera, zoyaNote, kabirNote, added], n.items);
    expect(kept).toEqual([otherEvent, claimByMeera, kabirNote, added]);
  });
});

// ---- Round 2: the right label for held bills, only the matching "says they paid" line hidden, leavers, two groups ----
// Each test makes its own people (own account, own groups) so nothing depends on the cast above.

const extraGroups: string[] = [];
const extraAccounts: string[] = [];
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function flat(name: string, people: { name: string; left?: boolean; account?: boolean }[]) {
  const accs: Record<string, string> = {};
  for (const p of people) {
    if (p.account) {
      const a = await db.account.create({ data: { email: `ny2-${uniq()}@example.test`, name: p.name } });
      extraAccounts.push(a.id);
      accs[p.name] = a.id;
    }
  }
  const g = await db.group.create({
    data: {
      name,
      type: "home",
      currency: "INR",
      inviteCode: `ny2-${uniq()}`,
      members: { create: people.map((p) => ({ name: p.name, claimedAt: new Date(), accountId: accs[p.name], leftAt: p.left ? new Date() : null })) },
    },
    include: { members: true },
  });
  extraGroups.push(g.id);
  const ids = Object.fromEntries(g.members.map((m) => [m.name, m.id])) as Record<string, string>;
  return { id: g.id, ids, accs };
}

describe("Needs you, round 2", () => {
  afterAll(async () => {
    await eraseGroups(extraGroups);
    await db.account.deleteMany({ where: { id: { in: extraAccounts } } });
  });

  it("a fixed bill held for a split problem says Needs a fix and opens the bill's settings; a varies bill waiting for its amount still says so", async () => {
    const f = await flat("Held flat", [{ name: "Asha" }, { name: "Ravi", left: true }]);
    const split = JSON.stringify({ mode: "amounts", amt: { [f.ids.Ravi]: 1000000, [f.ids.Asha]: 2000000 } }); // Ravi has left
    const rent = await db.bill.create({ data: { groupId: f.id, name: "Rent", nature: "fixed", amount: 3000000, day: 1, startMonth: "2026-11", payer: f.ids.Asha, tz: "Asia/Kolkata", split } });
    await db.bill.create({ data: { groupId: f.id, name: "Electricity", nature: "varies", amount: 242000, day: 1, startMonth: "2026-11", payer: f.ids.Asha, tz: "Asia/Kolkata" } });
    const { runBillsForGroup } = await import("@/lib/home/bills-db");
    await runBillsForGroup(f.id, nov1);
    const n = await loadNeedsYou({ [f.id]: f.ids.Asha }, null, 0, nov1);
    const held = n.items.find((i) => i.id.startsWith(`bill:${rent.id}`))!;
    expect(held.action).toBe("Needs a fix");
    expect(held.tone).toBe("orange");
    expect(held.text).toBe("Rent is on hold: someone in the split has left");
    expect(held.href).toBe(`/groups/${f.id}/bills/${rent.id}`);
    const amount = n.items.find((i) => i.text === "Electricity is waiting for its amount")!;
    expect(amount.action).toBeUndefined(); // the usual "Enter amount"
    expect(amount.href).toMatch(/\/add\?bill=/);
    expect(n.items.length).toBe(2);
  });

  it("someone who has left still sees money paid to them, but no bills", async () => {
    const f = await flat("Leaver flat", [{ name: "Meera", left: true }, { name: "Ravi" }, { name: "Asha" }]);
    await db.paymentClaim.create({ data: { groupId: f.id, fromId: f.ids.Ravi, toId: f.ids.Meera, amount: 25000, currency: "INR", status: "waiting" } });
    await db.bill.create({ data: { groupId: f.id, name: "Wi-Fi", nature: "varies", amount: 100000, day: 1, startMonth: "2026-11", payer: f.ids.Meera, tz: "Asia/Kolkata" } });
    const { runBillsForGroup } = await import("@/lib/home/bills-db");
    await runBillsForGroup(f.id, nov1);
    const n = await loadNeedsYou({ [f.id]: f.ids.Meera }, null, 0, nov1);
    expect(n.items.map((i) => i.kind)).toEqual(["claim"]);
    expect(n.items[0].text).toBe("Ravi says they paid you ₹250");
    expect(n.total).toBe(1);
  });

  it("one person in two groups: each group's own waiting claim, once, with its own group name; a claim to someone else is not theirs", async () => {
    const g1 = await flat("Goa gang", [{ name: "Asha" }, { name: "Ravi" }]);
    const g2 = await flat("Office lunch", [{ name: "Asha" }, { name: "Meera" }]);
    await db.paymentClaim.create({ data: { groupId: g1.id, fromId: g1.ids.Ravi, toId: g1.ids.Asha, amount: 10000, currency: "INR", status: "waiting" } });
    await db.paymentClaim.create({ data: { groupId: g2.id, fromId: g2.ids.Meera, toId: g2.ids.Asha, amount: 35000, currency: "INR", status: "waiting" } });
    await db.paymentClaim.create({ data: { groupId: g2.id, fromId: g2.ids.Asha, toId: g2.ids.Meera, amount: 5000, currency: "INR", status: "waiting" } }); // to Meera
    const n = await loadNeedsYou({ [g1.id]: g1.ids.Asha, [g2.id]: g2.ids.Asha }, null, 0, nov1);
    expect(n.items.map((i) => `${i.where}: ${i.text}`).sort()).toEqual(["Goa gang: Ravi says they paid you ₹100", "Office lunch: Meera says they paid you ₹350"]);
    expect(new Set(n.items.map((i) => i.id)).size).toBe(2);
    expect(n.items.find((i) => i.where === "Goa gang")!.href).toBe(`/groups/${g1.id}/settle`);
    expect(n.items.find((i) => i.where === "Office lunch")!.href).toBe(`/groups/${g2.id}/settle`);
    // Only one of the two groups is this phone's: only that one counts.
    const one = await loadNeedsYou({ [g2.id]: g2.ids.Asha }, null, 0, nov1);
    expect(one.items.map((i) => i.where)).toEqual(["Office lunch"]);
  });

  it("Activity hides only the 'says they paid' line of the claim shown in Needs you, not Ravi's other lines in that group", async () => {
    const f = await flat("Line flat", [{ name: "Asha" }, { name: "Ravi" }, { name: "Meera" }]);
    await db.paymentClaim.create({ data: { groupId: f.id, fromId: f.ids.Ravi, toId: f.ids.Asha, amount: 10000, currency: "INR", status: "waiting" } });
    const n = await loadNeedsYou({ [f.id]: f.ids.Asha }, null, 0, nov1);
    const at = n.items[0].at;
    const hour = 60 * 60 * 1000;
    const row = (actorId: string, when: Date, kind = "payment_claimed") => ({ type: "event" as const, groupId: f.id, kind, actorId, at: when });
    const mineNow = row(f.ids.Ravi, new Date(at.getTime() + 20)); // written with the claim
    const earlier = row(f.ids.Ravi, new Date(at.getTime() - 2 * hour)); // an earlier tap, already answered
    const later = row(f.ids.Ravi, new Date(at.getTime() + hour)); // a later line
    const otherPerson = row(f.ids.Meera, at);
    const kept = withoutRepeats([mineNow, earlier, later, otherPerson], n.items);
    expect(kept).toEqual([earlier, later, otherPerson]);
  });
});
