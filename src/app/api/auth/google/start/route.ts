import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_COOKIE, googleAuthUrl, googleConfigured, newGoogleRequest, packAttempt } from "@/lib/google";
import { safePath } from "@/lib/paths";
import { allow, clientIp } from "@/lib/rate-limit";

// "Continue with Google": off to Google's account picker.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const back = safePath(req.nextUrl.searchParams.get("back"));
  if (!googleConfigured()) return NextResponse.redirect(new URL(`/signin?back=${encodeURIComponent(back)}`, req.url), 303);
  if (!(await allow(`google-start:${clientIp(req.headers)}`, 60, 3600))) {
    return NextResponse.redirect(new URL(`/signin?${new URLSearchParams({ back, error: "Too many tries. Wait a few minutes." })}`, req.url), 303);
  }
  const { state, verifier, challenge } = newGoogleRequest();
  const redirectUri = new URL("/api/auth/google/callback", req.url).toString();
  const res = NextResponse.redirect(googleAuthUrl(process.env.GOOGLE_CLIENT_ID!, redirectUri, state, challenge), 307);
  res.cookies.set(GOOGLE_COOKIE, packAttempt(state, verifier, back), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: 600,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
