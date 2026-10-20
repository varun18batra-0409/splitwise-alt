import { createHash, randomBytes } from "node:crypto";
import { cleanEmail } from "./auth";

// "Continue with Google": Google's standard sign-in (OpenID Connect,
// authorization code + PKCE). Switched on by GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET in the hosting settings; without them the button
// simply isn't shown.

export const GOOGLE_COOKIE = "lp_g";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

const b64url = (b: Buffer) => b.toString("base64url");

// A fresh state (against forged returns) and PKCE pair (against stolen codes).
export function newGoogleRequest() {
  const state = b64url(randomBytes(18));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { state, verifier, challenge };
}

export function googleAuthUrl(clientId: string, redirectUri: string, state: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTH_URL}?${q}`;
}

// The cookie that remembers this sign-in attempt: "state.verifier.back".
export function packAttempt(state: string, verifier: string, back: string): string {
  return `${state}.${verifier}.${b64url(Buffer.from(back))}`;
}
export function unpackAttempt(raw: string | undefined): { state: string; verifier: string; back: string } | null {
  const parts = String(raw ?? "").split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1]) return null;
  try {
    return { state: parts[0], verifier: parts[1], back: Buffer.from(parts[2], "base64url").toString() };
  } catch {
    return null;
  }
}

// Who Google says this is. The ID token comes straight from Google's token
// endpoint over HTTPS (so it needn't be re-verified, per OpenID Connect
// 3.1.3.7), but its claims are still checked: our app, Google, not expired,
// and a verified email.
export type GoogleClaims = { aud?: unknown; iss?: unknown; exp?: unknown; email?: unknown; email_verified?: unknown; given_name?: unknown; name?: unknown };
export function checkGoogleClaims(c: GoogleClaims | null, clientId: string, nowSec: number): { email: string; name: string } | null {
  if (!c || c.aud !== clientId) return null;
  if (c.iss !== "accounts.google.com" && c.iss !== "https://accounts.google.com") return null;
  if (typeof c.exp !== "number" || c.exp < nowSec) return null;
  if (c.email_verified !== true && c.email_verified !== "true") return null;
  const email = cleanEmail(String(c.email ?? ""));
  if (!email) return null;
  const name = String(c.given_name || c.name || "").trim().slice(0, 40);
  return { email, name };
}

export function decodeJwtPayload(token: string): GoogleClaims | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString()) as GoogleClaims;
  } catch {
    return null;
  }
}

// Swap the one-time code for the ID token.
export async function exchangeGoogleCode(code: string, verifier: string, redirectUri: string, fetchImpl: typeof fetch = fetch): Promise<GoogleClaims | null> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { id_token?: string };
  return j.id_token ? decodeJwtPayload(j.id_token) : null;
}
