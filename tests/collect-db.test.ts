import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { deleteAccount } from "@/lib/auth";
import { createCollection, loadCollection, loopinFriends, markPaid, myCollections, organiserAction, undoPaid } from "@/lib/collect";
import { deliverNotes, loadNotes } from "@/lib/account-notes";

// Collect against a real database: make one, people tick, the organiser
// checks; nobody else can change it; deleting the account removes it.
const emails: string[] = [];
async function organiser(name = "Asha") {
  const email = `collect-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  emails.push(email);
  return db.account.create({ data: { email, name } });
}
const form = { title: "Farewell gift", note: "", currency: "INR", amount: "300", dueDate: "", upiId: "asha@okicici", payLink: "", names: "Ravi\nMeera" };

const groups: string[] = [];
afterAll(async () => {
  await db.member.deleteMany({ where: { groupId: { in: groups } } });
  await db.group.deleteMany({ where: { id: { in: groups } } });
  const accs = await db.account.findMany({ where: { email: { in: emails } } });
  await db.accountNote.deleteMany({ where: { accountId: { in: accs.map((a) => a.id) } } });
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

  it("numbers picked from contacts are kept for WhatsApp reminders (organiser only), also when adding later", async () => {
    const asha = await organiser();
    const made = await createCollection(asha, { ...form, names: "Ravi\nMeera", contacts: JSON.stringify([{ name: "Ravi", tel: "9876543210" }]) });
    if (!made.ok) throw new Error(made.error);
    let c = (await loadCollection(made.code))!;
    expect(Object.fromEntries(c.entries.map((e) => [e.name, e.phone]))).toEqual({ Ravi: "+919876543210", Meera: "" });
    // Adding: a new person with a number, and Meera's number filled in.
    const r = await organiserAction(made.code, asha.id, { kind: "add", names: "Kabir\nMeera", contacts: JSON.stringify([{ name: "Kabir", tel: "+447700900123" }, { name: "Meera", tel: "98765 00000" }]) });
    expect(r.ok).toBe(true);
    c = (await loadCollection(made.code))!;
    expect(Object.fromEntries(c.entries.map((e) => [e.name, e.phone]))).toEqual({ Ravi: "+919876543210", Meera: "+919876500000", Kabir: "+447700900123" });
  });

  it("Loopin friends: only people you share a group with; told in the app when added, reminded and paid", async () => {
    const asha = await organiser("Asha");
    const ravi = await organiser("Ravi");
    const stranger = await organiser("Stranger");
    const g = await db.group.create({ data: { name: "Flat", currency: "INR", inviteCode: `cf-${Date.now()}`, members: { create: [{ name: "Asha", accountId: asha.id }, { name: "Ravi", accountId: ravi.id }] } } });
    groups.push(g.id);
    expect((await loopinFriends(asha.id)).map((f) => f.name)).toEqual(["Ravi"]);

    const made = await createCollection(asha, { ...form, names: "Meera", friends: [ravi.id, stranger.id] });
    if (!made.ok) throw new Error(made.error);
    let c = (await loadCollection(made.code))!;
    expect(c.entries.map((e) => [e.name, e.accountId]).sort()).toEqual([["Meera", ""], ["Ravi", ravi.id]]); // never the stranger
    expect(made.notify.map((n) => [n.kind, n.accountIds])).toEqual([["collect_added", [ravi.id]]]);
    await deliverNotes(made.notify);
    expect((await loadNotes(ravi.id)).map((n) => n.body)).toEqual(["Asha added you: ₹300 each. Tap to pay and tick your name."]);
    expect(await loadNotes(stranger.id)).toEqual([]);

    const raviEntry = c.entries.find((e) => e.name === "Ravi")!;
    const nudge = await organiserAction(made.code, asha.id, { kind: "nudge", entryId: raviEntry.id });
    expect(nudge.ok && nudge.notify?.[0].kind).toBe("collect_reminder");
    // Meera isn't on Loopin: no in-app reminder for her.
    expect((await organiserAction(made.code, asha.id, { kind: "nudge", entryId: c.entries.find((e) => e.name === "Meera")!.id })).ok).toBe(false);

    // Meera opens the link while signed in to Loopin: linked when she ticks.
    const meera = await organiser("Meera");
    await markPaid(made.code, { name: "meera", viewerAccountId: meera.id, viewerName: meera.name }, "k-meera");
    c = (await loadCollection(made.code))!;
    const m = c.entries.find((e) => e.name === "Meera")!;
    expect(m.accountId).toBe(meera.id);
    const ok = await organiserAction(made.code, asha.id, { kind: "confirm", entryId: m.id });
    expect(ok.ok && ok.notify).toEqual([{ fromAccountId: asha.id, accountIds: [meera.id], kind: "collect_paid", title: "Farewell gift", body: "Asha got your ₹300 ✓ You’re all done.", url: `/c/${made.code}`, tag: `collect:${made.code}` }]);
  });

  it("adding a Loopin friend who's already on the list as paid doesn't ask them to pay", async () => {
    const asha = await organiser("Asha");
    const kabir = await organiser("Kabir");
    const g = await db.group.create({ data: { name: "Flat 2", currency: "INR", inviteCode: `cf2-${Date.now()}`, members: { create: [{ name: "Asha", accountId: asha.id }, { name: "Kabir", accountId: kabir.id }] } } });
    groups.push(g.id);
    const made = await createCollection(asha, { ...form, names: "Kabir" });
    if (!made.ok) throw new Error(made.error);
    await markPaid(made.code, { name: "Kabir" }, "k-kabir");
    const r = await organiserAction(made.code, asha.id, { kind: "add", names: "Zoya", friends: [kabir.id] });
    expect(r.ok).toBe(true);
    expect(r.ok && r.notify).toBeFalsy(); // Zoya isn't on Loopin; Kabir has already paid
    const c = (await loadCollection(made.code))!;
    expect(c.entries.map((e) => e.name).sort()).toEqual(["Kabir", "Zoya"]);
  });
  // SB-2: ticking a name links the entry to your account only when the name is yours (the same name as your account's).
  // sameName is strict: it trims and ignores capitals, nothing else, so "Asha" matches " asha " but not "Asha K".
  it("ticking someone else's name doesn't link the entry to you, and undo leaves it unlinked; ticking your own name links it", async () => {
    const org = await organiser("Organiser");
    const asha = await organiser("Asha");
    const made = await createCollection(org, { ...form, names: "Ravi\nAsha\nMeera" });
    if (!made.ok) throw new Error(made.error);
    const entry = async (name: string) => (await loadCollection(made.code))!.entries.find((e) => e.name === name)!;
    // Asha (signed in) ticks "Ravi": paid, but not linked to her.
    expect((await markPaid(made.code, { entryId: (await entry("Ravi")).id, viewerAccountId: asha.id, viewerName: asha.name }, "k-asha-ravi")).ok).toBe(true);
    let ravi = await entry("Ravi");
    expect([ravi.status, ravi.accountId, ravi.amount]).toEqual(["paid", "", 30000]);
    expect((await undoPaid(made.code, ravi.id, "k-asha-ravi")).ok).toBe(true);
    ravi = await entry("Ravi");
    expect([ravi.status, ravi.accountId, ravi.amount]).toEqual(["due", "", 0]);
    // Asha ticks "Asha": linked to her.
    expect((await markPaid(made.code, { entryId: (await entry("Asha")).id, viewerAccountId: asha.id, viewerName: asha.name }, "k-asha")).ok).toBe(true);
    expect((await entry("Asha")).accountId).toBe(asha.id);
    // Typing her own name (any capitals, spaces around) links; typing a new name that isn't hers doesn't.
    const meeraTick = await markPaid(made.code, { name: "  MEERA ", viewerAccountId: asha.id, viewerName: asha.name }, "k-asha-meera");
    expect(meeraTick.ok).toBe(true);
    expect((await entry("Meera")).accountId).toBe("");
    const typedNew = await markPaid(made.code, { name: "Kabir", viewerAccountId: asha.id, viewerName: asha.name }, "k-asha-kabir");
    expect(typedNew.ok).toBe(true);
    expect((await entry("Kabir")).accountId).toBe("");
    const typedHers = await db.collectionEntry.count({ where: { collection: { code: made.code }, accountId: asha.id } });
    expect(typedHers).toBe(1); // only her own line
    // Shares and totals are unchanged by who is linked: 3 ticks of ₹300 (Asha, Meera, Kabir), Ravi back to due.
    const c = (await loadCollection(made.code))!;
    expect(c.entries.filter((e) => e.status === "paid").reduce((t, e) => t + e.amount, 0)).toBe(30000 * 3);
    expect(c.entries.map((e) => [e.name, e.status]).sort()).toEqual([["Asha", "paid"], ["Kabir", "paid"], ["Meera", "paid"], ["Ravi", "due"]]);
  });

  it("a signed-in person with no name on their account, or a name that is only part of the entry's ('Asha' vs 'Asha K'), is not linked", async () => {
    const org = await organiser("Organiser");
    const nameless = await organiser("");
    const asha = await organiser("Asha");
    const made = await createCollection(org, { ...form, names: "Asha K\nZed" });
    if (!made.ok) throw new Error(made.error);
    const entry = async (name: string) => (await loadCollection(made.code))!.entries.find((e) => e.name === name)!;
    await markPaid(made.code, { entryId: (await entry("Asha K")).id, viewerAccountId: asha.id, viewerName: asha.name }, "k1");
    await markPaid(made.code, { entryId: (await entry("Zed")).id, viewerAccountId: nameless.id, viewerName: nameless.name }, "k2");
    expect((await entry("Asha K")).accountId).toBe("");
    expect((await entry("Zed")).accountId).toBe("");
    // No name given at all (an older caller): never linked.
    const made2 = await createCollection(org, { ...form, names: "Zed" });
    if (!made2.ok) throw new Error(made2.error);
    const z = (await loadCollection(made2.code))!.entries[0];
    await markPaid(made2.code, { entryId: z.id, viewerAccountId: asha.id }, "k3");
    expect((await loadCollection(made2.code))!.entries[0].accountId).toBe("");
  });

  it("an entry the organiser linked to a Loopin friend keeps its link after that friend ticks and undoes", async () => {
    const org = await organiser("Organiser");
    const ravi = await organiser("Ravi");
    const g = await db.group.create({ data: { name: "Flat 3", currency: "INR", inviteCode: `cf3-${Date.now()}`, members: { create: [{ name: "Organiser", accountId: org.id }, { name: "Ravi", accountId: ravi.id }] } } });
    groups.push(g.id);
    const made = await createCollection(org, { ...form, names: "Meera", friends: [ravi.id] });
    if (!made.ok) throw new Error(made.error);
    const e = (await loadCollection(made.code))!.entries.find((x) => x.name === "Ravi")!;
    expect(e.accountId).toBe(ravi.id);
    await markPaid(made.code, { entryId: e.id, viewerAccountId: ravi.id, viewerName: ravi.name }, "k-ravi");
    expect((await undoPaid(made.code, e.id, "k-ravi")).ok).toBe(true);
    expect((await loadCollection(made.code))!.entries.find((x) => x.name === "Ravi")!.accountId).toBe(ravi.id);
  });
});
