import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { MAX_ENTRIES, createCollection, loadCollection, markPaid, organiserAction, tickStillStands, undoPaid } from "@/lib/collect";

// Batch 9 (L25, L26, G11): unchecking cash the organiser recorded, a closed collection takes no new ticks, and the late alert is current.
// Each person is ₹300 = 30000 minor units. "Checked total" = the sum of the amounts of the checked (confirmed) entries.
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const emails: string[] = [];
async function organiser(name = "Asha") {
  const email = `b9c-${emails.length}-${stamp}@example.test`;
  emails.push(email);
  return db.account.create({ data: { email, name } });
}
const form = { title: "Farewell gift", note: "", currency: "INR", amount: "300", dueDate: "", upiId: "asha@okicici", payLink: "", names: "Ravi\nKabir" };
async function collection(over: Partial<typeof form> = {}) {
  const asha = await organiser();
  const made = await createCollection(asha, { ...form, ...over });
  if (!made.ok) throw new Error(made.error);
  const c = (await loadCollection(made.code))!;
  return { asha, code: made.code, id: c.id, entry: (name: string) => c.entries.find((e) => e.name === name)!.id };
}
const row = (id: string) => db.collectionEntry.findUniqueOrThrow({ where: { id } });
const checkedTotal = async (code: string) => (await loadCollection(code))!.entries.filter((e) => e.status === "confirmed").reduce((n, e) => n + e.amount, 0);

afterAll(async () => {
  const accs = await db.account.findMany({ where: { email: { in: emails } }, select: { id: true } });
  await db.collection.deleteMany({ where: { accountId: { in: accs.map((a) => a.id) } } });
  await db.account.deleteMany({ where: { email: { in: emails } } });
});

describe("L25: unchecking cash the organiser recorded", () => {
  it("Kabir's 30000 cash (recorded by the organiser, then checked) goes back to 'still to pay' when unchecked; the checked total goes 60000 -> 30000", async () => {
    const c = await collection();
    const [ravi, kabir] = [c.entry("Ravi"), c.entry("Kabir")];
    // Ravi ticks his own and the organiser checks it (30000). The organiser records Kabir's cash (30000, already checked).
    expect((await markPaid(c.code, { entryId: ravi }, "phone-ravi")).ok).toBe(true);
    expect((await organiserAction(c.code, c.asha.id, { kind: "confirm", entryId: ravi })).ok).toBe(true);
    expect((await organiserAction(c.code, c.asha.id, { kind: "cash", entryId: kabir })).ok).toBe(true);
    expect(await checkedTotal(c.code)).toBe(60000);

    expect((await organiserAction(c.code, c.asha.id, { kind: "unconfirm", entryId: kabir })).ok).toBe(true);
    const k = await row(kabir);
    expect([k.status, k.amount, k.method, k.paidAt, k.confirmedAt]).toEqual(["due", 0, "", null, null]);
    expect(await checkedTotal(c.code)).toBe(30000);
  });

  it("a payer's own tick that was checked goes back to 'paid' when unchecked (as before), keeping the payer's phone and amount", async () => {
    const c = await collection();
    const ravi = c.entry("Ravi");
    expect((await markPaid(c.code, { entryId: ravi }, "phone-ravi")).ok).toBe(true);
    expect((await organiserAction(c.code, c.asha.id, { kind: "confirm", entryId: ravi })).ok).toBe(true);
    expect((await organiserAction(c.code, c.asha.id, { kind: "unconfirm", entryId: ravi })).ok).toBe(true);
    const r = await row(ravi);
    expect([r.status, r.amount, r.payerKey, r.confirmedAt]).toEqual(["paid", 30000, "phone-ravi", null]);
    expect(r.paidAt).not.toBeNull();
  });
});

