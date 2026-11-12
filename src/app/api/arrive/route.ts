import { NextResponse, type NextRequest } from "next/server";
import { looksLikePass } from "@/lib/move";
import { SESSION_COOKIE } from "@/lib/session";
import { safePath } from "@/lib/paths";

// On the new address: a link carrying a one-time pass lands here. Opening a link
// must never sign anyone in (someone could send you a pass for their own account),
// so this only passes the visitor on to a page that asks "Continue to Loopin as …?".
// The pass is used, and the sign-in set, only when they tap the button there.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const to = safePath(req.nextUrl.searchParams.get("to"));
  const t = req.nextUrl.searchParams.get("t");
  // Already signed in here, or no pass: just open the page. The pass is left unused.
  const dest = req.cookies.get(SESSION_COOKIE)?.value || !looksLikePass(t) ? new URL(to, req.url) : new URL(`/arrive?${new URLSearchParams({ t, to })}`, req.url);
  const res = NextResponse.redirect(dest, 303);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
