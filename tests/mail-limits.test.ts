import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Email limits, checked through the real sendMail and requestLoginCode with a stand-in mail service.
//
// Why a stand-in service and not MAIL_OUTBOX=1: the outbox keeps the email in the database and returns BEFORE any
// of the limits below are looked at (and requestLoginCode also skips its own limits in outbox mode). So the limits
// can only be tested by going the real way (SMTP settings present, outbox off) with nodemailer replaced by a fake
// that records what it was asked to send. Nothing leaves this machine.
//
// The rules, read from src/lib/mail.ts and src/lib/auth.ts (Resend host):
//   app-wide per day:      95 emails          (mail:all)
//   kept for sign-in:      30 of them, so everything else (invites, "you were added") stops at 95 - 30 = 65 (mail:other)
//   one address per day:   10 invite-type emails, and separately 12 sign-in codes
//   sign-in codes per day: 12 per address when asking for a code (auth.ts), 4 per 15 minutes
// A day is a fixed 24-hour window from the first email. The clock is faked (Date only).

const mocks = vi.hoisted(() => ({ send: vi.fn(async (_m: { to: string; subject: string; text: string; html: string }) => ({})) }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mocks.send, close: () => undefined }) } }));

// The real database, except that the "who unsubscribed" list can be made to fail.
const state = vi.hoisted(() => ({ optOutDown: false }));
vi.mock("@/lib/db", async (orig) => {
  const real = await orig<typeof import("@/lib/db")>();
  const db = new Proxy(real.db, {
    get(target, prop) {
      if (prop === "emailOptOut" && state.optOutDown) return { findUnique: () => Promise.reject(new Error("list down")) };
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { ...real, db };
});

const { db } = await import("@/lib/db");
const { sendMail } = await import("@/lib/mail");
const { requestLoginCode } = await import("@/lib/auth");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = new Date("2026-11-12T08:00:00Z").getTime();
const ORIGIN = "https://loopin.example";
const DAY_MESSAGE = "Too many codes asked for today. Try again tomorrow, or sign in with Google or your fingerprint or face above.";

const saved = { ...process.env };
let n = 0;
// Never a ".test" address: those are never sent, so they would skip the limits.
const addr = (tag = "p") => `${tag}-${++n}-${stamp}@example.com`;
const setClock = (ms: number) => vi.setSystemTime(ms);

const invite = (to: string) => sendMail(to, "Ann invited you", "Join us", "<p>Join us</p>", { optOut: true });
const code = (to: string) => sendMail(to, "123456 is your Loopin code", "Your code is 123456", "<p>123456</p>", { signInCode: true });
const sent = () => mocks.send.mock.calls.map((c) => c[0]);
const used = async (key: string) => (await db.rateLimit.findUnique({ where: { key } }))?.count ?? 0;

beforeEach(async () => {
  process.env = { ...saved };
  delete process.env.MAIL_OUTBOX;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.MAIL_DAILY_CAP;
  process.env.SMTP_HOST = "smtp.resend.com";
  process.env.SMTP_USER = "resend";
  process.env.SMTP_PASS = "not-a-real-key";
  state.optOutDown = false;
  mocks.send.mockReset();
  mocks.send.mockImplementation(async () => ({}));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  setClock(T0);
  // The counters are shared by the whole app: start every test from empty.
  await db.rateLimit.deleteMany({ where: { OR: [{ key: { startsWith: "mail:" } }, { key: { startsWith: "code-" } }] } });
  await db.notifyLog.deleteMany({ where: { key: { startsWith: "mail-failed:" } } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  process.env = { ...saved };
  await db.loginCode.deleteMany({ where: { email: { contains: stamp } } });
  await db.emailOptOut.deleteMany({ where: { email: { contains: stamp } } });
  await db.account.deleteMany({ where: { email: { contains: stamp } } });
  await db.rateLimit.deleteMany({ where: { OR: [{ key: { startsWith: "mail:" } }, { key: { startsWith: "code-" } }] } });
  await db.notifyLog.deleteMany({ where: { key: { startsWith: "mail-failed:" } } });
});

describe("the daily ceiling for the whole app", () => {
  it("invites stop at 65 so 30 places stay for sign-in codes; the 96th email is refused; the next day starts fresh", async () => {
    for (let i = 0; i < 65; i++) expect(await invite(addr("inv")), `invite ${i + 1}`).toBe(true);
    expect(sent()).toHaveLength(65);

    // The 66th invite is refused and nothing is sent.
    expect(await invite(addr("inv"))).toBe(false);
    expect(sent()).toHaveLength(65);

    // The invites did not use the sign-in places: all 30 codes get through (65 + 30 = 95).
    for (let i = 0; i < 30; i++) expect(await code(addr("code")), `code ${i + 1}`).toBe(true);
    expect(sent()).toHaveLength(95);
    expect(await used("mail:all")).toBe(95);
    expect(await used("mail:other")).toBe(65);

    // The 96th email of the day, of either kind, is refused and not sent.
    expect(await code(addr("code"))).toBe(false);
    expect(await invite(addr("inv"))).toBe(false);
    expect(sent()).toHaveLength(95);
    // Each refusal is counted (never with an address) so the live stats can show it.
    expect(await db.notifyLog.count({ where: { key: { startsWith: "mail-failed:cap:" } } })).toBe(3);

    // Just before the 24 hours are over: still refused. Just after: both kinds work again.
    setClock(T0 + DAY - 1000);
    expect(await invite(addr("inv"))).toBe(false);
    setClock(T0 + DAY + 1000);
    expect(await invite(addr("inv"))).toBe(true);
    expect(await code(addr("code"))).toBe(true);
    expect(sent()).toHaveLength(97);
    expect(await used("mail:all")).toBe(2);
  });

  it("MAIL_DAILY_CAP changes the ceiling, and invites always stop 30 earlier", async () => {
    process.env.MAIL_DAILY_CAP = "33";
    for (let i = 0; i < 3; i++) expect(await invite(addr())).toBe(true);
    expect(await invite(addr())).toBe(false);
    for (let i = 0; i < 30; i++) expect(await code(addr())).toBe(true);
    expect(await code(addr())).toBe(false);
    expect(sent()).toHaveLength(33);
  });

  it("with any other mail host the ceiling is 400 (invites 370)", async () => {
    process.env.SMTP_HOST = "smtp.gmail.com";
    // Seed the counters to just under the ceilings instead of sending 370 emails.
    const resetAt = new Date(T0 + DAY);
    await db.rateLimit.create({ data: { key: "mail:other", count: 369, resetAt } });
    await db.rateLimit.create({ data: { key: "mail:all", count: 369, resetAt } });
    expect(await invite(addr())).toBe(true); // the 370th
    expect(await invite(addr())).toBe(false); // the 371st
    expect(await code(addr())).toBe(true); // 371st email overall, a sign-in code: allowed
    expect(sent()).toHaveLength(2);
  });
});

describe("one address", () => {
  it("10 invites a day, 12 sign-in codes a day, counted separately, whatever the capital letters", async () => {
    const to = addr("pia");
    const shout = to.toUpperCase();
    for (let i = 0; i < 10; i++) expect(await invite(i % 2 ? shout : to), `invite ${i + 1}`).toBe(true);
    expect(await invite(to)).toBe(false); // the 11th
    expect(sent()).toHaveLength(10);

    // Sign-in codes to the same address are not counted against the invite limit...
    for (let i = 0; i < 12; i++) expect(await code(i % 2 ? shout : to), `code ${i + 1}`).toBe(true);
    expect(sent()).toHaveLength(22);
    expect(await code(to)).toBe(false); // the 13th code
    expect(sent()).toHaveLength(22);
    // ...and a full set of codes did not use up the invites either (the invite limit was already full: still 10, not 22).
    expect(await used(`mail:to:${to.toLowerCase()}`)).toBe(10);
    expect(await used(`mail:code:${to.toLowerCase()}`)).toBe(12);

    // Other people are not affected.
    expect(await invite(addr("other"))).toBe(true);
  });

  it("sign-in codes first: the invite limit is still whole afterwards", async () => {
    const to = addr("first-codes");
    for (let i = 0; i < 12; i++) expect(await code(to)).toBe(true);
    for (let i = 0; i < 10; i++) expect(await invite(to), `invite ${i + 1}`).toBe(true);
    expect(await invite(to)).toBe(false);
  });

  it("the next day, both allowances are back", async () => {
    const to = addr("reset");
    for (let i = 0; i < 10; i++) await invite(to);
    for (let i = 0; i < 12; i++) await code(to);
    expect(await invite(to)).toBe(false);
    expect(await code(to)).toBe(false);
    setClock(T0 + DAY + 1000);
    expect(await invite(to)).toBe(true);
    expect(await code(to)).toBe(true);
  });

  // NOT ENFORCED AS INTENDED (reported, rule left as it is): an email refused because this address already had its 10
  // still uses up one of the app-wide places, because the address check is the last of the three. So repeated invites
  // to one address (an IP may make 40 invites an hour) can use up the day's 95 without sending anything, and lock
  // sign-in codes out for everyone. Marked `fails`: when the order is fixed this will start passing and vitest will
  // say so; then change `it.fails` to `it`.
  it.fails("an email refused for the address limit should not use up the app-wide places", async () => {
    const to = addr("burn");
    for (let i = 0; i < 10; i++) await invite(to);
    for (let i = 0; i < 5; i++) expect(await invite(to)).toBe(false);
    expect(sent()).toHaveLength(10);
    expect(await used("mail:all")).toBe(10); // actually 15
    expect(await used("mail:other")).toBe(10); // actually 15
  });
});

describe("unsubscribed addresses", () => {
  it("get no invites (and nothing is counted), but still get sign-in codes", async () => {
    const to = addr("Quiet");
    await db.emailOptOut.create({ data: { email: to.toLowerCase() } });

    // Reported as done (nothing for the caller to retry), but nothing is sent and no place is used.
    expect(await sendMail(to, "Ann invited you", "Join us", "<p>x</p>", { optOut: true })).toBe(true);
    expect(await sendMail(to.toUpperCase(), "Ann added you", "Join us", "<p>x</p>", { optOut: true })).toBe(true);
    expect(sent()).toHaveLength(0);
    expect(await used("mail:all")).toBe(0);

    // The same person asking for a sign-in code gets it.
    expect(await requestLoginCode(to, "10.0.0.1", ORIGIN, new Date())).toEqual({ ok: true });
    expect(sent()).toHaveLength(1);
    expect(sent()[0].to).toBe(to.toLowerCase());
    expect(sent()[0].subject).toMatch(/^\d{6} is your Loopin code$/);
    expect(sent()[0].text).not.toContain("Don’t want emails like this?");
  });

  it("someone who has not unsubscribed gets the invite, with a way to stop them", async () => {
    const to = addr("loud");
    expect(await invite(to)).toBe(true);
    expect(sent()).toHaveLength(1);
    expect(sent()[0].text).toContain("Don’t want emails like this?");
    expect(sent()[0].text).toContain("/api/unsubscribe?");
  });

  it("if the unsubscribe list can't be read, an optional email is not sent; a sign-in code still is", async () => {
    const to = addr("down");
    state.optOutDown = true;
    expect(await invite(to)).toBe(false);
    expect(sent()).toHaveLength(0);
    expect(await used("mail:all")).toBe(0);
    expect(await code(to)).toBe(true);
    expect(sent()).toHaveLength(1);
  });

  it("a refused email (ceiling reached) is never sent, even though the list says it is allowed", async () => {
    await db.rateLimit.create({ data: { key: "mail:all", count: 95, resetAt: new Date(T0 + DAY) } });
    expect(await invite(addr())).toBe(false);
    expect(sent()).toHaveLength(0);
  });
});

describe("asking for a sign-in code: 12 a day", () => {
  it("the 13th gets a calm message that is the same whether or not the email has an account", async () => {
    const known = addr("known");
    const unknown = addr("unknown");
    await db.account.create({ data: { email: known, name: "Known" } });

    const results: Record<string, unknown[]> = { known: [], unknown: [] };
    // 20 minutes apart: well inside one day, but past the separate 4-every-15-minutes limit.
    for (let i = 0; i < 13; i++) {
      setClock(T0 + i * 20 * 60_000);
      results.known.push(await requestLoginCode(known, "10.0.0.2", ORIGIN, new Date()));
      results.unknown.push(await requestLoginCode(unknown, "10.0.0.2", ORIGIN, new Date()));
    }
    expect(results.known).toEqual(results.unknown);
    expect(results.known.slice(0, 12).every((r) => (r as { ok: boolean }).ok)).toBe(true);
    expect(results.known[12]).toEqual({ ok: false, error: DAY_MESSAGE });

    // Calm: says what to do, never the address, never anything about accounts.
    expect(DAY_MESSAGE).toContain("Try again tomorrow");
    expect(DAY_MESSAGE).not.toMatch(/account|exist|registered|recogni[sz]|unknown|no such|!/i);
    expect(DAY_MESSAGE).not.toContain("@");

    // The 13th made no code and sent no email, for either address.
    for (const e of [known, unknown]) {
      expect(await db.loginCode.count({ where: { email: e } })).toBe(12);
      expect(sent().filter((m) => m.to === e)).toHaveLength(12);
    }
  });

  it("asking too fast gets its own 15-minute message, also the same for any address", async () => {
    const e = addr("fast");
    const out = [];
    for (let i = 0; i < 5; i++) out.push(await requestLoginCode(e, `10.1.0.${i}`, ORIGIN, new Date()));
    expect(out.slice(0, 4).every((r) => r.ok)).toBe(true);
    expect(out[4]).toEqual({ ok: false, error: "Too many codes asked for. Wait 15 minutes and try again." });
  });

  it("the next day the address can ask again", async () => {
    const e = addr("tomorrow");
    for (let i = 0; i < 12; i++) {
      setClock(T0 + i * 20 * 60_000);
      expect((await requestLoginCode(e, "10.0.0.3", ORIGIN, new Date())).ok).toBe(true);
    }
    setClock(T0 + 12 * 20 * 60_000);
    expect((await requestLoginCode(e, "10.0.0.3", ORIGIN, new Date())).ok).toBe(false);

    // The day is counted from the first code (T0): 24 hours later it is open again.
    setClock(T0 + DAY + 60_000);
    expect(await requestLoginCode(e, "10.0.0.3", ORIGIN, new Date())).toEqual({ ok: true });
    expect(sent().filter((m) => m.to === e)).toHaveLength(13);
  });

  it("invites to an address don't use up its sign-in codes", async () => {
    const e = addr("both");
    for (let i = 0; i < 10; i++) await invite(e);
    expect(await invite(e)).toBe(false);
    for (let i = 0; i < 12; i++) {
      setClock(T0 + i * 20 * 60_000);
      expect((await requestLoginCode(e, "10.0.0.4", ORIGIN, new Date())).ok, `code ${i + 1}`).toBe(true);
    }
  });

  it("a code that can't be sent says so calmly", async () => {
    const e = addr("broken");
    mocks.send.mockRejectedValue(new Error("smtp is down"));
    expect(await requestLoginCode(e, "10.0.0.5", ORIGIN, new Date())).toEqual({ ok: false, error: "Couldn't send the email. Check the address and try again." });
    expect(await db.notifyLog.count({ where: { key: { startsWith: "mail-failed:send:" } } })).toBe(1);
  });
});
