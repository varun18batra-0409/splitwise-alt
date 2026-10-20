import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { GOOGLE_COOKIE, checkGoogleClaims, exchangeGoogleCode, googleConfigured, unpackAttempt } from "@/lib/google";
import { signInAs } from "@/lib/identity";
import { safePath } from "@/lib/paths";

// Back from Google: check it's the attempt we started, ask Google who it is,
// then sign in to the account with that email (made if it's new).
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const attempt = unpackAttempt(req.cookies.get(GOOGLE_COOKIE)?.value);
  const back = safePath(attempt?.back);
  const fail = (error: string) => {
    const res = NextResponse.redirect(new URL(`/signin?${new URLSearchParams({ back, error })}`, req.url), 303);
    res.cookies.delete({ name: GOOGLE_COOKIE, path: "/api/auth/google" });
    return res;
  };
  if (!googleConfigured()) return fail("Google sign-in isn’t switched on.");
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return fail("Google sign-in was cancelled. Try again, or use your email.");
  if (!attempt || !q.get("state") || q.get("state") !== attempt.state || !q.get("code")) {
    return fail("That sign-in link expired. Tap Continue with Google again.");
  }
  const redirectUri = new URL("/api/auth/google/callback", req.url).toString();
  const claims = await exchangeGoogleCode(q.get("code")!, attempt.verifier, redirectUri).catch(() => null);
  const who = checkGoogleClaims(claims, process.env.GOOGLE_CLIENT_ID!, Math.floor(Date.now() / 1000));
  if (!who) return fail("Couldn’t sign in with Google. Try again, or use your email.");

  const account = await db.account.upsert({ where: { email: who.email }, create: { email: who.email, name: who.name }, update: {} });
  if (!account.name && who.name) await db.account.update({ where: { id: account.id }, data: { name: who.name } });
  await signInAs(account.id);
  const res = NextResponse.redirect(new URL(`${back}${back.includes("?") ? "&" : "?"}signedin=1`, req.url), 303);
  res.cookies.delete({ name: GOOGLE_COOKIE, path: "/api/auth/google" });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