describe("L26 and G11: a closed collection takes no new ticks; the late alert is current", () => {
  it("the organiser closes after the page was read and before the tick is written: the tick is refused with the usual text and nothing is saved", async () => {
    const c = await collection();
    const ravi = c.entry("Ravi");
    const r = await markPaid(c.code, { entryId: ravi }, "phone-ravi", { afterRead: async () => void (await organiserAction(c.code, c.asha.id, { kind: "close" })) });
    expect(r).toEqual({ ok: false, error: "Asha has closed this collection." });
    expect((await row(ravi)).status).toBe("due");
    // A name typed in is refused the same way and adds nobody.
    const again = await markPaid(c.code, { name: "Zoya" }, "phone-zoya");
    expect(again).toEqual({ ok: false, error: "Asha has closed this collection." });
    expect((await loadCollection(c.code))!.entries).toHaveLength(2);
  });

  it("two 'Ravi' ticks at once (a new name): one entry, the second is told the name is already on the list", async () => {
    const c = await collection({ names: "Kabir" });
    const second = { r: null as Awaited<ReturnType<typeof markPaid>> | null };
    const first = await markPaid(c.code, { name: "Ravi" }, "phone-1", { afterRead: async () => void (second.r = await markPaid(c.code, { name: " ravi " }, "phone-2")) });
    expect(second.r?.ok).toBe(true);
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error).toContain("is already on the list as paid");
    expect((await loadCollection(c.code))!.entries.filter((e) => e.name.toLowerCase() === "ravi")).toHaveLength(1);
  });

  it(`at ${MAX_ENTRIES - 1} people, two adds at once: only one fits`, async () => {
    const c = await collection({ names: "Kabir" });
    await db.collectionEntry.createMany({ data: Array.from({ length: MAX_ENTRIES - 2 }, (_, i) => ({ collectionId: c.id, name: `Guest ${i}` })) });
    expect(await db.collectionEntry.count({ where: { collectionId: c.id } })).toBe(MAX_ENTRIES - 1);
    const other = { r: null as Awaited<ReturnType<typeof markPaid>> | null };
    const first = await markPaid(c.code, { name: "Zed" }, "phone-z", { afterRead: async () => void (other.r = await markPaid(c.code, { name: "Yan" }, "phone-y")) });
    expect([first.ok, other.r?.ok].sort()).toEqual([false, true]);
    expect(await db.collectionEntry.count({ where: { collectionId: c.id } })).toBe(MAX_ENTRIES);
    if (!first.ok) expect(first.error).toBe("This list is full.");
  });

  it("the organiser's own 'add' respects the limit too: at the last free place, a second add is refused", async () => {
    const c = await collection({ names: "Kabir" });
    await db.collectionEntry.createMany({ data: Array.from({ length: MAX_ENTRIES - 2 }, (_, i) => ({ collectionId: c.id, name: `Guest ${i}` })) });
    const first = await organiserAction(c.code, c.asha.id, { kind: "add", names: "Zed" }, { afterRead: async () => void (await organiserAction(c.code, c.asha.id, { kind: "add", names: "Yan" })) });
    expect(first.ok).toBe(false);
    expect(await db.collectionEntry.count({ where: { collectionId: c.id } })).toBe(MAX_ENTRIES);
  });

  it("the organiser is told only while that tick stands: ticked then undone before the alert -> no alert; ticked again -> only the new tick counts", async () => {
    const c = await collection();
    const ravi = c.entry("Ravi");
    const t1 = await markPaid(c.code, { entryId: ravi }, "phone-ravi");
    if (!t1.ok) throw new Error(t1.error);
    expect(await tickStillStands(c.code, ravi, t1.paidAt)).not.toBeNull(); // nothing changed: the alert goes
    expect((await undoPaid(c.code, ravi, "phone-ravi")).ok).toBe(true);
    expect(await tickStillStands(c.code, ravi, t1.paidAt)).toBeNull(); // undone: no alert
    await new Promise((r) => setTimeout(r, 5));
    const t2 = await markPaid(c.code, { entryId: ravi }, "phone-ravi");
    if (!t2.ok) throw new Error(t2.error);
    expect(await tickStillStands(c.code, ravi, t1.paidAt)).toBeNull(); // the old alert is not about this tick
    expect(await tickStillStands(c.code, ravi, t2.paidAt)).not.toBeNull();
    // Checked by the organiser before the alert goes: no "check it off" alert any more.
    expect((await organiserAction(c.code, c.asha.id, { kind: "confirm", entryId: ravi })).ok).toBe(true);
    expect(await tickStillStands(c.code, ravi, t2.paidAt)).toBeNull();
  });
});

