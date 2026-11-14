import { db } from "./db";
import { formatMoney } from "./money";
import { billStatuses } from "./home/bills-db";
import { billHold } from "./home/bills";
import { collectSentence, paidAction, paidToViewer } from "./home/display";
import type { DueBill } from "./home/need-line";

// Alerts: "Needs you" (things only you can answer) kept apart from "Activity" (what happened).
// Four kinds, each one line that goes straight to where you act:
//   claim      – someone says they paid you; confirm it or say you haven't got it
//   payment    – an older payment to you that still waits for your "Confirm received"
//   bill       – a bill that changes each month and is waiting for the amount you enter, or a bill held for
//                a problem that you pay (shown as "Needs a fix", opening the bill's settings)
//   collect    – someone in your collection says they've paid; check it
// (Invitations are the fifth kind; they have their own Join / Not now cards, so the page passes how many there are and draws them itself.)

export type NeedsYouItem = {
  id: string; // unique across kinds
  kind: "claim" | "payment" | "bill" | "collect";
  text: string;
  action?: string; // the words under it, when they aren't the kind's usual ones ("Needs a fix")
  tone?: "orange";
  where: string; // the group or collection it belongs to
  href: string;
  groupId?: string;
  fromId?: string; // claim: who says they paid (to hide the matching line in Activity)
  claimId?: string; // claim: its id (the claim's history line carries the same one)
  entryName?: string; // collect: the name on the list that says they paid
  at: Date;
};

export type NeedsYou = { items: NeedsYouItem[]; invitations: number; total: number };

