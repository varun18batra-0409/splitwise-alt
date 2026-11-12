import { headers } from "next/headers";
import { clientIp } from "@/lib/rate-limit";
import { handleTimeZone } from "@/lib/tz-request";

// Remembers this phone's time zone (for the account, if signed in, and for this phone's people in
// their groups) so nudges arrive in the daytime where they are. A plain request, never loud:
// the phone only remembers that it was sent when the answer is a success. The rules live in lib/tz-request.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { tz?: unknown } | null;
    const r = await handleTimeZone(body, clientIp(await headers()));
    return Response.json({ ok: r.ok }, { status: r.status, headers: NO_STORE });
  } catch {
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
