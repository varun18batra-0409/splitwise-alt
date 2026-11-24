import { mailSafe } from "./mail-safe";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { NOT_DIRECT } from "./direct"; // a pair of two people is not "sharing a group"
import { blockedEitherWay } from "./blocks";
import { JOINED } from "./membership";
import type { Note } from "./account-notes";
import { cleanNames, sameName } from "./names";
import { formatMoney, parseAmount } from "./money";
import { MAX_ENTRIES, checkNewCollection, newCollectCode, phonesFor, type NewCollection } from "./collect-rules";

export * from "./collect-rules";

// "Collect": one person gathers money from many. Everyone pays the organiser
// directly (UPI, PayPal, cash…); Loopin never touches the money. It only keeps
// the list: who's expected, who says they've paid, and who the organiser has
// checked. The pure rules are in collect-rules.ts; this is the saving part.

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

// In-app notifications for people on Loopin (sent by the caller, after answering).
export type CollectNote = Note;

// People you share a group with who are on Loopin (to add to a collection, for in-app notifications).
export async function loopinFriends(accountId: string): Promise<{ id: string; name: string }[]> {
  const mine = await db.member.findMany({ where: { accountId, leftAt: null, ...JOINED, group: { ...NOT_DIRECT, deletedAt: null } }, select: { groupId: true } });
  if (!mine.length) return [];
  const others = await db.member.findMany({
    where: { groupId: { in: mine.map((m) => m.groupId) }, leftAt: null, accountId: { not: null }, ...JOINED },
    select: { accountId: true, name: true },
  });
  // Not anyone this person blocked, nor anyone who blocked them: they can't be picked, so they can't be added or told.
  const blocked = await blockedEitherWay(accountId);
  const ids = [...new Set(others.map((o) => o.accountId!).filter((id) => id !== accountId && !blocked.has(id)))];
  if (!ids.length) return [];
  const accounts = await db.account.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return accounts
    .map((a) => ({ id: a.id, name: cleanNames([a.name || others.find((o) => o.accountId === a.id)?.name || ""])[0] ?? "" }))
    .filter((a) => a.name)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 200);
}

const each = (c: { amount: number; currency: string }) => (c.amount ? `${formatMoney(c.amount, c.currency)} each` : "chip in any amount");

// ---------- Database ----------

// The organiser's name is shown on the public page, so it must be a name they chose (never their email).
export async function createCollection(account: { id: string; name: string }, input: NewCollection & { friends?: string[] }) {
  const r = checkNewCollection(input);
  if (!r.ok) return r;
  const organiser = cleanNames([account.name])[0];
  if (!organiser) return { ok: false as const, error: "Add your name, so people know who’s collecting." };
  const phones = phonesFor(r.names, input.contacts ?? "", r.data.currency);
  // Loopin friends picked: on the list with their account (only people you really share a group with).
  const pickedIds = new Set(input.friends ?? []);
  const friends = pickedIds.size ? (await loopinFriends(account.id)).filter((f) => pickedIds.has(f.id)) : [];
  const rows = r.names.map((name) => ({ name, status: "due", phone: phones[name] ?? "", accountId: friends.find((f) => sameName(f.name, name))?.id ?? "" }));
  for (const f of friends) if (!rows.some((x) => x.accountId === f.id) && rows.length < MAX_ENTRIES) rows.push({ name: f.name, status: "due", phone: "", accountId: f.id });
  const code = newCollectCode();
  await db.collection.create({ data: { ...r.data, code, accountId: account.id, organiser, entries: { create: rows } } });
  const onList = [...new Set(rows.map((x) => x.accountId).filter(Boolean))];
  const notify: CollectNote[] = onList.length
    ? [{ fromAccountId: account.id, accountIds: onList, kind: "collect_added", title: r.data.title, body: `${organiser} added you: ${each(r.data)}. Tap to pay and tick your name.`, url: `/c/${code}`, tag: `collect:${code}` }]
    : [];
  return { ok: true as const, code, notify };
}

