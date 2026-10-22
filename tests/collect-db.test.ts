import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { deleteAccount } from "@/lib/auth";
import { createCollection, loadCollection, markPaid, myCollections, organiserAction, undoPaid } from "@/lib/collect";

// Collect against a real database: make one, people tick, the organiser
// checks; nobody else can change it; deleting the account removes it.
const emails: string[] = [];
async function organiser(name = "Asha") {
  const email = `collect-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  emails.push(email);
  return db.account.create({ data: { email, name } });
}
const form = { title: "Farewell gift", note: "", currency: "INR", amount: "300", dueDate: "", upiId: "asha@okicici", payLink: "", names: "Ravi\nMeera" };

afterAll(async () => {
  const accs = await db.account.findMany({ where: { email: { in: emails } } });
  await db.collection.deleteMany({ where: { accountId: { in: accs.map((a) => a.id) } } });
  await db.account.deleteMany({ where: { email: { in: emails } } });
});

describe("Collect (real database)", () => {
  it("make it, people tick their names, the organiser checks them off", async () => {
    const asha = await organiser();
    const made = await createCollection(asha, form);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    let c = (await loadCollection(made.code))!;
    expect(c.organiser).toBe("Asha");
    const by = (name: string) => c.entries.find((e) => e.name === name)!;
    expect(c.entries.map((e) => [e.name, e.status]).sort()).toEqual([
      ["Meera", "due"],
      ["Ravi", "due"],
    ]);

    // Ravi picks his name; a second tick for him is refused.
    const ravi = by("Ravi");
    const meeraId = by("Meera").id;
    expect((await markPaid(made.code, { entryId: ravi.id }, "phone-ravi")).ok).toBe(true);
    expect((await markPaid(made.code, { entryId: ravi.id }, "phone-other")).ok).toBe(false);

    // Someone not on the list adds themselves; typing an existing due name ticks that one instead.
    const kabir = await markPaid(made.code, { name: "Kabir" }, "phone-kabir");
    expect(kabir.ok).toBe(true);
    const meera = await markPaid(made.code, { name: " meera " }, "phone-meera");
    expect(meera.ok && meera.entryId).toBe(meeraId);

    c = (await loadCollection(made.code))!;
    expect(c.entries.map((e) => [e.name, e.status, e.amount]).sort()).toEqual([
      ["Kabir", "paid", 30000],
      ["Meera", "paid", 30000],
      ["Ravi", "paid", 30000],
    ]);

    // Only the phone that ticked can undo it.
    expect((await undoPaid(made.code, ravi.id, "phone-other")).ok).toBe(false);
    expect((await undoPaid(made.code, ravi.id, "phone-ravi")).ok).toBe(true);
    expect((await loadCollection(made.code))!.entries.find((e) => e.id === ravi.id)).toMatchObject({ status: "due", amount: 0 });

    // The organiser: cash for Ravi, check Meera; someone else can't touch it.
    const other = await organiser("Not Asha");
    expect((await organiserAction(made.code, other.id, { kind: "confirm", entryId: meeraId })).ok).toBe(false);
    expect((await organiserAction(made.code, asha.id, { kind: "cash", entryId: ravi.id })).ok).toBe(true);
    expect((await organiserAction(made.code, asha.id, { kind: "confirm", entryId: meeraId })).ok).toBe(true);
    // A checked payment can't be undone by the payer any more.
    expect((await undoPaid(made.code, meeraId, "phone-meera")).ok).toBe(false);

    // Closed: no more ticks. Reopened: ticks again.
    await organiserAction(made.code, asha.id, { kind: "close" });
    expect((await markPaid(made.code, { name: "Zoya" }, "phone-zoya")).ok).toBe(false);
    await organiserAction(made.code, asha.id, { kind: "reopen" });
    expect((await markPaid(made.code, { name: "Zoya" }, "phone-zoya")).ok).toBe(true);

    const mine = await myCollections(asha.id);
    expect(mine.map((x) => x.code)).toEqual([made.code]);
    expect(mine[0].entries.filter((e) => e.status !== "due")).toHaveLength(4);

    // Deleted: the link stops working.
    await organiserAction(made.code, asha.id, { kind: "delete" });
    expect(await loadCollection(made.code)).toBeNull();
  });

  it("'any amount' needs the payer's amount; no organiser name, no collection", async () => {
    const asha = await organiser();
    const made = await createCollection(asha, { ...form, amount: "", names: "" });
    if (!made.ok) throw new Error(made.error);
    expect((await markPaid(made.code, { name: "Ravi" }, "k1")).ok).toBe(false);
    const r = await markPaid(made.code, { name: "Ravi", amount: "250" }, "k1");
    expect(r.ok).toBe(true);
    expect((await loadCollection(made.code))!.entries[0].amount).toBe(25000);
    const nameless = await organiser("");
    expect((await createCollection(nameless, form)).ok).toBe(false);
  });

  it("deleting the organiser's account removes their collections", async () => {
    const asha = await organiser();
    const made = await createCollection(asha, form);
    if (!made.ok) throw new Error(made.error);
    await deleteAccount(asha.id);
    expect(await db.collection.count({ where: { code: made.code } })).toBe(0);
    expect(await db.collectionEntry.count({ where: { collection: { code: made.code } } })).toBe(0);
  });
});
