import type { AddAnswer, DraftInput } from "./types";
import type { Post } from "./store";

// The browser's calls to the server for offline adding (fixed web addresses, not server actions: see the plan, 2e).

// "Is there a signal?" The real answer is a tiny reply from our own server, never just navigator.onLine.
export async function ping(): Promise<boolean> {
  try {
    const r = await fetch("/api/ping", { cache: "no-store", signal: AbortSignal.timeout(5000) });
    return r.ok && (await r.text()) === "ok";
  } catch {
    return false;
  }
}

// Throws when there is no usable answer (no signal, or not our server): the run then stops and everything keeps waiting.
export const postDraft: Post = async (draft: DraftInput, o) => {
  const r = await fetch("/api/offline/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ draft, dryRun: o.dryRun === true, allowDuplicate: o.allowDuplicate === true }),
    signal: AbortSignal.timeout(20_000),
  });
  if (r.redirected || !(r.headers.get("content-type") ?? "").includes("application/json")) throw new Error("not an answer");
  const a = (await r.json()) as AddAnswer;
  if (!a || typeof a.status !== "string") throw new Error("not an answer");
  return a;
};

export async function fetchMe(): Promise<{ on: boolean; groups: Record<string, string>; signedOut: boolean } | null> {
  try {
    const r = await fetch("/api/offline/me", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { on?: boolean; groups?: Record<string, string>; signedOut?: boolean };
    return { on: j.on === true, groups: j.groups && typeof j.groups === "object" ? j.groups : {}, signedOut: j.signedOut === true };
  } catch {
    return null;
  }
}

// `drafts`: what each waiting expense says (so one that was changed after an online try is never mistaken for the one already added).
export async function fetchDone(drafts: { key: string; amount: string; currency: string; name: string }[]): Promise<Record<string, string>> {
  const keys = drafts.map((d) => d.key);
  const typed = Object.fromEntries(drafts.map((d) => [d.key, { amount: d.amount, currency: d.currency, name: d.name }]));
  if (!keys.length) return {};
  try {
    const r = await fetch("/api/offline/status", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ keys, typed }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) return {};
    const j = (await r.json()) as { done?: Record<string, string> };
    return j.done && typeof j.done === "object" ? j.done : {};
  } catch {
    return {};
  }
}

export function newDraftKey(): string {
  const c: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return `off-${c.randomUUID()}`;
  const b = new Uint8Array(16);
  if (c) c.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  return `off-${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

// "Not now" and "shown once this visit": remembered for this tab only.
const seenKey = (groupId: string) => `offline-sheet-${groupId}`;
export const sheetSeen = (groupId: string) => {
  try {
    return sessionStorage.getItem(seenKey(groupId)) === "1";
  } catch {
    return false;
  }
};
export const markSheetSeen = (groupId: string) => {
  try {
    sessionStorage.setItem(seenKey(groupId), "1");
  } catch {
    /* ignore */
  }
};
