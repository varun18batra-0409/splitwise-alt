import { db } from "./db";
import { moveOutPaymentIds } from "./payment-change";
import { formatMoney } from "./money";
import { billStatuses } from "./home/bills-db";
import { billHold } from "./home/bills";
import { collectSentence, paidAction, paidToViewer } from "./home/display";
import type { DueBill } from "./home/need-line";

// Alerts: "Needs you" (things only you can answer) kept apart from "Activity" (what happened).
// Three kinds, each one line that goes straight to where you act:
//   payment    – a flat move-out's final payment to you that still waits for your "Got it / Not received" (every other payment counts at once,
//                and is not asked about; "claim" is no longer made: nobody's "I've paid" waits for anyone any more)
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

    const asking = liveIds.length ? await db.payment.findMany({ where: { toId: { in: liveIds }, needsOk: true, okAt: null, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 50 }) : [];
    // Only a flat move-out's final payments still ask (older rows flagged by the earlier rule are not asked about).
    const moveOut = asking.length ? await moveOutPaymentIds(db, [...new Set(asking.map((p) => p.groupId))]) : new Set<string>();
    const payments = asking.filter((p) => moveOut.has(p.id));
    const nameIds = [...new Set(payments.map((p) => p.fromId))];
    const names = nameIds.length ? await db.member.findMany({ where: { id: { in: nameIds } }, select: { id: true, name: true } }) : [];
    const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? "Someone";

    // A pair is "Direct", and its screen is the person's page (the group's own pages send it there anyway).
    const whereOf = (g: { id: string; name: string; type: string }) => (g.type === "direct" ? "Direct" : g.name);
    const hrefOf = (g: { id: string; type: string }) => (g.type === "direct" ? `/people/${g.id}` : `/groups/${g.id}/settle`);
    for (const p of payments) {
      const g = groupOf.get(p.toId);
      if (!g) continue;
      items.push({ id: `payment:${p.id}`, kind: "payment", text: `${nameOf(p.fromId)} says they paid you ${formatMoney(p.amount, g.currency)}`, where: whereOf(g), href: hrefOf(g), groupId: g.id, fromId: p.fromId, at: p.createdAt });
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
// A collection "paid" note for a payment still waiting to be checked lives in Needs you only. The old "says they paid / waiting to be
// confirmed" lines of the earlier "I've paid" notes are history only now (nothing waits for anyone any more), so they are never listed.

export function withoutRepeats<T extends { type: "event"; groupId: string; kind: string; actorId: string; at: Date; ref?: string | null } | { type: "note"; kind: string; url: string; body: string }>(
  rows: T[],
  needs: NeedsYouItem[],
): T[] {
  const says = needs.filter((n) => n.kind === "collect" && n.entryName).map((n) => ({ url: n.href, prefix: `${n.entryName} says they paid` }));
  return rows.filter((r) => {
    if (r.type === "event") {
      return r.kind !== "payment_claimed";
    }
    return !(r.kind === "collect_ticked" && says.some((x) => x.url === r.url && r.body.startsWith(x.prefix)));
  });
}
