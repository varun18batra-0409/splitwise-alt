import { parsePayers } from "./payers";
import { db } from "./db";
import { withRetry } from "./once";
import { diffExpense, expenseState, logEvent, parseUndo, type UndoPayload } from "./events";
import { setExpenseDeleted, setPaymentDeleted } from "./save-expense";
import { formatPercent } from "./money";
import { setMember } from "./people";
import { applySettleAll, setPaymentsDeleted } from "./settle-all";

// Undo any change in a group. Undoing is itself a logged change that everyone
// is notified about, and it can be undone too ("redo").
//
// Safety rules, so an undo never overwrites newer work:
// - a change to an expense or payment can be undone only while it's the latest
//   change to that expense or payment;
// - a group setting change only while it's the latest change of that kind;
// - a currency change only while no money has changed since;
// - people can only be removed again if they aren't in any expense or payment.

type EventLike = {
  id: string;
  kind: string;
  undo: string;
  undoneAt: Date | null;
  expenseId: string | null;
  paymentId: string | null;
  createdAt: Date;
};

const MONEY_KINDS = new Set([
  "expense_added", "expense_edited", "expense_deleted", "expense_restored",
  "payment_recorded", "payment_deleted", "payment_restored", "currency_changed", "group_settled_closed",
]);

// Close and reopen are one setting; members added/removed are one list.
const settingFamily = (kind: string) =>
  kind === "group_closed" || kind === "group_reopened" || kind === "group_settled_closed" ? "open-state" : kind === "members_added" || kind === "members_removed" ? "members" : kind;

const later = (a: EventLike, b: EventLike) =>
  a.createdAt.getTime() > b.createdAt.getTime() || (a.createdAt.getTime() === b.createdAt.getTime() && a.id > b.id);

// Can this change still be undone? Pure, so the screen can show/hide the Undo button.
export function canUndo(ev: EventLike, all: EventLike[]): { ok: true } | { ok: false; reason: string } {
  const payload = parseUndo(ev.undo);
  if (!payload) return { ok: false, reason: "This change can’t be undone." };
  if (ev.undoneAt) return { ok: false, reason: "This change was already undone." };
  const newer = all.filter((x) => x.id !== ev.id && later(x, ev));

  if (ev.expenseId && newer.some((x) => x.expenseId === ev.expenseId)) {
    return { ok: false, reason: "This expense was changed again since. Undo the newer change first." };
  }
  if (ev.paymentId && newer.some((x) => x.paymentId === ev.paymentId)) {
    return { ok: false, reason: "This payment was changed again since. Undo the newer change first." };
  }
  if (payload.type === "group_set" && newer.some((x) => settingFamily(x.kind) === settingFamily(ev.kind))) {
    return { ok: false, reason: "This setting was changed again since. Undo the newer change first." };
  }
  if ((payload.type === "members_remove" || payload.type === "members_restore") && newer.some((x) => settingFamily(x.kind) === "members")) {
    return { ok: false, reason: "People were added or removed again since. Undo the newer change first." };
  }
  if (payload.type === "settle_all") {
    if (newer.some((x) => settingFamily(x.kind) === "open-state" || (x.paymentId && payload.paymentIds.includes(x.paymentId)))) {
      return { ok: false, reason: "The group or those payments changed since. Undo the newer change first." };
    }
  }
  if (payload.type === "payments_set" && newer.some((x) => x.paymentId && payload.paymentIds.includes(x.paymentId))) {
    return { ok: false, reason: "One of those payments changed since. Undo the newer change first." };
  }
  if (payload.type === "member_set") {
    const sameKind = (x: EventLike) => {
      const q = parseUndo(x.undo);
      return q?.type === "member_set" && q.memberId === payload.memberId && ("name" in q.data) === ("name" in payload.data);
    };
    if (newer.some(sameKind)) return { ok: false, reason: "This person was changed again since. Undo the newer change first." };
  }
  if (payload.type === "currency_restore" && newer.some((x) => MONEY_KINDS.has(x.kind))) {
    return { ok: false, reason: "Expenses or payments changed after the currency change, so it can’t be undone safely." };
  }
  return { ok: true };
}

type UndoResult = { ok: true; eventId?: string } | { ok: false; error: string };

