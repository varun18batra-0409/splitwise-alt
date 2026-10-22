import { db } from "./db";
import { cleanNames, sameName } from "./names";
import { parseAmount } from "./money";
import { MAX_ENTRIES, checkNewCollection, newCollectCode, type NewCollection } from "./collect-rules";

export * from "./collect-rules";

// "Collect": one person gathers money from many. Everyone pays the organiser
// directly (UPI, PayPal, cash…); Loopin never touches the money. It only keeps
// the list: who's expected, who says they've paid, and who the organiser has
// checked. The pure rules are in collect-rules.ts; this is the saving part.

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

// ---------- Database ----------

// The organiser's name is shown on the public page, so it must be a name they chose (never their email).
export async function createCollection(account: { id: string; name: string }, input: NewCollection) {
  const r = checkNewCollection(input);
  if (!r.ok) return r;
  const organiser = cleanNames([account.name])[0];
  if (!organiser) return { ok: false as const, error: "Add your name, so people know who’s collecting." };
  const c = await db.collection.create({
    data: { ...r.data, code: newCollectCode(), accountId: account.id, organiser, entries: { create: r.names.map((name) => ({ name, status: "due" })) } },
  });
  return { ok: true as const, code: c.code };
}

export async function loadCollection(code: string) {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(code)) return null;
  const c = await db.collection.findUnique({ where: { code }, include: { entries: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  return c && !c.deletedAt ? c : null;
}

// Someone says they've paid: their name from the list (or a new one), and how much.
export async function markPaid(code: string, input: { entryId?: string; name?: string; amount?: string }, payerKey: string): Promise<Ok<{ entryId: string }> | Fail> {
  const c = await loadCollection(code);
  if (!c) return { ok: false, error: "This collection isn’t there any more." };
  if (c.closedAt) return { ok: false, error: `${c.organiser} has closed this collection.` };
  let amount = c.amount;
  if (!amount) {
    const a = parseAmount(String(input.amount ?? ""), c.currency);
    if (a === null) return { ok: false, error: "Enter how much you paid." };
    amount = a;
  }
  if (input.entryId) {
    const e = c.entries.find((x) => x.id === input.entryId);
    if (!e) return { ok: false, error: "Pick your name from the list." };
    if (e.status !== "due") return { ok: false, error: `${e.name} is already marked as paid.` };
    const done = await db.collectionEntry.updateMany({ where: { id: e.id, status: "due" }, data: { status: "paid", amount, method: c.currency === "INR" && c.upiId ? "upi" : "other", payerKey, paidAt: new Date() } });
    if (done.count !== 1) return { ok: false, error: `${e.name} is already marked as paid.` };
    return { ok: true, entryId: e.id };
  }
  const name = cleanNames([String(input.name ?? "")])[0];
  if (!name) return { ok: false, error: "Type your name, so the organiser knows who paid." };
  const twin = c.entries.find((x) => sameName(x.name, name));
  if (twin && twin.status === "due") return markPaid(code, { entryId: twin.id, amount: input.amount }, payerKey);
  if (twin) return { ok: false, error: `${twin.name} is already on the list as paid. Add your surname or initial if you’re someone else.` };
  if (c.entries.length >= MAX_ENTRIES) return { ok: false, error: "This list is full." };
  const e = await db.collectionEntry.create({ data: { collectionId: c.id, name, amount, status: "paid", method: c.currency === "INR" && c.upiId ? "upi" : "other", payerKey, paidAt: new Date() } });
  return { ok: true, entryId: e.id };
}

// "I haven't paid after all": the payer takes back their own tick (until it's checked).
export async function undoPaid(code: string, entryId: string, payerKey: string): Promise<Ok<object> | Fail> {
  const c = await loadCollection(code);
  const e = c?.entries.find((x) => x.id === entryId);
  if (!c || !e || !payerKey || e.payerKey !== payerKey) return { ok: false, error: "Only the phone that ticked it can undo it." };
  if (e.status === "confirmed") return { ok: false, error: `${c.organiser} has already checked this payment. Ask them to change it.` };
  await db.collectionEntry.update({ where: { id: e.id }, data: { status: "due", amount: 0, payerKey: "", paidAt: null, method: "" } });
  return { ok: true };
}

// The organiser's controls.
export async function organiserAction(
  code: string,
  accountId: string,
  action: { kind: "confirm" | "unconfirm" | "remove" | "cash" | "add" | "close" | "reopen" | "delete"; entryId?: string; names?: string },
): Promise<Ok<object> | Fail> {
  const c = await loadCollection(code);
  if (!c || c.accountId !== accountId) return { ok: false, error: "Only the organiser can change this collection." };
  const e = action.entryId ? c.entries.find((x) => x.id === action.entryId) : undefined;
  switch (action.kind) {
    case "confirm":
      if (!e || e.status === "due") return { ok: false, error: "Nothing to check there." };
      await db.collectionEntry.update({ where: { id: e.id }, data: { status: "confirmed", confirmedAt: new Date() } });
      return { ok: true };
    case "unconfirm":
      if (!e || e.status !== "confirmed") return { ok: false, error: "Nothing to change there." };
      await db.collectionEntry.update({ where: { id: e.id }, data: { status: "paid", confirmedAt: null } });
      return { ok: true };
    case "cash":
      if (!e || e.status !== "due") return { ok: false, error: "They’re already marked as paid." };
      if (!c.amount) return { ok: false, error: "For “any amount” collections, ask them to tick their own amount." };
      await db.collectionEntry.update({ where: { id: e.id }, data: { status: "confirmed", amount: c.amount, method: "cash", paidAt: new Date(), confirmedAt: new Date() } });
      return { ok: true };
    case "remove":
      if (!e) return { ok: false, error: "That name isn’t on the list." };
      await db.collectionEntry.delete({ where: { id: e.id } });
      return { ok: true };
    case "add": {
      const names = cleanNames(String(action.names ?? "").split(/[\n,]+/)).filter((n) => !c.entries.some((x) => sameName(x.name, n)));
      if (!names.length) return { ok: false, error: "Type names that aren’t on the list yet." };
      if (c.entries.length + names.length > MAX_ENTRIES) return { ok: false, error: `A collection can have up to ${MAX_ENTRIES} people.` };
      await db.collectionEntry.createMany({ data: names.map((name) => ({ collectionId: c.id, name, status: "due" })) });
      return { ok: true };
    }
    case "close":
      await db.collection.update({ where: { id: c.id }, data: { closedAt: new Date() } });
      return { ok: true };
    case "reopen":
      await db.collection.update({ where: { id: c.id }, data: { closedAt: null } });
      return { ok: true };
    case "delete":
      await db.collection.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
      return { ok: true };
  }
}

// Home: the collections I organise (open first, newest first).
export async function myCollections(accountId: string) {
  const list = await db.collection.findMany({
    where: { accountId, deletedAt: null },
    include: { entries: { select: { name: true, amount: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return list.sort((a, b) => Number(Boolean(a.closedAt)) - Number(Boolean(b.closedAt)));
}