// `dueSoon`: when given, the flat bills that are coming up and are yours to pay (or nobody's in particular) are added to it, read from the same
// bill statuses this already works out (Home turns them into its "due soon" line). Nothing about the returned value changes.
export async function loadNeedsYou(memberships: Record<string, string>, account: { id: string } | null, invitations: number, now = new Date(), dueSoon?: DueBill[]): Promise<NeedsYou> {
  const myIds = Object.values(memberships);
  const items: NeedsYouItem[] = [];

  if (myIds.length) {
    const members = await db.member.findMany({
      where: { id: { in: myIds } },
      select: { id: true, groupId: true, leftAt: true, group: { select: { id: true, name: true, type: true, currency: true, closed: true, deletedAt: true } } },
    });
    // Only the member row this phone really is, in groups that still run. (Someone who left can still answer money paid to them.)
    const live = members.filter((m) => memberships[m.groupId] === m.id && !m.group.deletedAt && !m.group.closed);
    const liveIds = live.map((m) => m.id);
    const groupOf = new Map(live.map((m) => [m.id, m.group]));

    const [claims, payments] = await Promise.all([
      liveIds.length ? db.paymentClaim.findMany({ where: { toId: { in: liveIds }, status: "waiting" }, orderBy: { createdAt: "desc" }, take: 50 }) : Promise.resolve([]),
      liveIds.length ? db.payment.findMany({ where: { toId: { in: liveIds }, needsOk: true, okAt: null, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 50 }) : Promise.resolve([]),
    ]);
    const nameIds = [...new Set([...claims.map((c) => c.fromId), ...payments.map((p) => p.fromId)])];
    const names = nameIds.length ? await db.member.findMany({ where: { id: { in: nameIds } }, select: { id: true, name: true } }) : [];
    const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? "Someone";

    for (const c of claims) {
      const g = groupOf.get(c.toId);
      if (!g) continue;
      items.push({ id: `claim:${c.id}`, kind: "claim", text: `${nameOf(c.fromId)} says they paid you ${formatMoney(c.amount, c.currency)}`, where: g.name, href: `/groups/${g.id}/settle`, groupId: g.id, fromId: c.fromId, claimId: c.id, at: c.createdAt });
    }
    for (const p of payments) {
      const g = groupOf.get(p.toId);
      if (!g) continue;
      items.push({ id: `payment:${p.id}`, kind: "payment", text: `${nameOf(p.fromId)} says they paid you ${formatMoney(p.amount, g.currency)}`, where: g.name, href: `/groups/${g.id}/settle`, groupId: g.id, fromId: p.fromId, at: p.createdAt });
    }

    // Bills that wait for an amount, where I'm the one who pays this month.
    for (const m of live.filter((x) => x.group.type === "home" && !x.leftAt)) {
      for (const b of await billStatuses(m.groupId, now)) {
        if (dueSoon && b.status === "upcoming" && b.bill.nature !== "daily" && (b.payerId === m.id || !b.payerId)) {
          dueSoon.push({ groupId: m.groupId, billId: b.bill.id, name: b.bill.name, group: m.group.name, due: b.due });
        }
        if (b.status !== "waiting" || b.payerId !== m.id) continue;
        const hold = billHold({ nature: b.bill.nature, reason: b.reason, payerId: b.payerId });
        if (hold === "amount") {
          items.push({ id: `bill:${b.bill.id}:${b.period}`, kind: "bill", text: `${b.bill.name} is waiting for its amount`, where: m.group.name, href: `/groups/${m.groupId}/add?bill=${b.bill.id}&period=${b.period}`, groupId: m.groupId, at: now });
        } else if (hold === "add") {
          // Nothing is wrong any more (or an add was interrupted): it only needs adding.
          items.push({ id: `bill:${b.bill.id}:${b.period}`, kind: "bill", text: `${b.bill.name} is ready to add`, action: "Add it", where: m.group.name, href: `/groups/${m.groupId}/add?bill=${b.bill.id}&period=${b.period}`, groupId: m.groupId, at: now });
        } else if (hold === "fix") {
          // Held for a problem (not for an amount): the fix is in the bill's settings.
          items.push({ id: `bill:${b.bill.id}:${b.period}`, kind: "bill", text: `${b.bill.name} is on hold${b.reason ? `: ${b.reason}` : ""}`, action: "Needs a fix", tone: "orange", where: m.group.name, href: `/groups/${m.groupId}/bills/${b.bill.id}`, groupId: m.groupId, at: now });
        }
      }
    }
  }

  // Collections I run where someone says they've paid.
  if (account) {
    const entries = await db.collectionEntry.findMany({
      where: { status: "paid", collection: { accountId: account.id, closedAt: null, deletedAt: null } },
      include: { collection: { select: { code: true, title: true, currency: true, upiId: true, payLink: true } } },
      orderBy: { paidAt: "desc" },
      take: 50,
    });
    // A collection's money goes to its UPI ID / pay link, which can be someone else's (a treasurer's). "Paid you" is
    // said only when those are the viewer's own; otherwise the line stays neutral and names the collection.
    const mine = entries.length ? await db.account.findUnique({ where: { id: account.id }, select: { upiId: true, payLink: true } }) : null;
    for (const e of entries) {
      const youArePaid = paidToViewer(e.collection, mine);
      items.push({
        id: `collect:${e.id}`,
        kind: "collect",
        text: collectSentence(e.name, formatMoney(e.amount, e.collection.currency), e.collection.title, youArePaid),
        action: paidAction(youArePaid),
        where: e.collection.title,
        href: `/c/${e.collection.code}`,
        entryName: e.name,
        at: e.paidAt ?? e.createdAt,
      });
    }
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return { items, invitations, total: items.length + invitations };
}

// What goes in the Activity list once "Needs you" is drawn: the same thing is never shown twice.
// The "says they paid" line of a claim that is shown in Needs you, and a collection "paid" note for a
// payment still waiting to be checked, both live in Needs you only. Only THAT claim's line is hidden.
// The line carries its claim's id ("claim:<id>" in `ref`), so it is matched exactly: another claim by the
// same person, an earlier tap or a "hasn't received it" line stays in Activity. Lines written before the id
// was kept have no `ref`; for those only, the old rule applies (same group, same person, the same moment).
export const CLAIM_LINE_WINDOW_MS = 5000;

export function withoutRepeats<T extends { type: "event"; groupId: string; kind: string; actorId: string; at: Date; ref?: string | null } | { type: "note"; kind: string; url: string; body: string }>(
  rows: T[],
  needs: NeedsYouItem[],
): T[] {
  const claims = needs.filter((n) => n.kind === "claim" && n.groupId && n.fromId);
  const says = needs.filter((n) => n.kind === "collect" && n.entryName).map((n) => ({ url: n.href, prefix: `${n.entryName} says they paid` }));
  return rows.filter((r) => {
    if (r.type === "event") {
      if (r.kind !== "payment_claimed") return true;
      if (r.ref?.startsWith("claim:")) return !claims.some((c) => c.claimId !== undefined && `claim:${c.claimId}` === r.ref);
      return !claims.some((c) => c.groupId === r.groupId && c.fromId === r.actorId && Math.abs(c.at.getTime() - r.at.getTime()) <= CLAIM_LINE_WINDOW_MS);
    }
    return !(r.kind === "collect_ticked" && says.some((x) => x.url === r.url && r.body.startsWith(x.prefix)));
  });
}
