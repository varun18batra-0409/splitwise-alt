import { db } from "@/lib/db";
import { sendPushToAccounts } from "@/lib/push";
import { noteItem } from "@/lib/account-notify";

// Sealed postcards whose day has come: tell each person theirs is open (once).
// Each postcard is CLAIMED (openNoted false -> true, only if still false) and its note in Alerts is written in the same
// transaction, so a run that stops half way can't leave a postcard marked as told with no note, and two runs at once can't
// both tell. The phone push goes afterwards (a push that fails never undoes the note).
const BATCH = 100;

// `opts.beforeBatch` is for tests only: it runs before each batch (a throw there stands in for a later batch failing).
export async function noteOpenedPostcards(now = new Date(), opts: { beforeBatch?: (index: number) => Promise<void> } = {}): Promise<{ sent: number }> {
  const due = await db.postcard.findMany({ where: { opensAt: { lte: now }, openNoted: false }, select: { id: true, fromId: true, toId: true }, take: 500 });
  if (!due.length) return { sent: 0 };
  const senders = await db.account.findMany({ where: { id: { in: [...new Set(due.map((p) => p.fromId))] } }, select: { id: true, name: true } });
  const first = new Map(senders.map((a) => [a.id, a.name.trim().split(/\s+/)[0] || "A friend"]));
  // Read before the transaction starts: people who blocked the sender (or were blocked by them) get nothing, not even in Alerts.
  const { blockedEitherWay } = await import("@/lib/blocks");
  const blockedBy = new Map<string, Set<string>>();
  for (const from of new Set(due.map((p) => p.fromId))) blockedBy.set(from, await blockedEitherWay(from)); // if this fails the run fails (counted), nothing is claimed
  const recipients = new Set((await db.account.findMany({ where: { id: { in: [...new Set(due.map((p) => p.toId))] } }, select: { id: true } })).map((a) => a.id));

  let sent = 0;
  // At most 100 cards per transaction (each does a few writes), with room to finish: a long list can't hit the default time limit.
  for (let i = 0; i < due.length; i += BATCH) {
    const batch = due.slice(i, i + BATCH);
    await opts.beforeBatch?.(i / BATCH);
    const pushed: { to: string; fromId: string; title: string; body: string; url: string; tag: string }[] = [];
    let claimedHere = 0;
    await db.$transaction(
      async (tx) => {
        pushed.length = 0;
        claimedHere = 0;
        for (const p of batch) {
          const claimed = await tx.postcard.updateMany({ where: { id: p.id, openNoted: false }, data: { openNoted: true } });
          if (claimed.count !== 1) continue; // someone else already told this one
          claimedHere++;
          if (!recipients.has(p.toId) || blockedBy.get(p.fromId)?.has(p.toId)) continue;
          const title = "Your sealed postcard is open";
          const body = `${first.get(p.fromId) ?? "A friend"} wrote it for today.`;
          const url = `/postcards/${p.id}`;
          await tx.accountNote.create({ data: { accountId: p.toId, kind: "postcard", title: title.slice(0, 80), body: body.slice(0, 300), url } });
          pushed.push({ to: p.toId, fromId: p.fromId, title, body, url, tag: `postcard-open-${p.id}` });
        }
      },
      { timeout: 30000 },
    );
    sent += claimedHere;
    // This batch's phone alerts go out now, straight after it committed: a later batch failing can't lose them.
    for (const n of pushed) {
      try {
        await sendPushToAccounts([n.to], { title: n.title, body: n.body, url: n.url, tag: n.tag }, noteItem("postcard"));
      } catch {
        // a notification must never break the job
      }
    }
  }
  return { sent };
}
