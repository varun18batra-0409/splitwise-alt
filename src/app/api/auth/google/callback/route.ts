import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { GOOGLE_COOKIE, checkGoogleClaims, exchangeGoogleCode, googleConfigured, unpackAttempt } from "@/lib/google";
import { ipCountry } from "@/lib/region";
import { AccountSetupError, accountForEmail } from "@/lib/auth";
import { moveFromAttempt, signInAs } from "@/lib/identity";
import { safePath } from "@/lib/paths";
import { VIEWER_COOKIE, cleanViewer, flashTo, newViewerId, viewerCookieOptions } from "@/lib/flash";

// Back from Google: check it's the attempt we started, ask Google who it is,
// then sign in to the account with that email (made if it's new).
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const attempt = unpackAttempt(req.cookies.get(GOOGLE_COOKIE)?.value);
  const back = safePath(attempt?.back);
  const fail = async (error: string) => {
    const have = cleanViewer(req.cookies.get(VIEWER_COOKIE)?.value);
    const viewer = have || newViewerId();
    const res = NextResponse.redirect(new URL(await flashTo("/signin", { error }, { back }, "", Date.now(), viewer), req.url), 303);
    if (!have) res.cookies.set(VIEWER_COOKIE, viewer, viewerCookieOptions());
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

  let account;
  try {
    account = await accountForEmail(who.email, who.name, ipCountry(req.headers) ?? "");
  } catch (err) {
    if (err instanceof AccountSetupError) return fail("Couldn’t finish setting up your account. Wait a minute and try again.");
    throw err;
  }
  if (!account.name && who.name) await db.account.update({ where: { id: account.id }, data: { name: who.name } });
  // Only the groups the person agreed to move before leaving for Google, sealed into this very attempt (none if they were never asked).
  await signInAs(account.id, { confirmed: await moveFromAttempt(attempt.state, attempt.move) });
  const res = NextResponse.redirect(new URL(`${back}${back.includes("?") ? "&" : "?"}signedin=1`, req.url), 303);
  res.cookies.delete({ name: GOOGLE_COOKIE, path: "/api/auth/google" });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
