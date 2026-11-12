import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { netBalances } from "@/lib/balances";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import { changeGroupCurrency } from "@/lib/group-changes";
import { parseUndo } from "@/lib/events";
import { REVERT_CLASH, revertExpense, undoEvent } from "@/lib/undo";
import { splitByItems } from "@/lib/item-split";
import { createCollection, loadCollection, markPaid, organiserAction, undoPaid } from "@/lib/collect";
import { addListItem, buyListItems, LIST_CHANGED, toggleListItem } from "@/lib/home/list-db";
import { deleteAccount } from "@/lib/auth";
import type { RateAnswer } from "@/lib/rate-cache";

// Second-server races for undo, collections, the shopping list and erasing data. The other server's change runs from
// inside the first one's `afterRead` hook (the gap between reading and writing). Amounts are in paise.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let counter = 0;
const groups: string[] = [];
const accountIds: string[] = [];
const trashKeys: string[] = [];
afterAll(async () => {
  await eraseGroups(groups);
  await db.blobTrash.deleteMany({ where: { key: { in: trashKeys } } });
  await db.postcard.deleteMany({ where: { OR: [{ fromId: { in: accountIds } }, { toId: { in: accountIds } }] } });
  await db.collection.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

const rate1 = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-11-12" });
const draft = (groupId: string, paidById: string, over: Partial<SaveExpenseInput> = {}): SaveExpenseInput => ({
  groupId, name: "Dinner", category: "", amount: "1000", currency: "INR", paidById, forMode: "everyone",
  selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
  markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
});

async function make(names: string[], o: { type?: string } = {}) {
  const n = ++counter;
  const g = await db.group.create({
    data: { name: `Integrity ${n} ${stamp}`, type: o.type ?? "other", currency: "INR", inviteCode: `integ-${n}-${stamp}`, members: { create: names.map((name) => ({ name })) } },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  groups.push(g.id);
  return { id: g.id, ids: Object.fromEntries(g.members.map((m) => [m.name, m.id])) as Record<string, string> };
}
async function net(groupId: string) {
  const members = await db.member.findMany({ where: { groupId }, select: { id: true } });
  const [expenses, payments] = await Promise.all([
    db.expense.findMany({ where: { groupId, deletedAt: null }, include: { shares: true } }),
    db.payment.findMany({ where: { groupId, deletedAt: null } }),
  ]);
  return netBalances(members.map((m) => m.id), expenses, payments);
}
async function invariants(groupId: string) {
  for (const e of await db.expense.findMany({ where: { groupId }, include: { shares: true } })) expect(e.shares.reduce((s, x) => s + x.amount, 0)).toBe(e.amount);
  expect(Object.values(await net(groupId)).reduce((s, v) => s + v, 0)).toBe(0);
}
async function account(name: string) {
  const a = await db.account.create({ data: { email: `integ-${++counter}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}

describe("SEC-02: undo puts back the bill's item lines too", () => {
  // Pizza 60000 shared by Asha and Bina, Beer 40000 for Bina: Asha 30000, Bina 70000 (total 100000). Asha paid.
  async function bill() {
    const g = await make(["Asha", "Bina"]);
    const { Asha: a, Bina: b } = g.ids;
    const items = [{ name: "Pizza", amount: 60000, people: [a, b] }, { name: "Beer", amount: 40000, people: [b] }];
    const split = (asha: string, bina: string): Partial<SaveExpenseInput> => ({ forMode: "selected", selected: [a, b], splitType: "exact", exact: { [a]: asha, [b]: bina } });
    const first = await saveExpense(draft(g.id, a, split("300", "700")), a, rate1, { attach: { items } });
    if (!first.ok) throw new Error(first.error);
    return { g, a, b, items, split, expenseId: first.id };
  }
  const shares = async (expenseId: string) => Object.fromEntries((await db.expenseShare.findMany({ where: { expenseId } })).map((s) => [s.memberId, s.amount]));
  const lines = async (expenseId: string) => (await db.expenseItem.findMany({ where: { expenseId }, orderBy: [{ position: "asc" }, { id: "asc" }] })).map((i) => ({ name: i.name, amount: i.amount, people: JSON.parse(i.people) as string[] }));

  it("editing Beer to Asha then undoing restores the shares AND the Beer line; redo goes forward again", async () => {
    const w = await bill();
    const edit = await saveExpense({ ...draft(w.g.id, w.a, w.split("700", "300")), expenseId: w.expenseId }, w.a, rate1, {
      attach: { items: [w.items[0], { name: "Beer", amount: 40000, people: [w.a] }] },
    });
    if (!edit.ok) throw new Error(edit.error);
    expect(await shares(w.expenseId)).toEqual({ [w.a]: 70000, [w.b]: 30000 });
    expect((await lines(w.expenseId))[1].people).toEqual([w.a]);

    const undone = await undoEvent(edit.eventId!, w.a);
    if (!undone.ok) throw new Error(undone.error);
    expect(await shares(w.expenseId)).toEqual({ [w.a]: 30000, [w.b]: 70000 });
    const back = await lines(w.expenseId);
    expect(back.map((l) => [l.name, l.amount, l.people])).toEqual([["Pizza", 60000, [w.a, w.b]], ["Beer", 40000, [w.b]]]);
    // Reopening and saving would change nothing: the lines split the bill exactly as the shares do.
    const again = splitByItems(back, 100000);
    expect(again.ok && again.amounts).toEqual({ [w.a]: 30000, [w.b]: 70000 });
    expect(await net(w.g.id)).toEqual({ [w.a]: 70000, [w.b]: -70000 });
    await invariants(w.g.id);

    const redone = await undoEvent(undone.eventId!, w.a); // redo
    if (!redone.ok) throw new Error(redone.error);
    expect(await shares(w.expenseId)).toEqual({ [w.a]: 70000, [w.b]: 30000 });
    expect((await lines(w.expenseId))[1].people).toEqual([w.a]);
    expect(await net(w.g.id)).toEqual({ [w.a]: 30000, [w.b]: -30000 });
    await invariants(w.g.id);
  });

  it("an edit that changes only the item lines is logged ('Item lines changed') and undo brings the old lines back", async () => {
    const w = await bill();
    const edit = await saveExpense({ ...draft(w.g.id, w.a, w.split("300", "700")), expenseId: w.expenseId }, w.a, rate1, {
      // Beer 40000 is now two lines (Beer 20000 + Chips 20000), both for Bina: the shares stay 30000 / 70000.
      attach: { items: [w.items[0], { name: "Beer", amount: 20000, people: [w.b] }, { name: "Chips", amount: 20000, people: [w.b] }] },
    });
    if (!edit.ok) throw new Error(edit.error);
    const ev = await db.groupEvent.findUniqueOrThrow({ where: { id: edit.eventId! } });
    expect([ev.kind, JSON.parse(ev.details)]).toEqual(["expense_edited", ["Item lines changed"]]);
    expect((await lines(w.expenseId)).map((l) => l.name)).toEqual(["Pizza", "Beer", "Chips"]);
    expect((await undoEvent(edit.eventId!, w.a)).ok).toBe(true);
    expect((await lines(w.expenseId)).map((l) => [l.name, l.amount])).toEqual([["Pizza", 60000], ["Beer", 40000]]);
    await invariants(w.g.id);
  });

  it("an edit that changes only the bill photo is logged with no undo", async () => {
    const w = await bill();
    const rec = await db.receipt.create({ data: { groupId: w.g.id, data: Buffer.from([1, 2, 3]), type: "image/jpeg" } });
    const edit = await saveExpense({ ...draft(w.g.id, w.a, w.split("300", "700")), expenseId: w.expenseId }, w.a, rate1, { attach: { receiptId: rec.id } });
    if (!edit.ok) throw new Error(edit.error);
    const ev = await db.groupEvent.findUniqueOrThrow({ where: { id: edit.eventId! } });
    expect([ev.kind, ev.text, ev.undo]).toEqual(["expense_edited", "changed the bill photo on Dinner", ""]);
    expect((await db.receipt.findUniqueOrThrow({ where: { id: rec.id } })).expenseId).toBe(w.expenseId);
  });

  it("an older undo payload with no item lines clears the lines (they would no longer match the shares)", async () => {
    const w = await bill();
    const edit = await saveExpense({ ...draft(w.g.id, w.a, w.split("700", "300")), expenseId: w.expenseId }, w.a, rate1, {
      attach: { items: [w.items[0], { name: "Beer", amount: 40000, people: [w.a] }] },
    });
    if (!edit.ok) throw new Error(edit.error);
    const p = parseUndo((await db.groupEvent.findUniqueOrThrow({ where: { id: edit.eventId! } })).undo);
    if (p?.type !== "expense_revert") throw new Error("not a revert");
    const { items: _dropped, ...old } = p.before; // what a change saved before item lines were kept looks like
    void _dropped;
    expect((await revertExpense(w.expenseId, old, w.a)).ok).toBe(true);
    expect(await shares(w.expenseId)).toEqual({ [w.a]: 30000, [w.b]: 70000 });
    expect(await db.expenseItem.count({ where: { expenseId: w.expenseId } })).toBe(0);
    await invariants(w.g.id);
  });

  it("an edit made in the undo's gap: the undo is refused and the newer edit stays", async () => {
    const w = await bill();
    const edit = await saveExpense({ ...draft(w.g.id, w.a, w.split("700", "300")), expenseId: w.expenseId }, w.a, rate1);
    if (!edit.ok) throw new Error(edit.error);
    const p = parseUndo((await db.groupEvent.findUniqueOrThrow({ where: { id: edit.eventId! } })).undo);
    if (p?.type !== "expense_revert") throw new Error("not a revert");
    const r = await revertExpense(w.expenseId, p.before, w.a, {
      afterRead: async () => {
        const e = await saveExpense({ ...draft(w.g.id, w.a, { amount: "1200", ...w.split("800", "400") }), expenseId: w.expenseId }, w.b, rate1);
        expect(e.ok).toBe(true);
      },
    });
    expect(r).toEqual({ ok: false, error: REVERT_CLASH });
    expect(REVERT_CLASH).toBe("Someone changed this expense a moment ago, so it wasn’t undone. Open it again to see the latest version.");
    expect((await db.expense.findUniqueOrThrow({ where: { id: w.expenseId } })).amount).toBe(120000);
    await invariants(w.g.id);
  });

  it("the group changing currency in the undo's gap: the undo is refused", async () => {
    const w = await bill();
    const edit = await saveExpense({ ...draft(w.g.id, w.a, w.split("700", "300")), expenseId: w.expenseId }, w.a, rate1);
    if (!edit.ok) throw new Error(edit.error);
    const p = parseUndo((await db.groupEvent.findUniqueOrThrow({ where: { id: edit.eventId! } })).undo);
    if (p?.type !== "expense_revert") throw new Error("not a revert");
    const r = await revertExpense(w.expenseId, p.before, w.a, { afterRead: async () => void (await changeGroupCurrency(w.g.id, w.a, "USD", "0.012")) });
    expect(r.ok).toBe(false);
    expect(await shares(w.expenseId)).toEqual({ [w.a]: 840, [w.b]: 360 }); // 70000 and 30000 paise × 0.012 = $8.40 and $3.60, untouched by the refused undo
    await invariants(w.g.id);
  });
});

describe("SEC-03: collection ticks, checks and undo can't overwrite each other", () => {
  const form = { title: "Farewell gift", note: "", currency: "INR", amount: "300", dueDate: "", upiId: "", payLink: "", names: "Ravi\nMeera" };
  async function collection(over: Partial<typeof form> = {}) {
    const asha = await account("Asha");
    const made = await createCollection(asha, { ...form, ...over });
    if (!made.ok) throw new Error("collection failed");
    const c = (await loadCollection(made.code))!;
    return { asha, code: made.code, entry: (name: string) => c.entries.find((e) => e.name === name)!.id };
  }
  const entryNow = async (id: string) => db.collectionEntry.findUniqueOrThrow({ where: { id } });

  it("the organiser confirms during the payer's undo: the undo is refused and the entry stays confirmed at 30000", async () => {
    const c = await collection();
    const ravi = c.entry("Ravi");
    expect((await markPaid(c.code, { entryId: ravi }, "phone-ravi")).ok).toBe(true);
    const r = await undoPaid(c.code, ravi, "phone-ravi", { afterRead: async () => void (await organiserAction(c.code, c.asha.id, { kind: "confirm", entryId: ravi })) });
    expect(r).toEqual({ ok: false, error: "Asha checked this payment just now, so it can’t be undone here. Ask them to change it." });
    const e = await entryNow(ravi);
    expect([e.status, e.amount]).toEqual(["confirmed", 30000]);
  });

  it("the payer undoes during the organiser's confirm: the confirm is refused, no notification, entry back to due at 0", async () => {
    const c = await collection();
    const ravi = c.entry("Ravi");
    const friend = await account("Ravi on Loopin");
    expect((await markPaid(c.code, { entryId: ravi, viewerAccountId: friend.id }, "phone-ravi")).ok).toBe(true);
    const r = await organiserAction(c.code, c.asha.id, { kind: "confirm", entryId: ravi }, { afterRead: async () => void (await undoPaid(c.code, ravi, "phone-ravi")) });
    expect(r).toEqual({ ok: false, error: "This payment changed just now. Check the list again." });
    expect("notify" in r).toBe(false);
    const e = await entryNow(ravi);
    expect([e.status, e.amount]).toEqual(["due", 0]);
  });

  it("the payer undoes and ticks again with 40000 during the confirm (any-amount collection): the confirm is refused", async () => {
    const c = await collection({ amount: "" });
    const ravi = c.entry("Ravi");
    expect((await markPaid(c.code, { entryId: ravi, amount: "300" }, "phone-ravi")).ok).toBe(true);
    const r = await organiserAction(c.code, c.asha.id, { kind: "confirm", entryId: ravi }, {
      afterRead: async () => {
        expect((await undoPaid(c.code, ravi, "phone-ravi")).ok).toBe(true);
        expect((await markPaid(c.code, { entryId: ravi, amount: "400" }, "phone-ravi")).ok).toBe(true);
      },
    });
    expect(r.ok).toBe(false);
    const e = await entryNow(ravi);
    expect([e.status, e.amount]).toEqual(["paid", 40000]); // the new tick is untouched and still waits for a check
  });

  it("removing a name while that person ticks it: the remove is refused and the tick stays", async () => {
    const c = await collection();
    const meera = c.entry("Meera");
    const r = await organiserAction(c.code, c.asha.id, { kind: "remove", entryId: meera }, { afterRead: async () => void (await markPaid(c.code, { entryId: meera }, "phone-meera")) });
    expect(r).toEqual({ ok: false, error: "This payment changed just now. Check the list again." });
    expect((await entryNow(meera)).status).toBe("paid");
  });

  it("confirm tapped twice at the same moment: one notification in total", async () => {
    const c = await collection();
    const ravi = c.entry("Ravi");
    const friend = await account("Ravi on Loopin");
    await markPaid(c.code, { entryId: ravi, viewerAccountId: friend.id }, "phone-ravi");
    const seen: Awaited<ReturnType<typeof organiserAction>>[] = [];
    const outer = await organiserAction(c.code, c.asha.id, { kind: "confirm", entryId: ravi }, {
      afterRead: async () => void seen.push(await organiserAction(c.code, c.asha.id, { kind: "confirm", entryId: ravi })),
    });
    const notes = [...seen, outer].flatMap((r) => (r.ok ? r.notify ?? [] : []));
    expect(notes).toHaveLength(1);
    expect((await entryNow(ravi)).status).toBe("confirmed");
  });
});

describe("SEC-04: the shopping list links its items in the same step as the expense", () => {
  async function list() {
    const g = await make(["You", "Asha", "Meera"], { type: "home" });
    const a = await addListItem(g.id, g.ids.You, "Milk");
    const b = await addListItem(g.id, g.ids.You, "Onions");
    if (!a.ok || !b.ok) throw new Error("add failed");
    await toggleListItem(g.id, g.ids.You, a.id);
    await toggleListItem(g.id, g.ids.You, b.id);
    return { g, you: g.ids.You, itemA: a.id, itemB: b.id };
  }

  it("linking fails (an item is un-ticked in the gap): no expense, no key, items unlinked; a retry with the same key makes one expense with every item linked", async () => {
    const w = await list();
    const k = `buy-${stamp}-${++counter}-abcdefgh`;
    const r = await buyListItems(w.g.id, w.you, "450", k, { afterRead: async () => void (await toggleListItem(w.g.id, w.you, w.itemB)) });
    expect(r).toEqual({ ok: false, error: LIST_CHANGED });
    expect(LIST_CHANGED).toBe("These items were just added as an expense by someone else. Check the list.");
    expect(await db.expense.count({ where: { groupId: w.g.id } })).toBe(0);
    expect(await db.requestKey.count({ where: { key: k } })).toBe(0);
    expect(await db.listItem.count({ where: { groupId: w.g.id, expenseId: "" } })).toBe(2);
    // The person ticks it again and taps Buy again (same screen, same key).
    await toggleListItem(w.g.id, w.you, w.itemB);
    const again = await buyListItems(w.g.id, w.you, "450", k);
    expect(again.ok).toBe(true);
    const e = await db.expense.findMany({ where: { groupId: w.g.id }, include: { shares: true } });
    expect(e).toHaveLength(1);
    expect(e[0].shares.map((s) => s.amount)).toEqual([15000, 15000, 15000]); // ₹450 over three equal weights; adds up to 45000
    expect(e[0].amount).toBe(45000);
    expect(await db.listItem.count({ where: { groupId: w.g.id, expenseId: e[0].id } })).toBe(2);
  });

  it("two buys with different keys: B commits during A's gap, so exactly one Groceries expense exists and A is refused", async () => {
    const w = await list();
    const kA = `buy-${stamp}-${++counter}-aaaaaaaa`;
    const kB = `buy-${stamp}-${++counter}-bbbbbbbb`;
    const bResults: Awaited<ReturnType<typeof buyListItems>>[] = [];
    const a = await buyListItems(w.g.id, w.you, "450", kA, { afterRead: async () => void bResults.push(await buyListItems(w.g.id, w.you, "450", kB)) });
    expect(a).toEqual({ ok: false, error: LIST_CHANGED });
    expect(bResults.map((r) => r.ok)).toEqual([true]);
    const e = await db.expense.findMany({ where: { groupId: w.g.id, category: "groceries" } });
    expect(e).toHaveLength(1);
    expect(await db.listItem.count({ where: { groupId: w.g.id, expenseId: e[0].id } })).toBe(2);
    expect(await db.requestKey.count({ where: { key: kA } })).toBe(0);
    await invariants(w.g.id);
  });
});

describe("SEC-07: erasing a group or an account catches photo keys set in the gap", () => {
  const k = (name: string) => {
    const key = `${name}-${stamp}`;
    trashKeys.push(key);
    return key;
  };

  it("group erase: a receipt whose file key is set during the erase still has its file queued for deletion", async () => {
    const g = await make(["Ann"]);
    const rec = await db.receipt.create({ data: { groupId: g.id, data: Buffer.from([1, 2]), type: "image/jpeg" } });
    const key = k("receipt/K1");
    await eraseGroups([g.id], { afterRead: async () => void (await db.receipt.update({ where: { id: rec.id }, data: { blobKey: key } })) });
    expect(await db.blobTrash.count({ where: { key } })).toBe(1);
    expect(await db.receipt.count({ where: { id: rec.id } })).toBe(0);
    expect(await db.group.count({ where: { id: g.id } })).toBe(0);
  });

  async function twoAccounts() {
    const from = await account("Sender");
    const to = await account("Receiver");
    return { from, to };
  }

  it("account deletion: a postcard photo whose key is set during the deletion is queued and its row is gone", async () => {
    const { from, to } = await twoAccounts();
    const photo = await db.postcardPhoto.create({ data: { data: Buffer.from([1]), type: "image/webp" } });
    await db.postcard.create({ data: { fromId: from.id, toId: to.id, front: "own", photoId: photo.id, message: "hi" } });
    const key = k("postcard/K2");
    await deleteAccount(from.id, { afterRead: async () => void (await db.postcardPhoto.update({ where: { id: photo.id }, data: { blobKey: key } })) });
    expect(await db.blobTrash.count({ where: { key } })).toBe(1);
    expect(await db.postcardPhoto.count({ where: { id: photo.id } })).toBe(0);
    expect(await db.postcard.count({ where: { fromId: from.id } })).toBe(0);
    expect(await db.account.count({ where: { id: from.id } })).toBe(0);
  });

  it("account deletion: a postcard sent during the deletion is removed too, and its photo key is queued", async () => {
    const { from, to } = await twoAccounts();
    const key = k("postcard/K3");
    let photoId = "";
    await deleteAccount(to.id, {
      afterRead: async () => {
        const photo = await db.postcardPhoto.create({ data: { data: Buffer.from([1]), type: "image/webp", blobKey: key } });
        photoId = photo.id;
        await db.postcard.create({ data: { fromId: from.id, toId: to.id, front: "own", photoId: photo.id, message: "late" } });
      },
    });
    expect(await db.postcard.count({ where: { toId: to.id } })).toBe(0);
    expect(await db.postcardPhoto.count({ where: { id: photoId } })).toBe(0);
    expect(await db.blobTrash.count({ where: { key } })).toBe(1);
  });
});

describe("SEC-K01: deleting an account stops notifications on the other phones", () => {
  async function phones() {
    const acc = await account("Phoned");
    const g1 = await make(["One"]);
    const g2 = await make(["Two"]);
    const members = [g1.ids.One, g2.ids.Two];
    await db.member.updateMany({ where: { id: { in: members } }, data: { accountId: acc.id } });
    for (const memberId of members) for (const endpoint of ["https://push.example/E1", "https://push.example/E2"]) {
      await db.pushSubscription.create({ data: { memberId, endpoint, p256dh: "p", auth: "a" } });
    }
    return { acc, members };
  }

  it("with this phone's address (E1): only the E1 rows remain, on both people", async () => {
    const w = await phones();
    await deleteAccount(w.acc.id, { keepEndpoint: "https://push.example/E1" });
    const rows = await db.pushSubscription.findMany({ where: { memberId: { in: w.members } } });
    expect(rows.map((r) => r.endpoint)).toEqual(["https://push.example/E1", "https://push.example/E1"]);
    expect(rows.map((r) => r.memberId).sort()).toEqual([...w.members].sort());
    expect((await db.member.findMany({ where: { id: { in: w.members } } })).every((m) => m.accountId === null)).toBe(true);
  });

  it("with no address: every row is removed", async () => {
    const w = await phones();
    await deleteAccount(w.acc.id);
    expect(await db.pushSubscription.count({ where: { memberId: { in: w.members } } })).toBe(0);
  });

  it("the privacy page says so", () => {
    const text = readFileSync(path.resolve(__dirname, "..", "src/app/privacy/page.tsx"), "utf8");
    expect(text).toContain("Deleting your email also stops notifications on your other phones.");
  });
});