describe("L5: the same phone sending the same typed-name tick again", () => {
  it("is told ok (nothing changes, flagged as a repeat so no second alert); another phone is still told the name is taken", async () => {
    const c = await collection({ names: "Kabir" });
    const first = await markPaid(c.code, { name: "Ravi" }, "phone-ravi");
    if (!first.ok) throw new Error(first.error);
    expect(first.repeat).toBeUndefined();
    const again = await markPaid(c.code, { name: " ravi " }, "phone-ravi");
    expect(again).toMatchObject({ ok: true, entryId: first.entryId, repeat: true });
    if (again.ok) expect(again.paidAt.getTime()).toBe(first.paidAt.getTime()); // the same tick, not a new one
    const other = await markPaid(c.code, { name: "Ravi" }, "phone-someone-else");
    expect(other.ok).toBe(false);
    expect((await loadCollection(c.code))!.entries.filter((e) => e.name === "Ravi")).toHaveLength(1);
  });
});

describe("L6: the organiser's add is decided on the list as it is when it is written", () => {
  it("the same name added twice at once is on the list once; the second add is told there is nothing new", async () => {
    const c = await collection({ names: "Kabir" });
    const second = await organiserAction(c.code, c.asha.id, { kind: "add", names: "Zed" }, { afterRead: async () => void (await organiserAction(c.code, c.asha.id, { kind: "add", names: "Zed" })) });
    expect(second).toEqual({ ok: false, error: "Type names that aren’t on the list yet." });
    expect((await loadCollection(c.code))!.entries.filter((e) => e.name === "Zed")).toHaveLength(1);
  });

  it("a closed collection can still have names added (the form is still shown there)", async () => {
    const c = await collection({ names: "Kabir" });
    expect((await organiserAction(c.code, c.asha.id, { kind: "close" })).ok).toBe(true);
    expect((await organiserAction(c.code, c.asha.id, { kind: "add", names: "Zed" })).ok).toBe(true);
    expect(await db.collectionEntry.count({ where: { collectionId: c.id } })).toBe(2);
    // ...also when it is closed in the gap between the read and the write.
    const d = await collection({ names: "Kabir" });
    const r = await organiserAction(d.code, d.asha.id, { kind: "add", names: "Zed" }, { afterRead: async () => void (await organiserAction(d.code, d.asha.id, { kind: "close" })) });
    expect(r.ok).toBe(true);
    expect(await db.collectionEntry.count({ where: { collectionId: d.id } })).toBe(2);
  });

  it("the collection is deleted between the read and the write: refused, nobody is added", async () => {
    const c = await collection({ names: "Kabir" });
    const r = await organiserAction(c.code, c.asha.id, { kind: "add", names: "Zed" }, { afterRead: async () => void (await organiserAction(c.code, c.asha.id, { kind: "delete" })) });
    expect(r).toEqual({ ok: false, error: "This collection isn’t there any more." });
    expect(await db.collectionEntry.count({ where: { collectionId: c.id } })).toBe(1);
  });
});

describe("N6: picking your own name from the list twice from the same phone", () => {
  it("a double tap is ok and flagged as a repeat (same time, no second alert); another phone is still refused", async () => {
    const c = await collection();
    const ravi = c.entry("Ravi");
    const first = await markPaid(c.code, { entryId: ravi }, "phone-ravi");
    if (!first.ok) throw new Error(first.error);
    const again = await markPaid(c.code, { entryId: ravi }, "phone-ravi");
    expect(again).toMatchObject({ ok: true, entryId: ravi, repeat: true });
    if (again.ok) expect(again.paidAt.getTime()).toBe(first.paidAt.getTime());
    const other = await markPaid(c.code, { entryId: ravi }, "phone-other");
    expect(other).toEqual({ ok: false, error: "Ravi is already marked as paid." });
    expect((await row(ravi)).amount).toBe(30000); // still the one tick of 30000
  });

  it("an 'any amount' list: the same amount again is a resend; a different amount is not (today's refusal), and the saved amount stays", async () => {
    const c = await collection({ amount: "" });
    const ravi = c.entry("Ravi");
    const first = await markPaid(c.code, { entryId: ravi, amount: "250" }, "phone-ravi");
    if (!first.ok) throw new Error(first.error);
    expect(await markPaid(c.code, { entryId: ravi, amount: "250" }, "phone-ravi")).toMatchObject({ ok: true, repeat: true });
    expect(await markPaid(c.code, { entryId: ravi, amount: "400" }, "phone-ravi")).toEqual({ ok: false, error: "Ravi is already marked as paid." });
    expect((await row(ravi)).amount).toBe(25000);
  });
});

