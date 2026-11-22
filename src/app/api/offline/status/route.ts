import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getMemberships } from "@/lib/identity";
import { ownOrigin } from "@/lib/same-origin";
import { OFFLINE_KEY_PREFIX, offlineOn } from "@/lib/offline/words";
import { originalKeyOf, sameAsTyped } from "@/lib/offline/earlier";

// "Was this one added?" for a few offline one-time keys (when a reply was lost). It answers ONLY for expenses in groups this
// person is in, and says nothing about any other key.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!ownOrigin(req) || !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return Response.json({ done: {} }, { status: 403, headers });
  if (!offlineOn()) return Response.json({ done: {} }, { headers });
  let keys: string[] = [];
  let typed: Record<string, { amount: string; currency: string; name: string }> = {};
  try {
    const body = (await req.json()) as { keys?: unknown; typed?: unknown };
    if (body.typed && typeof body.typed === "object") {
      for (const [k, v] of Object.entries(body.typed as Record<string, Record<string, unknown>>)) {
        if (v && typeof v.amount === "string" && typeof v.currency === "string" && typeof v.name === "string") typed[k] = { amount: v.amount.slice(0, 40), currency: v.currency.slice(0, 8), name: v.name.slice(0, 200) };
      }
    }
    keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string" && k.startsWith(OFFLINE_KEY_PREFIX) && k.length <= 64).slice(0, 50) : [];
  } catch {
    return Response.json({ done: {} }, { status: 400, headers });
  }
  const mine = Object.keys(await getMemberships());
  if (!keys.length || !mine.length) return Response.json({ done: {} }, { headers });
  const rows = await db.requestKey.findMany({ where: { key: { in: keys } }, select: { key: true, result: true } });
  const expenses = rows.length ? await db.expense.findMany({ where: { id: { in: rows.map((r) => r.result) }, groupId: { in: mine } }, select: { id: true } }) : [];
  const ok = new Set(expenses.map((e) => e.id));
  const done: Record<string, string> = Object.fromEntries(rows.filter((r) => ok.has(r.result)).map((r) => [r.key, r.result]));
  // A draft kept after an online save whose reply was lost is `off-` + that save's key K. If K made an expense in one of this person's
  // groups AND it is the same as what the draft says (amount, currency, name), the draft is already added. A changed one stays waiting.
  const originals = keys.filter((k) => !done[k] && typed[k]).map((k) => [k, originalKeyOf(k)] as const).filter((x): x is readonly [string, string] => Boolean(x[1]));
  if (originals.length) {
    const early = await db.requestKey.findMany({ where: { key: { in: originals.map((x) => x[1]) } }, select: { key: true, result: true } });
    const made = early.length ? await db.expense.findMany({ where: { id: { in: early.map((r) => r.result) }, groupId: { in: mine } }, select: { id: true, description: true, originalAmount: true, originalCurrency: true } }) : [];
    for (const [k, orig] of originals) {
      const id = early.find((r) => r.key === orig)?.result;
      const e = made.find((m) => m.id === id);
      if (e && sameAsTyped(e, typed[k])) done[k] = e.id;
    }
  }
  return Response.json({ done }, { headers });
}
