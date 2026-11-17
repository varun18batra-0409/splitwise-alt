import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_COOKIE, googleAuthUrl, googleConfigured, newGoogleRequest, packAttempt } from "@/lib/google";
import { safePath } from "@/lib/paths";
import { VIEWER_COOKIE, cleanViewer, flashTo, newViewerId, viewerCookieOptions } from "@/lib/flash";
import { allow, clientIp } from "@/lib/rate-limit";

// "Continue with Google": off to Google's account picker.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const back = safePath(req.nextUrl.searchParams.get("back"));
  if (!googleConfigured()) return NextResponse.redirect(new URL(`/signin?back=${encodeURIComponent(back)}`, req.url), 303);
  if (!(await allow(`google-start:${clientIp(req.headers)}`, 60, 3600))) {
    // The message is tied to this browser (lp_v), which is set here if it has none yet.
    const have = cleanViewer(req.cookies.get(VIEWER_COOKIE)?.value);
    const viewer = have || newViewerId();
    const limited = NextResponse.redirect(new URL(await flashTo("/signin", { error: "Too many tries. Wait a few minutes." }, { back }, "", Date.now(), viewer), req.url), 303);
    if (!have) limited.cookies.set(VIEWER_COOKIE, viewer, viewerCookieOptions());
    return limited;
  }
  const { state, verifier, challenge } = newGoogleRequest();
  const redirectUri = new URL("/api/auth/google/callback", req.url).toString();
  const res = NextResponse.redirect(googleAuthUrl(process.env.GOOGLE_CLIENT_ID!, redirectUri, state, challenge), 307);
  res.cookies.set(GOOGLE_COOKIE, packAttempt(state, verifier, back), {
    httpOnly: true,
    sameSite: "lax",
    // Always secure when live. Only the automated browser tests on this machine (plain http) switch it off, so Safari keeps the cookie.
    secure: process.env.NODE_ENV === "production" && process.env.E2E_PLAIN_HTTP !== "1",
    path: "/api/auth/google",
    maxAge: 600,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
