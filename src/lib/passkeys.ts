import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { db } from "./db";

// Fingerprint / face sign-in (passkeys, WebAuthn). Each challenge is kept
// server-side, used once, for five minutes. The site check (rpID + origin)
// means a passkey made for loopinapps.com only works on loopinapps.com.

const CHALLENGE_MS = 5 * 60_000;

// "loopinapps.com" for both loopinapps.com and www.loopinapps.com; "localhost" in tests.
export function relyingParty(origin: string): { rpID: string; origin: string } | null {
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" && u.hostname !== "localhost") return null;
    return { rpID: u.hostname.replace(/^www\./, ""), origin: u.origin };
  } catch {
    return null;
  }
}

async function keepChallenge(challenge: string, purpose: string) {
  await db.requestKey.create({ data: { key: `pk:${challenge}`, result: purpose } });
}
// Single use: returns what it was for, or null if unknown, used or expired.
async function takeChallenge(challenge: string, now = new Date()): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(challenge)) return null;
  const key = `pk:${challenge}`;
  const row = await db.requestKey.findUnique({ where: { key } });
  if (!row) return null;
  const gone = await db.requestKey.deleteMany({ where: { key } });
  if (gone.count !== 1 || now.getTime() - row.createdAt.getTime() > CHALLENGE_MS) return null;
  return row.result;
}

// The challenge the phone signed, from its response.
function challengeOf(response: { response?: { clientDataJSON?: string } }): string {
  try {
    const data = JSON.parse(Buffer.from(String(response.response?.clientDataJSON ?? ""), "base64url").toString());
    return String(data.challenge ?? "");
  } catch {
    return "";
  }
}

const transportsOf = (t: string) => (t ? (t.split(",") as AuthenticatorTransportFuture[]) : undefined);

export async function registrationOptions(accountId: string, origin: string) {
  const rp = relyingParty(origin);
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!rp || !account) return null;
  const existing = await db.passkey.findMany({ where: { accountId } });
  const options = await generateRegistrationOptions({
    rpName: "Loopin",
    rpID: rp.rpID,
    userName: account.email,
    userDisplayName: account.name || account.email,
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: transportsOf(p.transports) })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  await keepChallenge(options.challenge, `reg:${accountId}`);
  return options;
}

export async function saveRegistration(accountId: string, origin: string, response: RegistrationResponseJSON, label: string): Promise<boolean> {
  const rp = relyingParty(origin);
  if (!rp) return false;
  const challenge = challengeOf(response);
  if ((await takeChallenge(challenge)) !== `reg:${accountId}`) return false;
  const v = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID }).catch(() => null);
  if (!v?.verified || !v.registrationInfo) return false;
  const c = v.registrationInfo.credential;
  await db.passkey.upsert({
    where: { id: c.id },
    create: {
      id: c.id,
      accountId,
      publicKey: Buffer.from(c.publicKey).toString("base64url"),
      counter: c.counter,
      transports: (c.transports ?? []).join(","),
      label: label.slice(0, 40),
    },
    update: {},
  });
  return true;
}

export async function signInOptions(origin: string) {
  const rp = relyingParty(origin);
  if (!rp) return null;
  // No list of keys: the phone offers whichever Loopin passkeys it has.
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "preferred" });
  await keepChallenge(options.challenge, "login");
  return options;
}

// The account this passkey belongs to, or null.
export async function checkSignIn(origin: string, response: AuthenticationResponseJSON, now = new Date()): Promise<string | null> {
  const rp = relyingParty(origin);
  if (!rp) return null;
  const challenge = challengeOf(response);
  if ((await takeChallenge(challenge, now)) !== "login") return null;
  const key = await db.passkey.findUnique({ where: { id: String(response.id ?? "") } });
  if (!key) return null;
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    credential: { id: key.id, publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")), counter: key.counter, transports: transportsOf(key.transports) },
  }).catch(() => null);
  if (!v?.verified) return null;
  await db.passkey.update({ where: { id: key.id }, data: { counter: v.authenticationInfo.newCounter, lastUsedAt: now } });
  return key.accountId;
}

export async function listPasskeys(accountId: string) {
  return db.passkey.findMany({ where: { accountId }, orderBy: { createdAt: "asc" } });
}

export async function removePasskey(accountId: string, id: string) {
  return (await db.passkey.deleteMany({ where: { id, accountId } })).count === 1;
}
