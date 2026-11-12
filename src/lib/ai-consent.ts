import { cookies } from "next/headers";
import { db } from "./db";
import { getAccount } from "./identity";

// "Let Loopin's AI read this?" Nothing is sent to the AI (Anthropic) unless the person said yes.
// Signed-in people: the answer lives on the account (Account.aiConsent / aiConsentAt).
// Phone-only people (no account): a cookie on this phone. Both are checked on the server, never trusted from the screen.
// "" = never asked, which counts as no.

export type AiConsent = "yes" | "no" | "";
export const AI_CONSENT_COOKIE = "loopin_ai";
const TWO_YEARS = 60 * 60 * 24 * 730;

export const cleanConsent = (v: unknown): AiConsent => (v === "yes" || v === "no" ? v : "");

// Whose answer counts: the signed-in account on this phone, else the account the group member is linked to, else nobody (the cookie).
export async function consentAccountId(memberAccountId: string | null | undefined): Promise<string | null> {
  return (await getAccount())?.id ?? memberAccountId ?? null;
}

// The answer for this person: their account if they have one, else this phone's cookie.
export async function aiConsentFor(accountId: string | null | undefined): Promise<AiConsent> {
  if (accountId) {
    const a = await db.account.findUnique({ where: { id: accountId }, select: { aiConsent: true } });
    return cleanConsent(a?.aiConsent);
  }
  return cleanConsent((await cookies()).get(AI_CONSENT_COOKIE)?.value);
}

// Save the answer. Signed in: on the account. Otherwise: on this phone.
export async function recordAiConsent(accountId: string | null | undefined, answer: "yes" | "no"): Promise<void> {
  if (accountId) {
    await db.account.update({ where: { id: accountId }, data: { aiConsent: answer, aiConsentAt: new Date() } });
    return;
  }
  (await cookies()).set(AI_CONSENT_COOKIE, answer, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.E2E_PLAIN_HTTP !== "1",
    path: "/",
    maxAge: TWO_YEARS,
  });
}

// What to tell the screen when the AI must not be called. null = go ahead.
export function consentRefusal(consent: AiConsent): { needsConsent: boolean; error: string } | null {
  if (consent === "yes") return null;
  return consent === "no"
    ? { needsConsent: false, error: "AI reading is off. You can turn it on in You → Privacy." }
    : { needsConsent: true, error: "Loopin asks before its AI reads anything. Allow it, or fill this in by hand." };
}
