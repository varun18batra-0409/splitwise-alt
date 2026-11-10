// Who can see what: tries every group screen, export, image and API as people
// who should NOT get in (no cookie, a forged cookie, someone from another
// group, a person who left, a signed-in stranger) and records what each sees.
import { chromium } from "playwright";
import { base, cookieFor, db, demo, ids, save } from "./common";
import { SESSION_COOKIE, encodeSession } from "../../src/lib/session";

async function main() {
  const x = await ids();
  const T = demo.trip.id, F = demo.flat.id;
  const trip = await db.group.findUnique({ where: { id: T }, include: { members: true } });
  const secretWords = [trip!.name, ...trip!.members.filter((m) => m.id !== demo.trip.me).map((m) => m.name)].filter((w) => w.length > 2);

  // A person who left the trip, and a signed-in stranger who shares no group.
  const left = await db.member.create({ data: { groupId: T, name: "Audit Leaver", leftAt: new Date() } });
  const stranger = await db.account.create({ data: { email: `audit-stranger-${Date.now()}@example.test`, name: "Stranger" } });
  const flatMember = demo.memberships[F];
  // A bill photo kept with an expense in the trip (made here, removed at the end).
  const receipt = await db.receipt.create({ data: { groupId: T, expenseId: demo.trip.expenseId, data: Buffer.from("89504e470d0a1a0a", "hex"), type: "image/png", createdById: demo.trip.me } });
  // The demo account after "Sign out other phones" on another phone: its version moved on, this cookie still says 0.
  const acct = x.account;
  if (acct) await db.account.update({ where: { id: acct.id }, data: { sessionVersion: { increment: 1 } } });

  const raw = Buffer.from(JSON.stringify({ m: { [T]: demo.trip.me } })).toString("base64url");
  const personas: Record<string, { name: string; value: string; url: string }[]> = {
    anonymous: [],
    forged_cookie: [{ name: "sw_me", value: `${raw}.bm90LWEtcmVhbC1zaWduYXR1cmU`, url: base }],
    other_group_member: [await cookieFor({ [F]: flatMember })],
    member_who_left: [await cookieFor({ [T]: left.id })],
    signed_in_stranger: [await cookieFor({}, stranger.id)],
    real_member: [await cookieFor({ [T]: demo.trip.me })],
    ...(acct ? { signed_out_elsewhere: [{ name: SESSION_COOKIE, value: await encodeSession({ m: {}, a: acct.id, v: 0 }), url: base }] } : {}),
  };
  const pages = [
    `/groups/${T}`, `/groups/${T}?tab=balances`, `/groups/${T}/add`, `/groups/${T}/people`, `/groups/${T}/settings`, `/groups/${T}/settle`,
    `/groups/${T}/report`, `/groups/${T}/wrapped`, `/groups/${T}/passports`, `/groups/${T}/invite`, `/groups/${T}/pay`, `/groups/${T}/square`,
    `/groups/${T}/expenses/${demo.trip.expenseId}/edit`, `/groups/${T}/passport/${demo.trip.ravi}`,
    ...(x.postcard ? [`/postcards/${x.postcard.id}`] : []),
    ...(x.account ? [`/passport/friends/${x.account.id}`] : []),
    `/search?g=${T}`,
  ];
  const apis = [
    `/groups/${T}/export`, `/groups/${T}/countdown-image`, `/groups/${T}/square-image`, `/groups/${T}/wrapped-image`, `/groups/${T}/remind`,
    `/api/group-photo/${T}`, ...(x.postcard?.photoId ? [`/api/postcard-photo/${x.postcard.photoId}`] : []), `/api/my-data`, `/api/unread`,
    `/api/people?g=${T}`, `/api/receipt/${receipt.id}`, `/passport/image`, `/api/cron/daily`, `/api/cron/evening`, `/api/health`, `/api/move`, `/api/arrive`,
  ];
  const browser = await chromium.launch();
  const rows: Record<string, unknown>[] = [];
  for (const [who, cookies] of Object.entries(personas)) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (cookies.length) await ctx.addCookies(cookies);
    const page = await ctx.newPage();
    for (const p of pages) {
      try {
        const r = await page.goto(base + p, { waitUntil: "load", timeout: 30_000 });
        const text = await page.evaluate(() => document.body.innerText);
        rows.push({ who, kind: "page", path: p.replace(/[A-Za-z0-9_-]{20,}/g, ":id"), status: r?.status(), finalPath: new URL(page.url()).pathname.replace(/[A-Za-z0-9_-]{20,}/g, ":id"), leaked: secretWords.filter((w) => text.includes(w)) });
      } catch (e) {
        rows.push({ who, kind: "page", path: p, error: String(e).slice(0, 160) });
      }
    }
    for (const p of apis) {
      try {
        const r = await ctx.request.get(base + p, { maxRedirects: 0, timeout: 30_000 });
        const body = (await r.text()).slice(0, 4000);
        rows.push({ who, kind: "api", path: p.replace(/[A-Za-z0-9_-]{20,}/g, ":id"), status: r.status(), type: r.headers()["content-type"]?.split(";")[0], bytes: body.length, location: r.headers()["location"]?.replace(base, ""), leaked: secretWords.filter((w) => body.includes(w)) });
      } catch (e) {
        rows.push({ who, kind: "api", path: p, error: String(e).slice(0, 160) });
      }
    }
    // Unauthenticated POSTs that accept data from anyone.
    for (const [p, body] of [["/api/speed", { kind: "nav", route: "/x", ms: 1 }], ["/api/push", { endpoint: "https://example.test/x" }]] as const) {
      const r = await ctx.request.post(base + p, { data: body, maxRedirects: 0 }).catch(() => null);
      rows.push({ who, kind: "api-post", path: p, status: r?.status() });
    }
    // Adding a bill photo to the trip (as the app does: same-site, raw bytes).
    {
      const before = await db.receipt.count({ where: { groupId: T } });
      const r = await ctx.request.post(`${base}/api/receipt?group=${T}`, { data: Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), headers: { origin: base, "content-type": "application/octet-stream" }, maxRedirects: 0 }).catch(() => null);
      const after = await db.receipt.count({ where: { groupId: T } });
      rows.push({ who, kind: "api-post", path: "/api/receipt?group=:id (bill photo upload)", status: r?.status(), stored: after - before });
      if (after > before) await db.receipt.deleteMany({ where: { groupId: T, expenseId: "" } });
    }
    await ctx.close();
  }
  // Rate limiting on the sign-in code: 12 requests for one email from one place.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const codes: number[] = [];
  for (let i = 0; i < 12; i++) {
    await page.goto(`${base}/signin`);
    const email = page.locator('input[type="email"]').first();
    if (!(await email.count())) break;
    await email.fill("audit-ratelimit@example.test");
    await page.locator('button[type="submit"]').first().click();
    await page.waitForLoadState("load");
    codes.push((await page.evaluate(() => document.body.innerText)).match(/too many|wait|try again later/i) ? 429 : 200);
  }
  const sent = await db.outbox.count({ where: { to: "audit-ratelimit@example.test" } }).catch(() => -1);
  rows.push({ who: "anonymous", kind: "rate-limit", path: "/signin (12 code requests, same email)", status: codes.join(","), emailsQueued: sent });
  await browser.close();
  await db.member.delete({ where: { id: left.id } }).catch(() => {});
  await db.receipt.delete({ where: { id: receipt.id } }).catch(() => {});
  if (acct) await db.account.update({ where: { id: acct.id }, data: { sessionVersion: { decrement: 1 } } }).catch(() => {});
  save("access.json", rows);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
