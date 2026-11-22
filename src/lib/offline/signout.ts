import { applyMe, wipeAll, type KV } from "./store";

// Sign out and Delete account leave a note in the browser ("clear this phone's offline data once the server has really signed this
// person out"). The next page settles it, in this order:
//   1. At once, everything is hidden from view (an empty "who am I": copies dropped, waiting expenses kept but hidden).
//   2. Ask the server. A signed-in account still on the phone means the sign-out or deletion did not happen: show things again.
//      No account any more: everything is wiped. No answer (offline, a busy server): stay hidden and keep the note, for as long as it takes.
// The note never expires by time: it ends only with a wipe or a confirmed "still signed in".
export type MeAnswer = { on: boolean; groups: Record<string, string>; account: boolean } | null;
export type Note = { read: () => number | null; clear: () => void };
export type Settled = "none" | "hidden" | "wiped" | "restored";

export async function settleSignOutNote(kv: KV, note: Note, ask: () => Promise<MeAnswer>): Promise<Settled> {
  if (note.read() === null) return "none";
  await applyMe(kv, {});
  const me = await ask();
  if (!me) return "hidden";
  if (!me.account) {
    await wipeAll(kv);
    note.clear();
    return "wiped";
  }
  note.clear();
  if (me.on) await applyMe(kv, me.groups);
  return "restored";
}
