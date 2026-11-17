import { signText, verifyText } from "@/lib/session";

// Error and "done" messages that travel in a page address (?error=...).
// Anyone can type an address, so a message is only shown if Loopin itself
// signed it, for that exact page, in the last 15 minutes. Forged text is
// simply not shown. Fixed short codes (?error=busy) are not free text and
// are still read as before by the pages that use them.
//
// The page (a path, or its pieces) and the message are always given SEPARATELY. A link is never taken apart to find a
// message in it: anything typed into an id could otherwise make Loopin sign text for a page of the attacker's choosing.

export const NOTE_KEYS = ["error", "skipped", "invited", "payError", "inviteError"] as const;
export type NoteKey = (typeof NOTE_KEYS)[number];
export type Notes = Partial<Record<NoteKey, string>>;
type Extra = Record<string, string | undefined> | URLSearchParams;

const MAX_AGE_MIN = 15;
const MAX_LEN = 300;
// "invited" carries a short list of names (as JSON) rather than a sentence. Cut-off JSON can't be read, so too long means not shown.
const MAX_LEN_BY_KEY: Partial<Record<NoteKey, number>> = { invited: 8000 };
// The signature and time travel with the message; closing a message strips them too.
export const NOTE_SIGNATURE_PARAMS = ["et", "es"] as const;

// "/a/b/" and "/a/b?x" both mean "/a/b"; encoded and plain spellings agree.
function pathOf(url: string): string {
  const p = new URL(url, "http://x").pathname;
  return p.length > 1 ? p.replace(/\/+$/, "") || "/" : p;
}

// A path Loopin is willing to sign for: plain pieces, nothing that a browser or server would resolve to somewhere else.
export function isPlainPath(path: string): boolean {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return false;
  if (!/^\/[A-Za-z0-9_~%.\/-]*$/.test(path)) return false;
  if (path.includes("//") || path.includes("..") || /%(2e|2f|5c|3f|23)/i.test(path) || /%(?![0-9A-Fa-f]{2})/.test(path)) return false;
  try {
    return pathOf(path) === (path.length > 1 ? path.replace(/\/+$/, "") || "/" : path);
  } catch {
    return false;
  }
}

// Ids and codes in a path come from forms and addresses, so each piece is encoded, and "", "." and ".." are refused.
function toPath(path: string | string[]): string | null {
  if (Array.isArray(path)) {
    if (path.some((s) => typeof s !== "string" || s === "" || s === "." || s === "..")) return null;
    const p = "/" + path.map((s) => encodeURIComponent(s)).join("/");
    return isPlainPath(p) ? p : null;
  }
  return isPlainPath(path) ? path : null;
}

// What is signed: the page, the minute, and each message in a fixed order (null when absent). As JSON, so no value can run into another.
function payload(path: string, et: number, notes: Notes): string {
  return JSON.stringify(["err", path, et, NOTE_KEYS.map((k) => (typeof notes[k] === "string" ? notes[k] : null))]);
}

function withQuery(extra: Extra | undefined): URLSearchParams {
  const q = new URLSearchParams();
  const skip = new Set<string>([...NOTE_KEYS, ...NOTE_SIGNATURE_PARAMS]);
  const entries = extra instanceof URLSearchParams ? [...extra.entries()] : Object.entries(extra ?? {});
  for (const [k, v] of entries) if (v !== undefined && !skip.has(k)) q.append(k, v);
  return q;
}

// The link to send someone to: `path` (or its pieces) plus the plain extras, and, if there are messages, the signed messages.
// A path that isn't plain gives "/" and no message.
export async function flashTo(path: string | string[], notes: Notes, extra?: Extra, hash = "", now = Date.now()): Promise<string> {
  return flashToAt(path, notes, Math.floor(now / 60000), extra, hash);
}

// The same with the minute given: used to carry a message to another page without extending its 15 minutes.
export async function flashToAt(path: string | string[], notes: Notes, et: number, extra?: Extra, hash = ""): Promise<string> {
  const p = toPath(path);
  if (p === null) return "/";
  const q = withQuery(extra);
  const clean: Notes = {};
  for (const k of NOTE_KEYS) if (typeof notes[k] === "string") clean[k] = notes[k];
  if (Object.keys(clean).length) {
    for (const k of NOTE_KEYS) if (clean[k] !== undefined) q.set(k, clean[k]!);
    q.set("et", String(et));
    q.set("es", await signText(payload(pathOf(p), et, clean)));
  }
  const qs = q.toString();
  const h = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
  return `${p}${qs ? `?${qs}` : ""}${h}`;
}

type Params = Record<string, string | string[] | undefined>;

// The messages on this page's address that Loopin signed for this page in the last 15 minutes, and the minute they were signed.
export async function readSignedNotes(sp: Params, path: string, now = Date.now()): Promise<{ notes: Notes; et: number } | null> {
  const et = sp.et;
  const es = sp.es;
  if (typeof et !== "string" || typeof es !== "string" || !/^\d{1,10}$/.test(et)) return null;
  const age = Math.floor(now / 60000) - Number(et);
  if (age < -1 || age > MAX_AGE_MIN) return null;
  const notes: Notes = {};
  for (const k of NOTE_KEYS) {
    const v = sp[k];
    if (Array.isArray(v)) return null;
    if (typeof v === "string") notes[k] = v;
  }
  if (!Object.keys(notes).length) return null;
  if (!(await verifyText(payload(pathOf(path), Number(et), notes), es))) return null;
  const out: Notes = {};
  for (const k of NOTE_KEYS) {
    const v = notes[k];
    if (v === undefined) continue;
    const cap = MAX_LEN_BY_KEY[k] ?? MAX_LEN;
    if (k === "invited") {
      if (v.length <= cap) out[k] = v; // a cut-off list can't be read: show nothing instead
    } else out[k] = v.slice(0, cap);
  }
  return { notes: out, et: Number(et) };
}

// Anything that isn't signed for this page, or is too old, gives {}.
export async function readNotes(sp: Params, path: string, now = Date.now()): Promise<Notes> {
  return (await readSignedNotes(sp, path, now))?.notes ?? {};
}
