import { headers } from "next/headers";
import { getMemberships } from "@/lib/identity";
import { savePushFor, validSub } from "@/lib/push-subs";
import { allow, clientIp } from "@/lib/rate-limit";

// Keeps this phone's notifications on for groups joined since last time. A
// plain request (not a server action), so opening the app never queues
// behind it.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sub = validSub(await req.json().catch(() => null));
  if (!sub) return Response.json({ ok: false }, { status: 400 });
  if (!(await allow(`push:${clientIp(await headers())}`, 60, 3600))) return Response.json({ ok: false }, { status: 429 });
  return Response.json(await savePushFor(await getMemberships(), sub));
}
