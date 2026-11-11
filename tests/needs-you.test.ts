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
    const claimEvent = { type: "event" as const, groupId: gid, kind: "payment_claimed", actorId: ravi };
    const otherEvent = { type: "event" as const, groupId: gid, kind: "expense_added", actorId: ravi };
    const claimByMeera = { type: "event" as const, groupId: gid, kind: "payment_claimed", actorId: meera }; // Meera's claim isn't waiting any more
    const code = n.items.find((i) => i.kind === "collect")!.href;
    const zoyaNote = { type: "note" as const, kind: "collect_ticked", url: code, body: "Zoya says they paid ₹200. Tap to check it off." };
    const kabirNote = { type: "note" as const, kind: "collect_ticked", url: code, body: "Kabir says they paid ₹200. Tap to check it off." }; // not waiting: kept
    const added = { type: "note" as const, kind: "collect_added", url: code, body: "Asha added you" };
    const kept = withoutRepeats([claimEvent, otherEvent, claimByMeera, zoyaNote, kabirNote, added], n.items);
    expect(kept).toEqual([otherEvent, claimByMeera, kabirNote, added]);
  });
});
