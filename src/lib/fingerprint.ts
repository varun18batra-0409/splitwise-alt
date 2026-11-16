import { createHash } from "node:crypto";

// A scrambled, keyed fingerprint of an email address, for the few places that must remember "this email" without keeping the email
// (a removal from a group, a block). It uses the same secret as the sign-in code hashes. It can't be turned back into the address; it
// only answers "is this the same address?". `purpose` keeps the two uses apart. If the secret ever changed, old fingerprints would
// stop matching (the check then fails open: nobody is locked out).

function devPepper(): string {
  if (process.env.VERCEL_ENV === "production") throw new Error("Sign-in is not set up: AUTH_SECRET is missing on the live app.");
  return "loopin-dev";
}

export function pepper(): string {
  return process.env.AUTH_SECRET ?? process.env.TURSO_AUTH_TOKEN ?? devPepper();
}

export function emailFingerprint(purpose: string, email: string): string {
  return createHash("sha256").update(`${pepper()}:${purpose}:${email.trim().toLowerCase()}`).digest("hex");
}
