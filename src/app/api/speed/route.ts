import { headers } from "next/headers";
import { db } from "@/lib/db";
import { allow, clientIp } from "@/lib/rate-limit";
import { cleanEntries } from "@/lib/speed";

// Phones send how long taps took (a handful at a time). Numbers only.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const entries = cleanEntries(await req.json().catch(() => null));
  if (!entries.length) return new Response(null, { status: 204 });
  if (!(await allow(`speed:${clientIp(await headers())}`, 120, 3600))) return new Response(null, { status: 204 });
  await db.speedLog.createMany({ data: entries.map((e) => ({ kind: e.k, route: e.r, ms: e.ms })) }).catch(() => undefined);
  return new Response(null, { status: 204 });
}
