import { NextResponse, type NextRequest } from "next/server";
import { LEGACY_UNTIL, SESSION_COOKIE, SESSION_MAX_AGE, decodeSession, encodeSession, parseLegacy } from "@/lib/session";

// Upgrades the old, unsigned "who you are" cookie to the signed one, so
// people who used the app before don't have to pick their names again.
export async function middleware(req: NextRequest) {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (!raw || Date.now() > LEGACY_UNTIL) return NextResponse.next();
  if (await decodeSession(raw)) return NextResponse.next();
  const legacy = parseLegacy(raw);
  if (!legacy) return NextResponse.next();

  const value = await encodeSession(legacy);
  req.cookies.set(SESSION_COOKIE, value);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

export const config = {
  matcher: ["/((?!_next/|sw\\.js|manifest\\.webmanifest|icon|apple-icon|.*\\.png$).*)"],
};
