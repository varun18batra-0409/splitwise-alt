import { after } from "next/server";

// Phone notifications about payments, and the old "I've paid" note vocabulary.
//
// Batch C: "I've paid" is no longer a note that waits for the other person. Every recorded payment counts straight away, and the other
// person is told ("Asha recorded paying you ₹400. If that's wrong, open it to delete it."). The code that made, withdrew, declined and
// confirmed notes is gone. The PaymentClaim table stays, because older rows are still read (My data, removing people, erasing a group, a
// move-out) and scripts/convert-waiting-claims.ts turns the notes still waiting on the live app into counted payments.

export type ClaimStatus = "waiting" | "confirmed" | "declined" | "withdrawn" | "covered" | "expired";

// The history line of an old note carries "claim:<id>" in its payment reference (a column that already exists).
export const claimRef = (claimId: string) => `claim:${claimId}`;

// Phone notification for one person (the group's history line is separate).
export function pushToReceiver(toId: string, p: { title: string; body: string; url: string; tag: string }, item: "payments.claimed" | "payments.answered", fromId?: string) {
  try {
    after(async () => {
      const { sendPushTo } = await import("./push");
      // A payment alert still arrives between people with a block (a wrong payment must be catchable), and reaches someone who left (it is about their own money).
      await sendPushTo([toId], p, item, fromId, { includeLeft: true, allowBlocked: true });
    });
  } catch {
    /* not inside a request (tests, scripts): nothing is sent */
  }
}

// Someone who had left was put back into the group because a payment was taken off (a move-out payment marked "Not received", or a delete):
// they are told (the group's history line is separate).
export function tellBroughtBack(c: { groupId: string; groupName: string; memberId: string; receiverName: string; amountText: string; paymentId: string; receiverId?: string; how?: "not-received" | "deleted" }) {
  pushToReceiver(
    c.memberId,
    {
      title: `💬 ${c.groupName}`,
      body:
        c.how === "deleted"
          ? `${c.receiverName} deleted the ${c.amountText} payment, so you’re back in ${c.groupName} until it’s sorted.`
          : `${c.receiverName} hasn’t received your ${c.amountText}, so you’re back in ${c.groupName} until it’s sorted.`,
      url: `/groups/${c.groupId}/settle`,
      tag: `brought-back-${c.paymentId}-${c.memberId}`,
    },
    "payments.answered",
    c.receiverId,
  );
}

// Who is told about a payment: the payer and the person paid, never the one who did it. If the payer did it, the person paid is told;
// if the person paid did it, the payer is told; if anyone else did it, both are told.
export function partiesToTell(actorId: string, fromId: string, toId: string): string[] {
  if (actorId === fromId) return [toId];
  if (actorId === toId) return [fromId];
  return [fromId, toId];
}

const WRONG = "If that’s wrong, open it to delete it.";

// The words, for one person told about a payment that was recorded. `told` is that person (the payer or the person paid).
// Hand-worked: Asha pays Ravi ₹400. Asha records it: Ravi reads "Asha recorded paying you ₹400. …". Ravi records it: Asha reads
// "Ravi recorded getting ₹400 from you. …". Meera records it: Ravi reads "Meera recorded that Asha paid you ₹400. …" and Asha reads
// "Meera recorded that you paid Ravi ₹400. …".
export function recordedBody(i: { told: string; actorId: string; actorName: string; fromId: string; toId: string; fromName: string; toName: string; amountText: string }): string {
  const { told, actorId, actorName, fromId, toId, fromName, toName, amountText } = i;
  if (actorId === fromId) return `${actorName} recorded paying you ${amountText}. ${WRONG}`;
  if (actorId === toId) return `${actorName} recorded getting ${amountText} from you. ${WRONG}`;
  if (told === toId) return `${actorName} recorded that ${fromName} paid you ${amountText}. ${WRONG}`;
  return `${actorName} recorded that you paid ${toName} ${amountText}. ${WRONG}`;
}

// A payment deleted or brought back: what the other person reads.
export function changedBody(i: { kind: "deleted" | "restored"; told: string; actorId: string; actorName: string; fromId: string; toId: string; fromName: string; toName: string; amountText: string }): string {
  const verb = i.kind === "deleted" ? "deleted" : "brought back";
  if (i.actorId === i.fromId) return `${i.actorName} ${verb} the ${i.amountText} payment to you.`;
  if (i.actorId === i.toId) return `${i.actorName} ${verb} the ${i.amountText} payment from you.`;
  return i.told === i.toId ? `${i.actorName} ${verb} the ${i.amountText} payment from ${i.fromName} to you.` : `${i.actorName} ${verb} the ${i.amountText} payment you made to ${i.toName}.`;
}

// Tell the other person (or both) about one payment. Call it AFTER the transaction has committed. `direct`: a pair (the title is the other
// person's name and it opens their page). Never throws.
type TellInput = {
  event: "recorded" | "deleted" | "restored";
  actorId: string;
  actorName: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  amountText: string;
  groupName: string;
  groupId: string;
  paymentId: string;
  eventId?: string;
  direct?: boolean;
};
type PartyMessage = { toId: string; p: { title: string; body: string; url: string; tag: string }; fromId: string };

