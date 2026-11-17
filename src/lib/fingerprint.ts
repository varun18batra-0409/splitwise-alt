import { createHash } from "node:crypto";

// A scrambled, keyed fingerprint of an email address, for the few places that must remember "this email" without keeping the email
// (a removal from a group, a block). It is keyed with AUTH_SECRET and nothing else: on the live app, with no AUTH_SECRET it refuses
// to work (it never falls back to another secret, or to a string written in the code). It can't be turned back into the address; it
// only answers "is this the same address?". `purpose` keeps the two uses apart. If the secret ever changed, old fingerprints would
// stop matching (a removal or block would then no longer be remembered across a new sign-up).

export function pepper(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.VERCEL_ENV === "production") throw new Error("Sign-in is not set up: AUTH_SECRET is missing on the live app.");
  return "loopin-dev"; // local development and automated tests only
}

export function emailFingerprint(purpose: string, email: string): string {
  return createHash("sha256").update(`${pepper()}:${purpose}:${email.trim().toLowerCase()}`).digest("hex");
}
