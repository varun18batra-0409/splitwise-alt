import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { allow, clientIp } from "@/lib/rate-limit";
import { cronRefusedWithoutSecret } from "@/lib/cron-auth";
import { sendDayPulse } from "@/lib/countdown-db";
import { logJobFailure, makeStop, runDeferredParts } from "@/lib/daily-job";

// The evening job (Vercel Cron, 21:30 India time): the day-end pulse for trips
// happening today, and passport moments for trips that just started. Safe to
// run more than once: each trip gets one pulse a day, each moment one alert.
// It is also the catch-up for the morning job: the morning run writes down the parts it
// could not finish, and only those parts run again here (for the groups not already done:
// every group is claimed first, so nothing is sent twice). If nothing was left, it does nothing,
// so no first-time nudge goes out at 21:30.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sameSecret(given: string | null, secret: string) {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // Live server with no secret set: refuse (fail closed), never run open.
  if (cronRefusedWithoutSecret(secret)) return Response.json({ error: "Not allowed" }, { status: 401 });
  if (secret && !sameSecret(req.headers.get("authorization"), secret)) return Response.json({ error: "Not allowed" }, { status: 401 });
  if (!secret && !(await allow(`cron-evening:${clientIp(await headers())}`, 6, 3600))) return Response.json({ error: "Too many runs" }, { status: 429 });
  try {
    const now = new Date();
    const stop = makeStop();
    const pulse = await sendDayPulse(now, stop);
    // Passport moments for anyone whose trip started today or yesterday (a new stamp).
    const { celebrateRecentTrips } = await import("@/lib/passport-db");
    const day = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const moments = await celebrateRecentTrips(day(now), day(new Date(now.getTime() - 86_400_000))).catch(async () => {
      await logJobFailure("cron/evening", "evening job: passport moments failed");
      return 0;
    });
    // Catch-up for the morning job (never fails the evening job).
    const failed: string[] = [];
    const catchUp = await runDeferredParts(now, stop, failed).catch(async () => {
      await logJobFailure("cron/evening", "evening job: catch-up of the morning parts failed");
      return { results: {}, deferred: ["all"] };
    });
    // Parts that failed again tonight are written to the error log, so the morning email lists them.
    if (failed.length) await logJobFailure("cron/evening", `evening catch-up failed: ${failed.join(", ")}`);
    return Response.json({ ok: true, pulse, moments, catchUp: catchUp.results, deferred: catchUp.deferred, failed });
  } catch (err) {
    console.error("evening job failed", String(err).slice(0, 300));
    await logJobFailure("cron/evening", `evening job failed: ${String(err)}`);
    return Response.json({ ok: false }, { status: 500 });
  }
}
