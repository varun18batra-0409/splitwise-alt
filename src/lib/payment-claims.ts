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
      await sendPushTo([toId], p, item, fromId);
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
export function tellParties(c: {
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
}): void {
  for (const told of partiesToTell(c.actorId, c.fromId, c.toId)) {
    const body =
      c.event === "recorded"
        ? recordedBody({ told, actorId: c.actorId, actorName: c.actorName, fromId: c.fromId, toId: c.toId, fromName: c.fromName, toName: c.toName, amountText: c.amountText })
        : changedBody({ kind: c.event === "deleted" ? "deleted" : "restored", told, actorId: c.actorId, actorName: c.actorName, fromId: c.fromId, toId: c.toId, fromName: c.fromName, toName: c.toName, amountText: c.amountText });
    pushToReceiver(
      told,
      {
        title: c.direct ? `💸 ${c.actorName}` : `💸 ${c.groupName}`,
        body,
        url: c.direct ? `/people/${c.groupId}` : `/groups/${c.groupId}?tab=activity&open=${c.paymentId}`,
        tag: c.eventId ? `ev:${c.eventId}` : `pay-${c.event}-${c.paymentId}-${told}`,
      },
      "payments.claimed",
      c.actorId,
    );
  }
}

// One settle-up across several groups: each person is told once, with what it comes to for them in total.
export type AcrossPart = { groupId: string; groupName: string; paymentId: string; fromId: string; toId: string; amount: number };

// What a person reads about a cross-group settle-up. `net` is minor units: positive = they get it, negative = they pay it.
// Hand-worked: Ravi pays Asha 100000 in Goa and Asha pays Ravi 40000 in Flat. Asha's net is +60000: "(you get ₹600)".
export function acrossBody(actorName: string, groupNames: string[], net: number, amountText: string): string {
  const where = groupNames.length > 2 ? `${groupNames.slice(0, -1).join(", ")} and ${groupNames[groupNames.length - 1]}` : groupNames.join(" and ");
  const tail = net === 0 ? "it comes to nothing for you" : net > 0 ? `you get ${amountText}` : `you pay ${amountText}`;
  return `${actorName} recorded a settle-up with you across ${where} (${tail}). ${WRONG}`;
}

export function tellAcross(c: { actorName: string; actorMemberIds: string[]; parts: AcrossPart[]; money: (n: number) => string; bundleId: string }): void {
  try {
    after(async () => {
      try {
        const { db } = await import("./db");
        const { sendPushTo } = await import("./push");
        const ids = [...new Set(c.parts.flatMap((p) => [p.fromId, p.toId]))].filter((id) => !c.actorMemberIds.includes(id));
        if (!ids.length) return;
        const people = await db.member.findMany({ where: { id: { in: [...new Set(c.parts.flatMap((p) => [p.fromId, p.toId]))] } }, select: { id: true, accountId: true } });
        const keyOf = (id: string) => people.find((m) => m.id === id)?.accountId ?? id; // one person, several groups: one message
        const byPerson = new Map<string, { memberId: string; net: number; groups: Set<string> }>();
        for (const p of c.parts) {
          for (const [id, sign] of [[p.toId, 1], [p.fromId, -1]] as const) {
            if (c.actorMemberIds.includes(id)) continue;
            const k = keyOf(id);
            const cur = byPerson.get(k) ?? { memberId: id, net: 0, groups: new Set<string>() };
            cur.net += sign * p.amount;
            cur.groups.add(p.groupName);
            byPerson.set(k, cur);
          }
        }
        for (const [k, who] of byPerson) {
          const part = c.parts.find((p) => p.fromId === who.memberId || p.toId === who.memberId);
          await sendPushTo(
            [who.memberId],
            {
              title: `💸 ${[...who.groups].join(" · ")}`,
              body: acrossBody(c.actorName, [...who.groups], who.net, c.money(Math.abs(who.net))),
              url: part ? `/groups/${part.groupId}?tab=activity&open=${part.paymentId}` : "/settle",
              tag: `across-${c.bundleId}-${k}`,
            },
            "payments.claimed",
            c.actorMemberIds[0],
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
