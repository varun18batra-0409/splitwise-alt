import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { allow, clientIp } from "@/lib/rate-limit";
import { sendDayPulse } from "@/lib/countdown-db";

// The evening job (Vercel Cron, 21:30 India time): the day-end pulse for trips
// happening today. Safe to run more than once: each trip gets one a day.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sameSecret(given: string | null, secret: string) {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && !sameSecret(req.headers.get("authorization"), secret)) return Response.json({ error: "Not allowed" }, { status: 401 });
  if (!secret && !(await allow(`cron-evening:${clientIp(await headers())}`, 6, 3600))) return Response.json({ error: "Too many runs" }, { status: 429 });
  try {
    return Response.json({ ok: true, pulse: await sendDayPulse(new Date()) });
  } catch (err) {
    console.error("evening job failed", String(err).slice(0, 300));
    return Response.json({ ok: false }, { status: 500 });
  }
}
