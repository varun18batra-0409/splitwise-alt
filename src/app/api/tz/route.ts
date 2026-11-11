import { headers } from "next/headers";
import { getAccount, getMemberships } from "@/lib/identity";
import { saveTimeZone } from "@/lib/nudge-zones";
import { allow, clientIp } from "@/lib/rate-limit";

// Remembers this phone's time zone (for the account, if signed in, and for this phone's people in
// their groups) so nudges arrive in the daytime where they are. A plain request, never loud:
// the phone only remembers that it was sent when the answer is a success.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const reply = (ok: boolean, status = 200) => Response.json({ ok }, { status, headers: NO_STORE });

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { tz?: unknown } | null;
    // Generous per network address (many phones share one mobile address), tighter per person.
    if (!(await allow(`tz:${clientIp(await headers())}`, 120, 3600))) return reply(false, 429);
    const account = await getAccount();
    const memberIds = Object.values(await getMemberships());
    const who = account?.id ?? memberIds[0];
    if (who && !(await allow(`tz-who:${who}`, 20, 3600))) return reply(false, 429);
    return (await saveTimeZone(body?.tz, account?.id ?? null, memberIds)) ? reply(true) : reply(false, 400);
  } catch {
    return reply(false, 500); // a real failure: the phone must not treat it as saved (it tries again later)
  }
}
