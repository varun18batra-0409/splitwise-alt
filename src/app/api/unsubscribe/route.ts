import { db } from "@/lib/db";
import { verifyText } from "@/lib/session";

// One tap to stop Loopin's invite and "you were added" emails. GET shows a
// confirm button (mail scanners open links, so GET never unsubscribes);
// POST unsubscribes (also what mail apps' own "Unsubscribe" button sends).
export const dynamic = "force-dynamic";

const page = (body: string) =>
  new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loopin emails</title><body style="background:#0d0d0f;color:#f4f2ec;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center"><div style="max-width:380px">${body}</div></body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function check(url: URL) {
  const e = (url.searchParams.get("e") ?? "").trim().toLowerCase().slice(0, 200);
  const s = url.searchParams.get("s") ?? "";
  return e && (await verifyText(`unsub:${e}`, s)) ? e : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const e = await check(url);
  if (!e) return page(`<p style="font-size:20px;font-weight:600">This link doesn’t work</p><p style="color:#9a978f">Open the newest email from Loopin and tap its link again.</p>`);
  return page(
    `<p style="font-size:20px;font-weight:600">Stop invite emails?</p><p style="color:#9a978f">${esc(e)} won’t get “invited you” or “added you” emails from Loopin. Sign-in codes you ask for still arrive.</p><form method="post" action="/api/unsubscribe?${esc(url.searchParams.toString())}"><button style="margin-top:12px;background:#f4f2ec;color:#0d0d0f;border:0;border-radius:999px;padding:12px 22px;font-weight:600;font-size:15px">Stop these emails</button></form>`,
  );
}

export async function POST(req: Request) {
  const e = await check(new URL(req.url));
  if (!e) return page(`<p style="font-size:20px;font-weight:600">This link doesn’t work</p>`);
  await db.emailOptOut.upsert({ where: { email: e }, create: { email: e }, update: {} });
  return page(`<p style="font-size:20px;font-weight:600">Done</p><p style="color:#9a978f">You won’t get invite emails from Loopin any more.</p>`);
}
