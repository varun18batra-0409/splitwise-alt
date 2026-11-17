import { createHmac } from "node:crypto";
import { secret } from "./session";

// A scrambled, keyed fingerprint of an email address, for the few places that must remember "this email" without keeping the email
// (a removal from a group, a block). It can't be turned back into the address; it only answers "is this the same address?".
//
// The key comes from exactly the secret the sign-in session uses (session.ts `secret()`: AUTH_SECRET, else the database token, and the
// same guard when neither exists on the live app), with its own label, so it never needs a new setting and never throws just because
// AUTH_SECRET is missing. `purpose` keeps the two uses apart. If that secret is ever changed, every session ends anyway, and old
// fingerprints stop matching with it (a removal or block is then no longer remembered across a new sign-up), which is acceptable.
export function fingerprintKey(): Buffer {
  return createHmac("sha256", secret()).update("loopin-fingerprint-v1").digest();
}

export function emailFingerprint(purpose: string, email: string): string {
  return createHmac("sha256", fingerprintKey()).update(`${purpose}:${email.trim().toLowerCase()}`).digest("hex");
}
