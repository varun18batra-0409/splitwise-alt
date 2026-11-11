import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { allow, clientIp } from "@/lib/rate-limit";
import { sendDayPulse } from "@/lib/countdown-db";
import { makeStop, runClaimedParts } from "@/lib/daily-job";

// The evening job (Vercel Cron, 21:30 India time): the day-end pulse for trips
// happening today, and passport moments for trips that just started. Safe to
// run more than once: each trip gets one pulse a day, each moment one alert.
// It is also the catch-up for the morning job: if that ran out of time, or a
// group's nudge was left half-done, the same parts run again here and only do
// what is still undone (every group is claimed first, so nothing is sent twice).
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
    const now = new Date();
    const stop = makeStop();
    const pulse = await sendDayPulse(now, stop);
    // Passport moments for anyone whose trip started today or yesterday (a new stamp).
    const { celebrateRecentTrips } = await import("@/lib/passport-db");
    const day = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const moments = await celebrateRecentTrips(day(now), day(new Date(now.getTime() - 86_400_000))).catch(() => 0);
    // Catch-up for the morning job (never fails the evening job).
    const failed: string[] = [];
    const catchUp = await runClaimedParts(now, stop, failed).catch(() => ({ results: {}, deferred: ["all"] }));
    return Response.json({ ok: true, pulse, moments, catchUp: catchUp.results, deferred: catchUp.deferred, failed });
  } catch (err) {
    console.error("evening job failed", String(err).slice(0, 300));
    return Response.json({ ok: false }, { status: 500 });
  }
}
