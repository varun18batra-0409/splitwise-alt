import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_COOKIE, googleAuthUrl, googleConfigured, newGoogleRequest, packAttempt } from "@/lib/google";
import { safePath } from "@/lib/paths";
import { allow, clientIp } from "@/lib/rate-limit";
import { sealMoveForAttempt, takeMoveConfirmation } from "@/lib/identity";

// "Continue with Google": off to Google's account picker.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const back = safePath(req.nextUrl.searchParams.get("back"));
  if (!googleConfigured()) return NextResponse.redirect(new URL(`/signin?back=${encodeURIComponent(back)}`, req.url), 303);
  if (!(await allow(`google-start:${clientIp(req.headers)}`, 60, 3600))) {
    return NextResponse.redirect(new URL(`/signin?${new URLSearchParams({ back, error: "Too many tries. Wait a few minutes." })}`, req.url), 303);
  }
  const { state, verifier, challenge } = newGoogleRequest();
  // The "Move them and continue" note (fresh, signed; always used up here) is sealed into THIS attempt, so it can only be used by it.
  const agreed = await takeMoveConfirmation();
  const redirectUri = new URL("/api/auth/google/callback", req.url).toString();
  const res = NextResponse.redirect(googleAuthUrl(process.env.GOOGLE_CLIENT_ID!, redirectUri, state, challenge), 307);
  res.cookies.set(GOOGLE_COOKIE, packAttempt(state, verifier, back, agreed.length ? await sealMoveForAttempt(state, agreed) : undefined), {
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
