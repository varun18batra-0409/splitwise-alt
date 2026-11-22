import { COPY_DAYS, MAX_DRAFTS } from "./words";
import type { AddAnswer, Draft, DraftInput } from "./types";
import type { Snapshot } from "./snapshot-types";

// The phone's side of "add expenses offline": plain functions over a small storage interface, so they are tested with an in-memory
// store (no browser needed) and run in the browser over IndexedDB (idb.ts). Nothing here works out any money: a draft is kept exactly as
// typed and sent exactly as typed; the server does every sum.
//
// WHO SEES WHAT. Every copy and every draft carries the member it belongs to. It is shown only while the last answer from the server
// (`me`: group id -> member id, asked each time the app is opened online) says this phone is that member in that group. After a phone
// changes hands, or a sign-in ends, the old person's things are hidden, never shown to the next person. Drafts are kept (hidden) until
// that same person signs in again; copies of groups are simply dropped (they are re-saved on the next online open).

export type StoreName = "snapshots" | "drafts" | "meta";
export interface KV {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  del(store: StoreName, key: string): Promise<void>;
  all<T>(store: StoreName): Promise<T[]>;
  wipe(): Promise<void>;
}

const ME = "me";
type Me = { groups: Record<string, string>; at: number };
const DAY = 86_400_000;
const snapKey = (s: { memberId: string; groupId: string }) => `${s.memberId}:${s.groupId}`;

export async function readMe(kv: KV): Promise<Record<string, string>> {
  return (await kv.get<Me>("meta", ME))?.groups ?? {};
}

// The server's answer to "who am I in each group?". Copies that no longer match are dropped; drafts stay, hidden.
export async function applyMe(kv: KV, groups: Record<string, string>, now = Date.now()): Promise<void> {
  await kv.put("meta", ME, { groups, at: now } satisfies Me);
  await dropStale(kv, now);
  for (const s of await kv.all<Snapshot>("snapshots")) {
    if (groups[s.groupId] !== s.memberId) await kv.del("snapshots", snapKey(s));
  }
}

// Kept each time a group is opened online (the page has just proven who this person is in it).
export async function saveSnapshot(kv: KV, snap: Snapshot): Promise<void> {
  const me = await readMe(kv);
  await kv.put("snapshots", snapKey(snap), snap);
  await kv.put("meta", ME, { groups: { ...me, [snap.groupId]: snap.memberId }, at: Date.now() } satisfies Me);
}

export async function dropSnapshot(kv: KV, groupId: string, memberId: string): Promise<void> {
  await kv.del("snapshots", snapKey({ groupId, memberId }));
}

// The switch is off: no copies are kept (waiting expenses stay, they are the person's own typing).
export async function dropAllSnapshots(kv: KV): Promise<void> {
  for (const s of await kv.all<Snapshot>("snapshots")) await kv.del("snapshots", snapKey(s));
}

const fresh = (s: Snapshot, now: number) => now - Date.parse(s.savedAt) <= COPY_DAYS * DAY;

// A copy not opened online for more than 30 days is DELETED (not just hidden), as the privacy page says.
export async function dropStale(kv: KV, now = Date.now()): Promise<void> {
  for (const s of await kv.all<Snapshot>("snapshots")) if (!fresh(s, now)) await kv.del("snapshots", snapKey(s));
}

// The copy of a group, only for the person it belongs to, and only while it is no more than 30 days old.
export async function snapshotFor(kv: KV, groupId: string, now = Date.now()): Promise<Snapshot | undefined> {
  await dropStale(kv, now);
  const memberId = (await readMe(kv))[groupId];
  if (!memberId) return undefined;
  const s = await kv.get<Snapshot>("snapshots", snapKey({ groupId, memberId }));
  return s && fresh(s, now) ? s : undefined;
}

