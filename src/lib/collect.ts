import { db } from "./db";
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
  const mine = await db.member.findMany({ where: { accountId, leftAt: null, group: { deletedAt: null } }, select: { groupId: true } });
  if (!mine.length) return [];
  const others = await db.member.findMany({
    where: { groupId: { in: mine.map((m) => m.groupId) }, leftAt: null, accountId: { not: null } },
    select: { accountId: true, name: true },
  });
  const ids = [...new Set(others.map((o) => o.accountId!).filter((id) => id !== accountId))];
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
    ? [{ accountIds: onList, kind: "collect_added", title: r.data.title, body: `${organiser} added you: ${each(r.data)}. Tap to pay and tick your name.`, url: `/c/${code}`, tag: `collect:${code}` }]
    : [];
  return { ok: true as const, code, notify };
}

export async function loadCollection(code: string) {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(code)) return null;
  const c = await db.collection.findUnique({ where: { code }, include: { entries: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  return c && !c.deletedAt ? c : null;
}

// Someone says they've paid: their name from the list (or a new one), and how much.
export async function markPaid(code: string, input: { entryId?: string; name?: string; amount?: string; viewerAccountId?: string }, payerKey: string): Promise<Ok<{ entryId: string }> | Fail> {
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
    // Ticked by someone signed in to Loopin: they'll hear when it's checked.
    const who = !e.accountId && input.viewerAccountId && input.viewerAccountId !== c.accountId ? { accountId: input.viewerAccountId } : {};
    const done = await db.collectionEntry.updateMany({ where: { id: e.id, status: "due" }, data: { status: "paid", amount, method: c.currency === "INR" && c.upiId ? "upi" : "other", payerKey, paidAt: new Date(), ...who } });
    if (done.count !== 1) return { ok: false, error: `${e.name} is already marked as paid.` };
    return { ok: true, entryId: e.id };
  }
  const name = cleanNames([String(input.name ?? "")])[0];
  if (!name) return { ok: false, error: "Type your name, so the organiser knows who paid." };
  const twin = c.entries.find((x) => sameName(x.name, name));
  if (twin && twin.status === "due") return markPaid(code, { entryId: twin.id, amount: input.amount, viewerAccountId: input.viewerAccountId }, payerKey);
  if (twin) return { ok: false, error: `${twin.name} is already on the list as paid. Add your surname or initial if you’re someone else.` };
  if (c.entries.length >= MAX_ENTRIES) return { ok: false, error: "This list is full." };
  const viewer = input.viewerAccountId && input.viewerAccountId !== c.accountId ? input.viewerAccountId : "";
  const e = await db.collectionEntry.create({ data: { collectionId: c.id, name, amount, status: "paid", method: c.currency === "INR" && c.upiId ? "upi" : "other", payerKey, paidAt: new Date(), accountId: viewer } });
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
  action: { kind: "confirm" | "unconfirm" | "remove" | "cash" | "add" | "nudge" | "close" | "reopen" | "delete"; entryId?: string; names?: string; contacts?: string; friends?: string[] },
): Promise<Ok<{ notify?: CollectNote[] }> | Fail> {
  const c = await loadCollection(code);
  if (!c || c.accountId !== accountId) return { ok: false, error: "Only the organiser can change this collection." };
  const e = action.entryId ? c.entries.find((x) => x.id === action.entryId) : undefined;
  switch (action.kind) {
    case "confirm":
      if (!e || e.status === "due") return { ok: false, error: "Nothing to check there." };
      await db.collectionEntry.update({ where: { id: e.id }, data: { status: "confirmed", confirmedAt: new Date() } });
      return { ok: true, notify: paidNote(c, e.accountId, e.amount) };
    case "unconfirm":
      if (!e || e.status !== "confirmed") return { ok: false, error: "Nothing to change there." };
      await db.collectionEntry.update({ where: { id: e.id }, data: { status: "paid", confirmedAt: null } });
      return { ok: true };
    case "cash":
      if (!e || e.status !== "due") return { ok: false, error: "They’re already marked as paid." };
      if (!c.amount) return { ok: false, error: "For “any amount” collections, ask them to tick their own amount." };
      await db.collectionEntry.update({ where: { id: e.id }, data: { status: "confirmed", amount: c.amount, method: "cash", paidAt: new Date(), confirmedAt: new Date() } });
      return { ok: true, notify: paidNote(c, e.accountId, c.amount) };
    case "nudge":
      // A reminder inside Loopin, for someone on Loopin who hasn't paid yet.
      if (!e || e.status !== "due" || !e.accountId) return { ok: false, error: "Only people on Loopin who haven’t paid can be reminded here." };
      if (c.closedAt) return { ok: false, error: "This collection is closed." };
      return {
        ok: true,
        notify: [{ accountIds: [e.accountId], kind: "collect_reminder", title: c.title, body: `Reminder from ${c.organiser}: ${each(c)}${c.dueDate ? ` by ${new Date(`${c.dueDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : ""}. Tap to pay and tick your name.`, url: `/c/${c.code}`, tag: `collect:${c.code}` }],
      };
    case "remove":
      if (!e) return { ok: false, error: "That name isn’t on the list." };
      await db.collectionEntry.delete({ where: { id: e.id } });
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
      if (rows.length) await db.collectionEntry.createMany({ data: rows });
      for (const x of fill) await db.collectionEntry.update({ where: { id: x.id }, data: { phone: phones[Object.keys(phones).find((n) => sameName(n, x.name))!] } });
      for (const x of link) await db.collectionEntry.update({ where: { id: x.id }, data: { accountId: friends.find((f) => sameName(f.name, x.name))!.id } });
      // Told only if they really landed on the list (added now, or linked to their name).
      const told = [...new Set([...rows.map((x) => x.accountId), ...link.map((x) => friends.find((f) => sameName(f.name, x.name))!.id)].filter(Boolean))];
      return told.length
        ? { ok: true, notify: [{ accountIds: told, kind: "collect_added", title: c.title, body: `${c.organiser} added you: ${each(c)}. Tap to pay and tick your name.`, url: `/c/${c.code}`, tag: `collect:${c.code}` }] }
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

function paidNote(c: { title: string; organiser: string; currency: string; code: string }, accountId: string, amount: number): CollectNote[] {
  return accountId ? [{ accountIds: [accountId], kind: "collect_paid", title: c.title, body: `${c.organiser} got your ${formatMoney(amount, c.currency)} ✓ You’re all done.`, url: `/c/${c.code}`, tag: `collect:${c.code}` }] : [];
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

