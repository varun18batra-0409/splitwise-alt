import { NextResponse, type NextRequest } from "next/server";
import { redeemMovePass } from "@/lib/move";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";
import { safePath } from "@/lib/paths";

// On the new address: swap the one-time pass for the sign-in, then open the
// page they asked for (with a one-time "Loopin has a new address" note).
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const to = safePath(req.nextUrl.searchParams.get("to"));
  const pass = await redeemMovePass(req.nextUrl.searchParams.get("t")).catch(() => null);
  const dest = new URL(to, req.url);
  if (pass) dest.searchParams.set("moved", "1");
  const res = NextResponse.redirect(dest, 303);
  res.headers.set("Cache-Control", "no-store");
  if (pass) {
    const secure = process.env.NODE_ENV === "production";
    res.cookies.set(SESSION_COOKIE, pass.session, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SESSION_MAX_AGE });
    if (pass.tourSeen) res.cookies.set("lp_tour", "1", { sameSite: "lax", secure, path: "/", maxAge: 31536000 });
  }
  return res;
}
