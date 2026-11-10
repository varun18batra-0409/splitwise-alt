import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { allow, clientIp } from "@/lib/rate-limit";

// Is the app healthy, and how fast is it to the database? Numbers only — no
// data, no names, no addresses. Used to check speed after each release.
export const dynamic = "force-dynamic";

// The database's region from its address (e.g. "aws-ap-south-1"), never the address itself.
function dbRegion(): string {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return "local file";
  const host = url.replace(/^\w+:\/\//, "").split("/")[0];
  const m = /\.((?:aws|gcp|azure)-[a-z0-9-]+)\.turso\.io$/.exec(host);
  return m ? m[1] : host.endsWith(".turso.io") ? "turso (region not in address)" : "other";
}

// The details (regions, timings, which features are on) only for the operator's
// own checks (Authorization: Bearer CRON_SECRET); everyone else gets "ok".
function isOperator(auth: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !auth) return false;
  const a = Buffer.from(auth), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET() {
  const h = await headers();
  if (!(await allow(`health:${clientIp(h)}`, 30, 3600))) {
    return Response.json({ error: "Too many checks" }, { status: 429 });
  }
  const rounds: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    await db.$queryRawUnsafe("SELECT 1");
    rounds.push(Math.round(performance.now() - t));
  }
  const t = performance.now();
  await db.group.count();
  const countMs = Math.round(performance.now() - t);
  const sorted = [...rounds].sort((a, b) => a - b);
  if (!isOperator(h.get("authorization"))) return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  return Response.json(
    {
      ok: true,
      appRegion: process.env.VERCEL_REGION ?? "local",
      dbRegion: dbRegion(),
      roundTripMs: rounds,
      medianMs: sorted[2],
      countMs,
      billReading: Boolean(process.env.ANTHROPIC_API_KEY), // switched on or not (never the key)
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
