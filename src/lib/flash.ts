import { signText, verifyText } from "@/lib/session";

// Error and "done" messages that travel in a page address (?error=...).
// Anyone can type an address, so a message is only shown if Loopin itself
// signed it, for that exact page, in the last 15 minutes. Forged text is
// simply not shown. Fixed short codes (?error=busy) are not free text and
// are still read as before by the pages that use them.

export const NOTE_KEYS = ["error", "skipped", "invited", "payError", "inviteError"] as const;
export type NoteKey = (typeof NOTE_KEYS)[number];
export type Notes = Partial<Record<NoteKey, string>>;

const MAX_AGE_MIN = 15;
const MAX_LEN = 300;
// "invited" carries a short list of names (as JSON) rather than a sentence.
const MAX_LEN_BY_KEY: Partial<Record<NoteKey, number>> = { invited: 2000 };
// The signature and time travel with the message; closing a message strips them too.
export const NOTE_SIGNATURE_PARAMS = ["et", "es"] as const;

// "/a/b/" and "/a/b?x" both mean "/a/b"; encoded and plain spellings agree.
function pathOf(url: string): string {
  const p = new URL(url, "http://x").pathname;
  return p.length > 1 ? p.replace(/\/+$/, "") || "/" : p;
}

function payload(path: string, et: number, notes: Notes): string {
  const parts = NOTE_KEYS.filter((k) => typeof notes[k] === "string").map((k) => `${k}=${notes[k]}`);
  return [`err`, path, String(et), ...parts].join("|") + "|";
}

// Adds the signed message(s) to a link. `notes` are the messages; any other query already on the link is kept.
export async function signedQuery(url: string, notes: Notes, now = Date.now()): Promise<string> {
  const path = pathOf(url);
  const et = Math.floor(now / 60000);
  const clean: Notes = {};
  for (const k of NOTE_KEYS) if (typeof notes[k] === "string") clean[k] = notes[k];
  const es = await signText(payload(path, et, clean));
  const hashAt = url.indexOf("#");
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  const q = new URLSearchParams();
  for (const k of NOTE_KEYS) if (clean[k] !== undefined) q.set(k, clean[k]!);
  q.set("et", String(et));
  q.set("es", es);
  return `${base}${base.includes("?") ? "&" : "?"}${q}${hash}`;
}

// For a link that already carries ?error=... (or the other message keys): signs what is in it.
// Links with none of those keys come back unchanged.
export async function flashUrl(url: string, now = Date.now()): Promise<string> {
  const u = new URL(url, "http://x");
  const notes: Notes = {};
  for (const k of NOTE_KEYS) {
    const v = u.searchParams.get(k);
    if (v !== null) notes[k] = v;
  }
  if (!Object.keys(notes).length) return url;
  // Take the messages out of the link, then put them back signed.
  const hashAt = url.indexOf("#");
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  const [pathPart, queryPart = ""] = splitOnce(base, "?");
  const rest = new URLSearchParams(queryPart);
  for (const k of NOTE_KEYS) rest.delete(k);
  rest.delete("et");
  rest.delete("es");
  const restText = rest.toString();
  const bare = restText ? `${pathPart}?${restText}` : pathPart;
  return `${await signedQuery(bare, notes, now)}${hash}`;
}

function splitOnce(s: string, sep: string): [string, string?] {
  const i = s.indexOf(sep);
  return i === -1 ? [s] : [s.slice(0, i), s.slice(i + 1)];
}

type Params = Record<string, string | string[] | undefined>;

// The messages on this page's address that Loopin signed for this page in the last 15 minutes. Anything else gives {}.
export async function readNotes(sp: Params, path: string, now = Date.now()): Promise<Notes> {
  const et = sp.et;
  const es = sp.es;
  if (typeof et !== "string" || typeof es !== "string" || !/^\d{1,10}$/.test(et)) return {};
  const age = Math.floor(now / 60000) - Number(et);
  if (age < -1 || age > MAX_AGE_MIN) return {};
  const notes: Notes = {};
  for (const k of NOTE_KEYS) {
    const v = sp[k];
    if (Array.isArray(v)) return {};
    if (typeof v === "string") notes[k] = v;
  }
  if (!Object.keys(notes).length) return {};
  if (!(await verifyText(payload(pathOf(path), Number(et), notes), es))) return {};
  const out: Notes = {};
  for (const k of NOTE_KEYS) if (notes[k] !== undefined) out[k] = notes[k]!.slice(0, MAX_LEN_BY_KEY[k] ?? MAX_LEN);
  return out;
}