export async function loadCollection(code: string) {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(code)) return null;
  const c = await db.collection.findUnique({ where: { code }, include: { entries: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  return c && !c.deletedAt ? c : null;
}

// A collection that is closed (or deleted) takes no new ticks. The first statement of the transaction is a write that only matches
// while it is still open, so a close that landed after the page was read is seen here, and every read after it is current
// (the same idea as money-guard.ts). It changes nothing itself (closedAt stays null).
async function stillOpen(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
  return (await tx.collection.updateMany({ where: { id, closedAt: null, deletedAt: null }, data: { closedAt: null } })).count === 1;
}

// Someone says they've paid: their name from the list (or a new one), and how much.
// The list is read again inside the transaction (after the open check), so two people ticking the same name, or two new names at
// the last free place, are decided one at a time. `paidAt` is the tick's own time (its version, for the organiser's alert).
export async function markPaid(code: string, input: { entryId?: string; name?: string; amount?: string; viewerAccountId?: string; viewerName?: string }, payerKey: string, opts: Hooks = {}): Promise<Ok<{ entryId: string; paidAt: Date }> | Fail> {
  const c = await loadCollection(code);
  if (!c) return { ok: false, error: "This collection isn’t there any more." };
  const closedText = `${mailSafe(c.organiser)} has closed this collection.`;
  if (c.closedAt) return { ok: false, error: closedText };
  let amount = c.amount;
  if (!amount) {
    const a = parseAmount(String(input.amount ?? ""), c.currency);
    if (a === null) return { ok: false, error: "Enter how much you paid." };
    amount = a;
  }
  const typedName = input.entryId ? "" : cleanNames([String(input.name ?? "")])[0];
  if (!input.entryId && !typedName) return { ok: false, error: "Type your name, so the organiser knows who paid." };
  const method = c.currency === "INR" && c.upiId ? "upi" : "other";
  await opts.afterRead?.();
  return db.$transaction(async (tx): Promise<Ok<{ entryId: string; paidAt: Date }> | Fail> => {
    if (!(await stillOpen(tx, c.id))) return { ok: false, error: closedText };
    const entries = await tx.collectionEntry.findMany({ where: { collectionId: c.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    // Ticks one existing due name.
    const tick = async (e: (typeof entries)[number]): Promise<Ok<{ entryId: string; paidAt: Date }> | Fail> => {
      if (e.status !== "due") return { ok: false, error: `${mailSafe(e.name)} is already marked as paid.` };
      // Ticked by someone signed in to Loopin: they'll hear when it's checked. The entry is linked to their account only when the name
      // they ticked is theirs (the same name as their account's): ticking someone else's name never ties that entry to you.
      const who = !e.accountId && input.viewerAccountId && input.viewerAccountId !== c.accountId && input.viewerName && sameName(input.viewerName, e.name) ? { accountId: input.viewerAccountId } : {};
      const paidAt = new Date();
      const done = await tx.collectionEntry.updateMany({ where: { id: e.id, status: "due" }, data: { status: "paid", amount, method, payerKey, paidAt, ...who } });
      if (done.count !== 1) return { ok: false, error: `${mailSafe(e.name)} is already marked as paid.` };
      return { ok: true, entryId: e.id, paidAt };
    };
    if (input.entryId) {
      const e = entries.find((x) => x.id === input.entryId);
      if (!e) return { ok: false, error: "Pick your name from the list." };
      return tick(e);
    }
    const name = typedName!;
    const twin = entries.find((x) => sameName(x.name, name));
    if (twin && twin.status === "due") return tick(twin);
    if (twin) return { ok: false, error: `${mailSafe(twin.name)} is already on the list as paid. Add your surname or initial if you’re someone else.` };
    if (entries.length >= MAX_ENTRIES) return { ok: false, error: "This list is full." };
    // A name typed in is linked to the viewer's account only when it is their own name.
    const viewer = input.viewerAccountId && input.viewerAccountId !== c.accountId && input.viewerName && sameName(input.viewerName, name) ? input.viewerAccountId : "";
    const paidAt = new Date();
    const e = await tx.collectionEntry.create({ data: { collectionId: c.id, name, amount, status: "paid", method, payerKey, paidAt, accountId: viewer } });
    return { ok: true, entryId: e.id, paidAt };
  });
}

// The organiser's "X says they paid" alert is sent only while that very tick (its time is its version) is still waiting to be checked.
export async function tickStillStands(code: string, entryId: string, paidAt: Date) {
  const c = await loadCollection(code);
  const e = c?.entries.find((x) => x.id === entryId);
  if (!c || !e || e.status !== "paid" || e.paidAt?.getTime() !== paidAt.getTime()) return null;
  return { c, e };
}

// Tests only: runs after the reads and before the write (the gap in which the other person can act).
type Hooks = { afterRead?: () => Promise<void> };
const CHANGED = "This payment changed just now. Check the list again.";

// "I haven't paid after all": the payer takes back their own tick (until it's checked).
export async function undoPaid(code: string, entryId: string, payerKey: string, opts: Hooks = {}): Promise<Ok<object> | Fail> {
  const c = await loadCollection(code);
  const e = c?.entries.find((x) => x.id === entryId);
  if (!c || !e || !payerKey || e.payerKey !== payerKey) return { ok: false, error: "Only the device that ticked it can undo it." };
  if (e.status === "confirmed") return { ok: false, error: `${mailSafe(c.organiser)} has already checked this payment. Ask them to change it.` };
  await opts.afterRead?.();
  // Only the tick that was seen (its time is its version): if the organiser checked it, or it was ticked again, in the
  // meantime, this takes nothing back.
  const done = await db.collectionEntry.updateMany({ where: { id: e.id, status: "paid", payerKey, paidAt: e.paidAt }, data: { status: "due", amount: 0, payerKey: "", paidAt: null, method: "" } });
  if (done.count !== 1) return { ok: false, error: `${mailSafe(c.organiser)} checked this payment just now, so it can’t be undone here. Ask them to change it.` };
  return { ok: true };
}

// The organiser's controls.
export async function organiserAction(
  code: string,
  accountId: string,
  action: { kind: "confirm" | "unconfirm" | "remove" | "cash" | "add" | "nudge" | "close" | "reopen" | "delete"; entryId?: string; names?: string; contacts?: string; friends?: string[] },
  opts: Hooks = {},
): Promise<Ok<{ notify?: CollectNote[] }> | Fail> {
  const c = await loadCollection(code);
  if (!c || c.accountId !== accountId) return { ok: false, error: "Only the organiser can change this collection." };
  const e = action.entryId ? c.entries.find((x) => x.id === action.entryId) : undefined;
  switch (action.kind) {
    case "confirm":
      if (!e || e.status === "due") return { ok: false, error: "Nothing to check there." };
      await opts.afterRead?.();
      // Only the tick that was seen (same amount, same time): a payer who took it back or ticked again meanwhile wins.
      if ((await db.collectionEntry.updateMany({ where: { id: e.id, status: "paid", amount: e.amount, paidAt: e.paidAt }, data: { status: "confirmed", confirmedAt: new Date() } })).count !== 1) return { ok: false, error: CHANGED };
      return { ok: true, notify: paidNote(c, e.accountId, e.amount) };
    case "unconfirm":
      if (!e || e.status !== "confirmed") return { ok: false, error: "Nothing to change there." };
      await opts.afterRead?.();
      // Cash the organiser recorded themselves (no payer's phone on it) goes back to "still to pay": nobody else said they paid.
      // Anything a payer ticked goes back to "paid" (their own tick), as before.
      const cashByOrganiser = e.method === "cash" && e.payerKey === "";
      if ((await db.collectionEntry.updateMany({ where: { id: e.id, status: "confirmed", confirmedAt: e.confirmedAt }, data: cashByOrganiser ? { status: "due", amount: 0, method: "", paidAt: null, confirmedAt: null } : { status: "paid", confirmedAt: null } })).count !== 1) return { ok: false, error: CHANGED };
      return { ok: true };
    case "cash":
      if (!e || e.status !== "due") return { ok: false, error: "They’re already marked as paid." };
      if (!c.amount) return { ok: false, error: "For “any amount” collections, ask them to tick their own amount." };
      await opts.afterRead?.();
      // Only if they are still unpaid: a payer who ticked their own meanwhile keeps their tick.
      if ((await db.collectionEntry.updateMany({ where: { id: e.id, status: "due" }, data: { status: "confirmed", amount: c.amount, method: "cash", paidAt: new Date(), confirmedAt: new Date() } })).count !== 1) return { ok: false, error: CHANGED };
      return { ok: true, notify: paidNote(c, e.accountId, c.amount) };
    case "nudge":
      // A reminder inside Loopin, for someone on Loopin who hasn't paid yet.
      if (!e || e.status !== "due" || !e.accountId) return { ok: false, error: "Only people on Loopin who haven’t paid can be reminded here." };
      if (c.closedAt) return { ok: false, error: "This collection is closed." };
      return {
        ok: true,
        notify: [{ fromAccountId: accountId, accountIds: [e.accountId], kind: "collect_reminder", title: c.title, body: `Reminder from ${c.organiser}: ${each(c)}${c.dueDate ? ` by ${new Date(`${c.dueDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : ""}. Tap to pay and tick your name.`, url: `/c/${c.code}`, tag: `collect:${c.code}` }],
      };
    case "remove":
      if (!e) return { ok: false, error: "That name isn’t on the list." };
      await opts.afterRead?.();
      // Only the entry as it was seen: a fresh tick (or the organiser's own check) means the list changed.
      if ((await db.collectionEntry.deleteMany({ where: { id: e.id, status: e.status, paidAt: e.paidAt } })).count !== 1) return { ok: false, error: CHANGED };
      return { ok: true };
    case "add": {
      const typed = cleanNames(String(action.names ?? "").split(/[\n,]+/));
      const phones = phonesFor(typed, action.contacts ?? "", c.currency);
      const names = typed.filter((n) => !c.entries.some((x) => sameName(x.name, n)));
      // Picked again from contacts: a number for someone already listed without one.
      const fill = c.entries.filter((x) => !x.phone && Object.keys(phones).some((n) => sameName(n, x.name)));
      const picked = new Set(action.friends ?? []);
      const friends = picked.size ? (await loopinFriends(accountId)).filter((f) => picked.has(f.id) && !c.entries.some((x) => x.accountId === f.id)) : [];
      const rows = names.map((name) => ({ collectionId: c.id, name, status: "due", phone: phones[name] ?? "", accountId: friends.find((f) => sameName(f.name, name))?.id ?? "" }));
      for (const f of friends) if (!rows.some((x) => x.accountId === f.id) && !c.entries.some((x) => sameName(x.name, f.name))) rows.push({ collectionId: c.id, name: f.name, status: "due", phone: "", accountId: f.id });
      // A friend already on the list by name (not linked yet): link them.
      const link = c.entries.filter((x) => !x.accountId && x.status === "due" && friends.some((f) => sameName(f.name, x.name)));
      if (!rows.length && !fill.length && !link.length) return { ok: false, error: "Type names that aren’t on the list yet." };
      if (c.entries.length + rows.length > MAX_ENTRIES) return { ok: false, error: `A collection can have up to ${MAX_ENTRIES} people.` };
      await opts.afterRead?.();
      if (rows.length) {
        // The count again inside a transaction (after a write that takes the lock), so two adds at the last places can't both fit.
        const room = await db.$transaction(async (tx) => {
          await tx.collection.updateMany({ where: { id: c.id, deletedAt: null }, data: { deletedAt: null } });
          if ((await tx.collectionEntry.count({ where: { collectionId: c.id } })) + rows.length > MAX_ENTRIES) return false;
          await tx.collectionEntry.createMany({ data: rows });
          return true;
        });
        if (!room) return { ok: false, error: `A collection can have up to ${MAX_ENTRIES} people.` };
      }
      for (const x of fill) await db.collectionEntry.update({ where: { id: x.id }, data: { phone: phones[Object.keys(phones).find((n) => sameName(n, x.name))!] } });
      for (const x of link) await db.collectionEntry.update({ where: { id: x.id }, data: { accountId: friends.find((f) => sameName(f.name, x.name))!.id } });
      // Told only if they really landed on the list (added now, or linked to their name).
      const told = [...new Set([...rows.map((x) => x.accountId), ...link.map((x) => friends.find((f) => sameName(f.name, x.name))!.id)].filter(Boolean))];
      return told.length
        ? { ok: true, notify: [{ fromAccountId: accountId, accountIds: told, kind: "collect_added", title: c.title, body: `${c.organiser} added you: ${each(c)}. Tap to pay and tick your name.`, url: `/c/${c.code}`, tag: `collect:${c.code}` }] }
        : { ok: true };
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

function paidNote(c: { title: string; organiser: string; currency: string; code: string; accountId: string }, accountId: string, amount: number): CollectNote[] {
  return accountId ? [{ fromAccountId: c.accountId, accountIds: [accountId], kind: "collect_paid", title: c.title, body: `${c.organiser} got your ${formatMoney(amount, c.currency)} ✓ You’re all done.`, url: `/c/${c.code}`, tag: `collect:${c.code}` }] : [];
}

// How many collections I organise in all (Home lists only the first few, but "See all N" must be the real number).
export async function countMyCollections(accountId: string): Promise<number> {
  return db.collection.count({ where: { accountId, deletedAt: null } });
}

// Home: the collections I organise (open first, newest first).
export async function myCollections(accountId: string, take = 20) {
  const list = await db.collection.findMany({
    where: { accountId, deletedAt: null },
    include: { entries: { select: { name: true, amount: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take,
  });
  return list.sort((a, b) => Number(Boolean(a.closedAt)) - Number(Boolean(b.closedAt)));
}

