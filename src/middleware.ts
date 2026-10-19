import { NextResponse, type NextRequest } from "next/server";
import { PRIMARY_HOST, shouldMove } from "@/lib/move-rules";
import { SESSION_COOKIE } from "@/lib/session";

// Old address → loopinapps.com. Signed-in people go through /api/move, which
// carries their sign-in across; everyone else goes straight to the same page.
export function middleware(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!shouldMove(host, req.method, req.nextUrl.pathname)) return NextResponse.next();
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
