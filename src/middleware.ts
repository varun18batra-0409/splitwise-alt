import { NextResponse, type NextRequest } from "next/server";
import { PRIMARY_HOST, shouldMove } from "@/lib/move-rules";
import { SESSION_COOKIE, SESSION_MAX_AGE, SESSION_RENEW_DAYS, decodeSession, encodeSession, today } from "@/lib/session";

// Old address → loopinapps.com. Signed-in people go through /api/move, which
// carries their sign-in across; everyone else goes straight to the same page.
// On the app itself: a sign-in lasts a year and is quietly renewed while the
// phone keeps using Loopin (once a month at most).
export async function middleware(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!shouldMove(host, req.method, req.nextUrl.pathname)) return renew(req);
  const to = req.nextUrl.pathname + req.nextUrl.search;
  if (req.cookies.has(SESSION_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = "/api/move";
    url.search = `?to=${encodeURIComponent(to)}`;
    return NextResponse.redirect(url, 307);
  }
  return NextResponse.redirect(`https://${PRIMARY_HOST}${to}`, 307);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api/).*)"],
};

// Scripts on pages: only Next.js's own and ours, each carrying this request's
// one-time key (nonce), instead of allowing any inline script.
function pageCsp(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
  ].join("; ");
}

async function renew(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = pageCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (!raw || req.method !== "GET") return res;
  const s = await decodeSession(raw);
  if (!s || (s.t !== undefined && today() - s.t < SESSION_RENEW_DAYS)) return res;
  res.cookies.set(SESSION_COOKIE, await encodeSession({ ...s, t: today() }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.E2E_PLAIN_HTTP !== "1",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
