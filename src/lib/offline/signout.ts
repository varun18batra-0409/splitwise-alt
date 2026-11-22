import { applyMe, wipeAll, type KV } from "./store";
import type { Draft } from "./types";

// Sign out and Delete account leave a note in the browser ("clear this phone's offline data once the server has really finished"). The next
// page settles it, in this order:
//   1. At once, everything is hidden from view (an empty "who am I": copies dropped, waiting expenses kept but hidden).
//   2. Ask the server. It can say:
//        left      the sign-out / deletion this phone asked for has FINISHED (a short note set by that very action) -> wipe, whoever is signed in now.
//        no account  nobody is signed in -> wipe.
//        account, no `left`  an answer that may have left BEFORE the sign-out finished: never taken as "still signed in" at once. Hidden stays.
//                            Only when the note is older than RESTORE_AFTER_MS (a sign-out takes seconds, so the sign-out did not happen)
//                            are things shown again.
//        no answer (offline, a busy server)  stays hidden, the note is kept.
export type MeAnswer = { on: boolean; groups: Record<string, string>; account: boolean; left: boolean } | null;
export type Note = { read: () => number | null; clear: () => void };
export type Settled = "none" | "hidden" | "wiped" | "restored";
export const RESTORE_AFTER_MS = 2 * 60_000;

export async function settleSignOutNote(kv: KV, note: Note, ask: () => Promise<MeAnswer>, now = Date.now()): Promise<Settled> {
  const at = note.read();
  if (at === null) return "none";
  await applyMe(kv, {});
  const me = await ask();
  if (!me) return "hidden";
  if (me.left || !me.account) {
    await wipeAll(kv);
    note.clear();
    return "wiped";
  }
  if (now - at < RESTORE_AFTER_MS) return "hidden"; // may be an answer from before the sign-out finished: wait, ask again on the next page
  note.clear();
  if (me.on) {
    await applyMe(kv, me.groups);
    // Waiting expenses that belong to nobody signed in now (an earlier person's) never linger.
    for (const d of await kv.all<Draft>("drafts")) if (me.groups[d.groupId] !== d.memberId) await kv.del("drafts", d.key);
  }
  return "restored";
}
