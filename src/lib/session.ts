// "Who you are" on this phone, kept in one signed cookie so it can't be
// edited or forged: { m: { groupId: memberId }, a?: accountId }.
// Works in both the server and the edge middleware (Web Crypto only).

export const SESSION_COOKIE = "sw_me";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365 * 5; // five years

export type Session = { m: Record<string, string>; a?: string };

const enc = new TextEncoder();

function secret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.TURSO_AUTH_TOKEN) return `loopin-session:${process.env.TURSO_AUTH_TOKEN}`;
  return "loopin-local-development-secret";
}

let cached: { secret: string; key: Promise<CryptoKey> } | null = null;
function key(): Promise<CryptoKey> {
  const s = secret();
  if (!cached || cached.secret !== s) {
    cached = { secret: s, key: crypto.subtle.importKey("raw", enc.encode(s), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]) };
  }
  return cached.key;
}

function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function clean(v: unknown): Session | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { m?: unknown; a?: unknown };
  if (!o.m || typeof o.m !== "object") return null;
  const m: Record<string, string> = {};
  for (const [g, id] of Object.entries(o.m as Record<string, unknown>)) {
    if (typeof id === "string" && g.length < 64 && id.length < 64) m[g] = id;
  }
  return typeof o.a === "string" && o.a.length < 64 ? { m, a: o.a } : { m };
}

export async function encodeSession(s: Session): Promise<string> {
  const payload = toB64url(enc.encode(JSON.stringify(s)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(), enc.encode(payload)));
  return `${payload}.${toB64url(sig)}`;
}

// Null when missing, tampered with, or signed with another secret.
export async function decodeSession(raw: string | undefined | null): Promise<Session | null> {
  if (!raw) return null;
  const dot = raw.indexOf(".");
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  try {
    const sig = fromB64url(raw.slice(dot + 1));
    const ok = await crypto.subtle.verify("HMAC", await key(), sig, enc.encode(payload));
    if (!ok) return null;
    return clean(JSON.parse(new TextDecoder().decode(fromB64url(payload))));
  } catch {
    return null;
  }
}