// The messages for one payment: one per person told (see partiesToTell). Pure, so several payments can be sent as one job.
export function partyMessages(c: TellInput): PartyMessage[] {
  return partiesToTell(c.actorId, c.fromId, c.toId).map((told) => {
    const body =
      c.event === "recorded"
        ? recordedBody({ told, actorId: c.actorId, actorName: c.actorName, fromId: c.fromId, toId: c.toId, fromName: c.fromName, toName: c.toName, amountText: c.amountText })
        : changedBody({ kind: c.event === "deleted" ? "deleted" : "restored", told, actorId: c.actorId, actorName: c.actorName, fromId: c.fromId, toId: c.toId, fromName: c.fromName, toName: c.toName, amountText: c.amountText });
    return {
      toId: told,
      p: {
        title: c.direct ? `💸 ${c.actorName}` : `💸 ${c.groupName}`,
        body,
        url: c.direct ? `/people/${c.groupId}` : `/groups/${c.groupId}?tab=activity&open=${c.paymentId}`,
        tag: c.eventId ? `ev:${c.eventId}` : `pay-${c.event}-${c.paymentId}-${told}`,
      },
      fromId: c.actorId,
    };
  });
}

// Several messages in ONE after-the-response job, sent one after another. (Many separate jobs started at once were seen to lose all but
// the first: settle everything, then Undo, then Redo told only one person in the test run.) Never throws.
export function pushAllToReceivers(msgs: PartyMessage[], item: "payments.claimed" | "payments.answered" = "payments.claimed") {
  if (!msgs.length) return;
  try {
    after(async () => {
      const { sendPushTo } = await import("./push");
      // Payment messages reach people who left (it's their money) and blocked pairs (so a wrong payment can be spotted); push.ts limits
      // blocked pairs to a few an hour. The same exemption pushToReceiver uses.
      for (const m of msgs) await sendPushTo([m.toId], m.p, item, m.fromId, { includeLeft: true, allowBlocked: true });
    });
  } catch {
    /* not inside a request (tests, scripts): nothing is sent */
  }
}

export function tellParties(c: TellInput): void {
  pushAllToReceivers(partyMessages(c));
}

// One settle-up across several groups: each person is told once, with what it comes to for them in each currency (never added together).
export type AcrossPart = { groupId: string; groupName: string; currency: string; paymentId: string; fromId: string; toId: string; amount: number };

const listOf = (xs: string[]) => (xs.length > 2 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs.join(" and "));

// What a person reads about a cross-group settle-up. `nets` is minor units per currency: positive = they get it, negative = they pay it.
// Hand-worked: Ravi pays Asha 100000 INR in Goa and Asha pays Ravi 40000 INR in Flat. Asha's net is {INR: +60000}: "(you get ₹600)".
// With 2000 USD more owed to her in a third group: {INR: +60000, USD: +2000}: "(you get ₹600 and $20)". Different currencies are never added.
// Opposite ways: {INR: +60000, USD: -2000}: "(you get ₹600 and you pay $20)".
export function acrossBody(actorName: string, groupNames: string[], nets: Record<string, number>, money: (minor: number, currency: string) => string): string {
  const get = Object.entries(nets).filter(([, n]) => n > 0).map(([c, n]) => money(n, c));
  const pay = Object.entries(nets).filter(([, n]) => n < 0).map(([c, n]) => money(-n, c));
  const tail = !get.length && !pay.length ? "it comes to nothing for you" : [get.length ? `you get ${listOf(get)}` : "", pay.length ? `you pay ${listOf(pay)}` : ""].filter(Boolean).join(" and ");
  return `${actorName} recorded a settle-up with you across ${listOf(groupNames)} (${tail}). ${WRONG}`;
}

// Who is told, and what it comes to for each: one entry per person (by account when they have one), per currency. Pure.
export function acrossRecipients(parts: AcrossPart[], actorMemberIds: string[], accountOf: (memberId: string) => string | null): { key: string; memberId: string; nets: Record<string, number>; groups: string[] }[] {
  const byPerson = new Map<string, { memberId: string; nets: Record<string, number>; groups: Set<string> }>();
  for (const p of parts) {
    for (const [id, sign] of [[p.toId, 1], [p.fromId, -1]] as const) {
      if (actorMemberIds.includes(id)) continue;
      const k = accountOf(id) ?? id; // one person, several groups: one message
      const cur = byPerson.get(k) ?? { memberId: id, nets: {}, groups: new Set<string>() };
      cur.nets[p.currency] = (cur.nets[p.currency] ?? 0) + sign * p.amount;
      cur.groups.add(p.groupName);
      byPerson.set(k, cur);
    }
  }
  return [...byPerson].map(([key, w]) => ({ key, memberId: w.memberId, nets: w.nets, groups: [...w.groups] }));
}

export function tellAcross(c: { actorName: string; actorMemberIds: string[]; parts: AcrossPart[]; money: (minor: number, currency: string) => string; bundleId: string }): void {
  try {
    after(async () => {
      try {
        const { db } = await import("./db");
        const { sendPushTo } = await import("./push");
        const people = await db.member.findMany({ where: { id: { in: [...new Set(c.parts.flatMap((p) => [p.fromId, p.toId]))] } }, select: { id: true, accountId: true } });
        for (const who of acrossRecipients(c.parts, c.actorMemberIds, (id) => people.find((m) => m.id === id)?.accountId ?? null)) {
          const part = c.parts.find((p) => p.fromId === who.memberId || p.toId === who.memberId);
          await sendPushTo(
            [who.memberId],
            {
              title: `💸 ${who.groups.join(" · ")}`,
              body: acrossBody(c.actorName, who.groups, who.nets, c.money),
              url: part ? `/groups/${part.groupId}?tab=activity&open=${part.paymentId}` : "/settle",
              tag: `across-${c.bundleId}-${who.key}`,
            },
            "payments.claimed",
            c.actorMemberIds[0],
            { includeLeft: true, allowBlocked: true },
          );
        }
      } catch {
        /* a push that could not be sent is never an error for the person who recorded it */
      }
    });
  } catch {
    /* not inside a request (tests, scripts): nothing is sent */
  }
}
