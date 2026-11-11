import { headers } from "next/headers";
import { getAccount, getMemberships } from "@/lib/identity";
import { saveTimeZone } from "@/lib/nudge-zones";
import { allow, clientIp } from "@/lib/rate-limit";

// Remembers this phone's time zone (for the account, if signed in, and for this phone's people in
// their groups) so nudges arrive in the daytime where they are. A plain request, never loud:
// the phone ignores the answer.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const reply = (ok: boolean, status = 200) => Response.json({ ok }, { status, headers: NO_STORE });

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { tz?: unknown } | null;
    if (!(await allow(`tz:${clientIp(await headers())}`, 30, 3600))) return reply(false, 429);
    const account = await getAccount();
    const memberIds = Object.values(await getMemberships());
    return (await saveTimeZone(body?.tz, account?.id ?? null, memberIds)) ? reply(true) : reply(false, 400);
  } catch {
    return reply(false);
  }
}