export async function undoEvent(eventId: string, actorId: string | undefined): Promise<UndoResult> {
  return withRetry(() => undoOnce(eventId, actorId));
}

async function undoOnce(eventId: string, actorId: string | undefined): Promise<UndoResult> {
  const ev = await db.groupEvent.findUnique({ where: { id: eventId } });
  if (!ev) return { ok: false, error: "That change no longer exists." };
  const group = await db.group.findUnique({
    where: { id: ev.groupId },
    // Only changes from this one on matter for whether it can still be undone.
    include: { members: true, events: { where: { createdAt: { gte: ev.createdAt } } } },
  });
  if (!group) return { ok: false, error: "This group no longer exists." };
  if (!actorId || !group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can undo its changes." };

  const check = canUndo(ev, group.events);
  if (!check.ok) return { ok: false, error: check.reason };
  const payload = parseUndo(ev.undo)!;

  // Claim the undo first (only if nobody did it yet), so a repeated tap or
  // two people at once can never undo the same change twice.
  const claim = await db.groupEvent.updateMany({ where: { id: ev.id, undoneAt: null }, data: { undoneAt: new Date(), undoneById: actorId } });
  if (claim.count !== 1) return { ok: false, error: "That change was already undone." };
  const release = () => db.groupEvent.update({ where: { id: ev.id }, data: { undoneAt: null, undoneById: null } });
  let result: UndoResult;
  try {
    result = await apply(payload, ev.groupId, actorId, ev.text);
  } catch (err) {
    await release(); // nothing was undone: let it be tried again
    throw err;
  }
  if (!result.ok) await release();
  return result;
}

async function apply(p: UndoPayload, groupId: string, actorId: string, originalText: string): Promise<UndoResult> {
  switch (p.type) {
    case "expense_delete":
      return fromResult(await setExpenseDeleted(p.expenseId, actorId, true));
    case "expense_restore":
      return fromResult(await setExpenseDeleted(p.expenseId, actorId, false));
    case "payment_delete":
      return fromResult(await setPaymentDeleted(p.paymentId, actorId, true));
    case "payment_restore":
      return fromResult(await setPaymentDeleted(p.paymentId, actorId, false));
    case "expense_revert":
      return revertExpense(p.expenseId, p.before, actorId);
    case "group_set":
      return applyGroupSettings(groupId, actorId, p.data, originalText);
    case "currency_restore":
      return restoreCurrency(groupId, actorId, p);
    case "members_remove":
      return removeMembers(groupId, actorId, p.memberIds);
    case "members_restore":
      return restoreMembers(groupId, actorId, p.members);
    case "settle_all":
      return fromResult(await applySettleAll(groupId, actorId, p.paymentIds, p.apply));
    case "payments_set":
      return fromResult(await setPaymentsDeleted(groupId, actorId, p.paymentIds, p.deleted));
    case "member_set":
      return fromResult(await setMember(groupId, actorId, p.memberId, p.data, true));
  }
}

function fromResult(r: { ok: true; eventId?: string } | { ok: false; error: string }): UndoResult {
  return r.ok ? { ok: true, eventId: r.eventId } : r;
}

// Put an expense back exactly as it was before an edit.
async function revertExpense(expenseId: string, before: Parameters<typeof expenseState>[0], actorId: string): Promise<UndoResult> {
  const e = await db.expense.findUnique({ where: { id: expenseId }, include: { shares: true, group: { include: { members: true } } } });
  if (!e) return { ok: false, error: "That expense no longer exists." };
  if (e.group.closed) return { ok: false, error: "This group is closed. Reopen it to change expenses." };
  if (e.deletedAt) return { ok: false, error: "This expense is deleted. Restore it first." };
  if (before.baseCurrency !== e.group.currency) return { ok: false, error: "The group currency changed since, so this edit can’t be undone." };
  const memberIds = new Set(e.group.members.map((m) => m.id));
  if (!memberIds.has(before.paidById) || before.shares.some((s) => !memberIds.has(s.memberId)) || parsePayers(before.payers).some((p) => !memberIds.has(p.memberId))) {
    return { ok: false, error: "Someone in that version is no longer in the group." };
  }

  const current = expenseState(e);
  const nameOf = (id: string) => e.group.members.find((m) => m.id === id)?.name ?? "Someone";
  const changes = diffExpense(current, before, nameOf);
  const { shares, ...fields } = before;

  const eventId = await db.$transaction(async (tx) => {
    await tx.expenseShare.deleteMany({ where: { expenseId } });
    await tx.expense.update({
      where: { id: expenseId },
      data: { ...fields, payers: fields.payers ?? "", kind: fields.kind ?? "expense", spentAt: fields.spentAt ? new Date(fields.spentAt) : null, editedAt: new Date(), shares: { create: shares } },
    });
    return logEvent(tx, {
      groupId: e.groupId,
      actorId,
      kind: "expense_edited",
      text: `undid a change to ${before.description}`,
      details: changes,
      expenseId,
      undo: { type: "expense_revert", expenseId, before: current },
    });
  });
  return { ok: true, eventId };
}

// Rename / markup / second currency / close-reopen back to what it was.
async function applyGroupSettings(
  groupId: string,
  actorId: string,
  data: { name?: string; cardMarkupBp?: number; secondaryCurrency?: string; closed?: boolean; closedAt?: string | null },
  originalText: string,
): Promise<UndoResult> {
  const g = await db.group.findUnique({ where: { id: groupId } });
  if (!g) return { ok: false, error: "This group no longer exists." };

  const update: { name?: string; cardMarkupBp?: number; secondaryCurrency?: string; closed?: boolean; closedAt?: Date | null } = {};
  const redo: typeof data = {};
  const details: string[] = [];
  let kind: "group_renamed" | "markup_changed" | "display_currency_changed" | "group_closed" | "group_reopened" = "group_renamed";
  let text = `undid “${originalText}”`;

  if (data.name !== undefined) {
    update.name = data.name;
    redo.name = g.name;
    details.push(`Name: ${g.name} → ${data.name}`);
    kind = "group_renamed";
    text = `renamed the group back to “${data.name}”`;
  }
  if (data.cardMarkupBp !== undefined) {
    update.cardMarkupBp = data.cardMarkupBp;
    redo.cardMarkupBp = g.cardMarkupBp;
    details.push(`Card markup: ${formatPercent(g.cardMarkupBp)} → ${formatPercent(data.cardMarkupBp)}`);
    kind = "markup_changed";
    text = `set the card markup back to ${formatPercent(data.cardMarkupBp)}`;
  }
  if (data.secondaryCurrency !== undefined) {
    update.secondaryCurrency = data.secondaryCurrency;
    redo.secondaryCurrency = g.secondaryCurrency;
    kind = "display_currency_changed";
    text = `undid the second-currency change`;
  }
  if (data.closed !== undefined) {
    update.closed = data.closed;
    update.closedAt = data.closedAt ? new Date(data.closedAt) : data.closed ? new Date() : null;
    redo.closed = g.closed;
    redo.closedAt = g.closedAt ? g.closedAt.toISOString() : null;
    kind = data.closed ? "group_closed" : "group_reopened";
    text = data.closed ? "closed the group again (undo)" : "reopened the group (undo)";
  }

  const eventId = await db.$transaction(async (tx) => {
    await tx.group.update({ where: { id: groupId }, data: update });
    return logEvent(tx, { groupId, actorId, kind, text, details, undo: { type: "group_set", data: redo } });
  });
  return { ok: true, eventId };
}

// Put every amount back exactly as it was before a currency change.
async function restoreCurrency(groupId: string, actorId: string, p: Extract<UndoPayload, { type: "currency_restore" }>): Promise<UndoResult> {
  const g = await db.group.findUnique({ where: { id: groupId }, include: { expenses: { include: { shares: true } }, payments: true } });
  if (!g) return { ok: false, error: "This group no longer exists." };
  const current: Extract<UndoPayload, { type: "currency_restore" }> = {
    type: "currency_restore",
    currency: g.currency,
    expenses: g.expenses.map((e) => ({
      id: e.id, baseCurrency: e.baseCurrency, exchangeRate: e.exchangeRate, rateSource: e.rateSource,
      convertedAmount: e.convertedAmount, markupAmount: e.markupAmount, amount: e.amount, payers: e.payers,
      shares: e.shares.map((s) => ({ id: s.id, amount: s.amount })),
    })),
    payments: g.payments.map((x) => ({ id: x.id, amount: x.amount })),
  };
  const eventId = await db.$transaction(async (tx) => {
    for (const e of p.expenses) {
      const { shares, id, ...fields } = e;
      await tx.expense.update({ where: { id }, data: fields });
      for (const s of shares) await tx.expenseShare.update({ where: { id: s.id }, data: { amount: s.amount } });
    }
    for (const x of p.payments) await tx.payment.update({ where: { id: x.id }, data: { amount: x.amount } });
    await tx.group.update({ where: { id: groupId }, data: { currency: p.currency } });
    return logEvent(tx, {
      groupId,
      actorId,
      kind: "currency_changed",
      text: `changed the group currency back to ${p.currency}`,
      details: [`Currency: ${g.currency} → ${p.currency}`, "Every amount is back exactly as it was"],
      undo: current,
    });
  });
  return { ok: true, eventId };
}

// Take back "added people" — only if they haven't been used anywhere yet.
export async function removeMembers(groupId: string, actorId: string, memberIds: string[], undoing = true): Promise<UndoResult> {
  if (memberIds.includes(actorId)) return { ok: false, error: "You can’t remove yourself. Use “Leave group” instead." };
  const members = await db.member.findMany({ where: { id: { in: memberIds }, groupId } });
  for (const m of members) {
    const used =
      (await db.expenseShare.count({ where: { memberId: m.id } })) +
      (await db.expense.count({ where: { groupId, OR: [{ paidById: m.id }, { createdById: m.id }, { payers: { contains: m.id } }] } })) +
      (await db.payment.count({ where: { OR: [{ fromId: m.id }, { toId: m.id }] } }));
    if (used > 0) return { ok: false, error: `${m.name} is already part of expenses or payments, so they can’t be removed.` };
  }
  if (members.length === 0) return { ok: true };
  const eventId = await db.$transaction(async (tx) => {
    await tx.member.deleteMany({ where: { id: { in: members.map((m) => m.id) } } });
    return logEvent(tx, {
      groupId,
      actorId,
      kind: "members_removed",
      text: `removed ${members.map((m) => m.name).join(", ")}${undoing ? " (undo)" : " from the group"}`,
      undo: {
        type: "members_restore",
        members: members.map((m) => ({
          id: m.id,
          name: m.name,
          phone: m.phone,
          createdAt: m.createdAt.toISOString(),
          accountId: m.accountId,
          claimedAt: m.claimedAt?.toISOString() ?? null,
          splitWeight: m.splitWeight,
          notify: m.notify,
          joinedFrom: m.joinedFrom?.toISOString() ?? null,
        })),
      },
    });
  });
  return { ok: true, eventId };
}

async function restoreMembers(groupId: string, actorId: string, members: Extract<UndoPayload, { type: "members_restore" }>["members"]): Promise<UndoResult> {
  const existing = await db.member.findMany({ where: { groupId } });
  const clash = members.find((m) => existing.some((x) => x.name.toLowerCase() === m.name.toLowerCase()));
  if (clash) return { ok: false, error: `Someone called ${clash.name} is already in the group.` };
  const eventId = await db.$transaction(async (tx) => {
    for (const m of members) {
      // Back as they were: still linked to their sign-in (unless they've joined again since), same share.
      const accountId = m.accountId && !existing.some((x) => x.accountId === m.accountId) ? m.accountId : null;
      await tx.member.create({
        data: {
          id: m.id,
          name: m.name,
          phone: m.phone,
          groupId,
          createdAt: new Date(m.createdAt),
          accountId,
          claimedAt: accountId && m.claimedAt ? new Date(m.claimedAt) : null,
          ...(m.splitWeight ? { splitWeight: m.splitWeight } : {}),
          ...(m.notify ? { notify: m.notify } : {}),
          ...(m.joinedFrom ? { joinedFrom: new Date(m.joinedFrom) } : {}),
        },
      });
    }
    return logEvent(tx, {
      groupId,
      actorId,
      kind: "members_added",
      text: `added ${members.map((m) => m.name).join(", ")} back`,
      undo: { type: "members_remove", memberIds: members.map((m) => m.id) },
    });
  });
  return { ok: true, eventId };
}
