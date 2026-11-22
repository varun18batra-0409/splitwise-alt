import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getMemberships } from "@/lib/identity";
import { ownOrigin } from "@/lib/same-origin";
import { OFFLINE_KEY_PREFIX, offlineOn } from "@/lib/offline/words";

// "Was this one added?" for a few offline one-time keys (when a reply was lost). It answers ONLY for expenses in groups this
// person is in, and says nothing about any other key.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!ownOrigin(req) || !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return Response.json({ done: {} }, { status: 403, headers });
  if (!offlineOn()) return Response.json({ done: {} }, { headers });
  let keys: string[] = [];
  try {
    const body = (await req.json()) as { keys?: unknown };
    keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string" && k.startsWith(OFFLINE_KEY_PREFIX) && k.length <= 64).slice(0, 50) : [];
  } catch {
    return Response.json({ done: {} }, { status: 400, headers });
  }
  const mine = Object.keys(await getMemberships());
  if (!keys.length || !mine.length) return Response.json({ done: {} }, { headers });
  const rows = await db.requestKey.findMany({ where: { key: { in: keys } }, select: { key: true, result: true } });
  const expenses = rows.length ? await db.expense.findMany({ where: { id: { in: rows.map((r) => r.result) }, groupId: { in: mine } }, select: { id: true } }) : [];
  const ok = new Set(expenses.map((e) => e.id));
  return Response.json({ done: Object.fromEntries(rows.filter((r) => ok.has(r.result)).map((r) => [r.key, r.result])) }, { headers });
}