export async function visibleSnapshots(kv: KV, now = Date.now()): Promise<Snapshot[]> {
  await dropStale(kv, now);
  const me = await readMe(kv);
  return (await kv.all<Snapshot>("snapshots"))
    .filter((s) => me[s.groupId] === s.memberId && fresh(s, now))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- drafts ----

const byAge = (a: Draft, b: Draft) => a.typedAt - b.typedAt || a.key.localeCompare(b.key);

export async function allDraftsCount(kv: KV): Promise<number> {
  return (await kv.all<Draft>("drafts")).length; // hidden ones count too: they take room on this phone
}

// Visible = belongs to the person this phone is in that group right now. Oldest first.
export async function draftsFor(kv: KV, groupId?: string): Promise<Draft[]> {
  const me = await readMe(kv);
  return (await kv.all<Draft>("drafts")).filter((d) => me[d.groupId] === d.memberId && (!groupId || d.groupId === groupId)).sort(byAge);
}

export type AddDraftResult = { ok: true } | { ok: false; reason: "full" | "storage" };

// Saved only once it has been written AND read back; until then nothing says "saved".
export async function addDraft(kv: KV, input: DraftInput): Promise<AddDraftResult> {
  try {
    if ((await allDraftsCount(kv)) >= MAX_DRAFTS) return { ok: false, reason: "full" };
    const draft: Draft = { ...input, status: "waiting" };
    await kv.put("drafts", draft.key, draft);
    const back = await kv.get<Draft>("drafts", draft.key);
    return back && JSON.stringify(back) === JSON.stringify(draft) ? { ok: true } : { ok: false, reason: "storage" };
  } catch {
    return { ok: false, reason: "storage" };
  }
}

export async function patchDraft(kv: KV, key: string, patch: Partial<Draft>): Promise<void> {
  const d = await kv.get<Draft>("drafts", key);
  if (d) await kv.put("drafts", key, { ...d, ...patch, key: d.key });
}

// The ONLY ways a draft goes: the server confirmed its key (added, or already added), the person removed it, or they signed out.
export async function removeDraft(kv: KV, key: string): Promise<void> {
  await kv.del("drafts", key);
}
export async function removeConfirmed(kv: KV, done: Record<string, string>): Promise<void> {
  for (const key of Object.keys(done)) await removeDraft(kv, key);
}
export async function wipeAll(kv: KV): Promise<void> {
  await kv.wipe();
}

// ---- sending ----

export type Post = (draft: DraftInput, o: { dryRun?: boolean; allowDuplicate?: boolean }) => Promise<AddAnswer>; // throws when there is no signal
export type Lock = <T>(fn: () => Promise<T>) => Promise<T>;

// One sender per phone at a time (the browser's Web Locks; this is the fallback for a browser without them).
export function memoryLock(): Lock {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

export type RunResult = { added: number; stopped: boolean };

// What goes to the server: only the typed values (the status, reason and answers kept beside it stay on the phone).
function strip(d: Draft): DraftInput {
  const out: Record<string, unknown> = { ...d };
  for (const k of ["status", "reason", "code", "dup", "keepBoth"]) delete out[k];
  return out as DraftInput;
}

async function apply(kv: KV, d: Draft, a: AddAnswer): Promise<"stop" | "added" | "next"> {
  switch (a.status) {
    case "added":
      await removeDraft(kv, d.key); // the server confirmed this key: now it can go
      return "added";
    case "ok":
      if (d.status !== "waiting") await patchDraft(kv, d.key, { status: "waiting", reason: undefined, code: undefined, dup: undefined });
      return "next";
    case "duplicate":
      await patchDraft(kv, d.key, { status: "duplicate", dup: a.dup, reason: undefined, code: undefined });
      return "next";
    case "refused":
      await patchDraft(kv, d.key, { status: "refused", code: a.code, reason: a.reason, dup: undefined });
      return "next";
    default:
      return "stop"; // later: the rest keep waiting
  }
}

async function run(kv: KV, post: Post, o: { lock: Lock; groupId?: string; keys?: string[]; dryRun: boolean }): Promise<RunResult> {
  return o.lock(async () => {
    // Read inside the lock: a sender that went first has already removed what it added.
    const list = (await draftsFor(kv, o.groupId)).filter((d) => d.status !== "refused" && (!o.keys || o.keys.includes(d.key)));
    let added = 0;
    for (const d of list) {
      let answer: AddAnswer;
      try {
        answer = await post(strip(d), { dryRun: o.dryRun, allowDuplicate: d.keepBoth === true });
      } catch {
        return { added, stopped: true };
      }
      const r = await apply(kv, d, answer);
      if (r === "stop") return { added, stopped: true };
      if (r === "added") added++;
    }
    return { added, stopped: false };
  });
}

// Send the waiting expenses one at a time, oldest first. Anything but a clear answer from the server (no signal, busy, not signed in)
// stops the run and everything not yet answered keeps waiting. `keys` limits it to the ones the person ticked.
export const sendWaiting = (kv: KV, post: Post, o: { lock: Lock; groupId?: string; keys?: string[] }) => run(kv, post, { ...o, dryRun: false });

// When the sheet opens: ask the server about each waiting one without saving anything (the duplicate questions, refusals, and
// "already added" for a key whose reply was lost: those are removed, the server confirmed them).
export const checkWaiting = (kv: KV, post: Post, o: { lock: Lock; groupId?: string }) => run(kv, post, { ...o, dryRun: true });
