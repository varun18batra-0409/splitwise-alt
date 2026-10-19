import { NextResponse, type NextRequest } from "next/server";
import { createMovePass } from "@/lib/move";
import { PRIMARY_HOST, isOldHost } from "@/lib/move-rules";
import { SESSION_COOKIE } from "@/lib/session";
import { safePath } from "@/lib/paths";

// On the old address: hand a signed-in person a one-time pass to the new one.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const to = safePath(req.nextUrl.searchParams.get("to"));
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!isOldHost(host)) return NextResponse.redirect(new URL(to, req.url), 307);
  const token = await createMovePass(req.cookies.get(SESSION_COOKIE)?.value, req.cookies.get("lp_tour")?.value === "1").catch(() => null);
  const dest = token
    ? `https://${PRIMARY_HOST}/api/arrive?t=${token}&to=${encodeURIComponent(to)}`
    : `https://${PRIMARY_HOST}${to}`;
  const res = NextResponse.redirect(dest, 307);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
