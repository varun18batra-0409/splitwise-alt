import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// M3: mail to the operator has its own daily allowance (not the 10-a-day limit for one address), and a support
// message is saved even when the email can't be sent. nodemailer is replaced by a stand-in: nothing leaves this machine.
// (The address is not a ".test" one, because the app never sends to those; the stand-in catches it instead.)
const mail = vi.hoisted(() => ({ send: vi.fn(async (_m: unknown) => ({})) }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mail.send, close: () => undefined }) } }));
const state = vi.hoisted(() => ({ session: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.session ? { value: state.session } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250)}` }),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/fresh-redirect", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

const { db } = await import("@/lib/db");
const { sendMail } = await import("@/lib/mail");
const { mailOperator } = await import("@/lib/ops-mail");
const { contactSupportAction } = await import("@/app/safety-actions");
const { encodeSession, today } = await import("@/lib/session");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const OP = `operator-${stamp}@example.com`;
// The mail counters here are this file's own (MAIL_COUNTER_PREFIX), so no other test file or the real counters are touched, and
// everything with the prefix is removed at the end. The one shared counter used (the signed-out support allowance) is set to a
// known number before each test and put back as it was found.
const PREFIX = `oc-${stamp}:`;
const ANON = "support:anon-day";
let anonWas: { count: number; resetAt: Date } | null = null;
const tomorrow = () => new Date(Date.now() + 86_400_000);
const setCount = (key: string, count: number) => db.rateLimit.upsert({ where: { key }, create: { key, count, resetAt: tomorrow() }, update: { count, resetAt: tomorrow() } });
const countOf = async (key: string) => (await db.rateLimit.findUnique({ where: { key } }))?.count ?? 0;
const mailCount = (name: string) => countOf(`${PREFIX}${name}`);
const setMail = (name: string, count: number) => setCount(`${PREFIX}${name}`, count);
let accountId = "";
let n = 0;
const addr = (tag: string) => `${tag}-${++n}-${stamp}@example.com`;
const invite = (to: string) => sendMail(to, "Ann invited you", "Join us", "<p>Join us</p>", { optOut: true });
const code = (to: string) => sendMail(to, "123456 is your Loopin code", "Your code is 123456", "<p>123456</p>", { signInCode: true });

beforeAll(async () => {
  const row = await db.rateLimit.findUnique({ where: { key: ANON } });
  anonWas = row ? { count: row.count, resetAt: row.resetAt } : null;
});

beforeEach(async () => {
  delete process.env.MAIL_OUTBOX;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  process.env.SMTP_HOST = "smtp.resend.com";
  process.env.SMTP_USER = "stand-in-user";
  process.env.SMTP_PASS = "stand-in-pass";
  process.env.MAIL_DAILY_CAP = "95"; // the Resend free-plan ceiling: 30 places for codes, 65 for invites and operator mail together
  process.env.MAIL_COUNTER_PREFIX = PREFIX;
  process.env.ADMIN_EMAIL = OP;
  mail.send.mockReset();
  mail.send.mockResolvedValue({});
  await db.rateLimit.deleteMany({ where: { key: { startsWith: PREFIX } } });
  await setCount(ANON, 0);
});
afterAll(async () => {
  if (anonWas) await db.rateLimit.update({ where: { key: ANON }, data: anonWas });
  else await db.rateLimit.deleteMany({ where: { key: ANON } });
  await db.rateLimit.deleteMany({ where: { key: { contains: stamp } } }); // this file's own counters, per-address ones included
  await db.report.deleteMany({ where: { note: { contains: stamp } } });
  if (accountId) await db.account.deleteMany({ where: { id: accountId } });
  delete process.env.ADMIN_EMAIL;
  delete process.env.MAIL_COUNTER_PREFIX;
});

const support = async (message: string) => {
  try {
    const f = new FormData();
    f.set("message", message);
    await contactSupportAction(f);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected a redirect");
};

describe("mail budgets: codes, invites and operator mail", () => {
  it("66 sign-in codes by noon do not use the invite budget: the next invite still goes", async () => {
    for (let i = 0; i < 66; i++) expect(await code(addr("c")), `code ${i + 1}`).toBe(true);
    expect(await invite(addr("i"))).toBe(true);
    expect(await mailOperator("Loopin: a new report", ["x"])).toBe(true);
    expect(await mailCount("mail:other")).toBe(2); // codes never count there
    expect(await mailCount("mail:all")).toBe(68);
  });

  it("65 invites and operator emails between them use up the shared budget: the next invite and operator email are refused, a code still goes", async () => {
    for (let i = 0; i < 45; i++) expect(await invite(addr("i")), `invite ${i + 1}`).toBe(true);
    for (let i = 0; i < 20; i++) expect(await mailOperator("Loopin: a new report", ["x"]), `operator ${i + 1}`).toBe(true);
    expect(await mailCount("mail:other")).toBe(65);
    expect(await invite(addr("i"))).toBe(false);
    expect(await mailOperator("Loopin: a new report", ["x"])).toBe(false);
    expect(await code(addr("c"))).toBe(true);
  });

  it("the provider total never passes the ceiling: 65 shared + codes stop at exactly 95 sent", async () => {
    for (let i = 0; i < 65; i++) await invite(addr("i"));
    let codes = 0;
    for (let i = 0; i < 40; i++) if (await code(addr("c"))) codes++;
    expect(codes).toBe(30);
    expect(mail.send).toHaveBeenCalledTimes(95);
    expect(await mailCount("mail:all")).toBe(95);
  });

  it("operator email has 20 a day of its own, and each address is one send", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 25; i++) results.push(await mailOperator("Loopin: a new report", ["x"]));
    expect(results.slice(0, 20).every(Boolean)).toBe(true);
    expect(results.slice(20).some(Boolean)).toBe(false);
    expect(await mailCount("mail:ops")).toBe(20);
    expect(await mailCount("mail:other")).toBe(20); // the five refused used no place anywhere
    expect(await mailCount("mail:all")).toBe(20);
    await db.rateLimit.deleteMany({ where: { key: { startsWith: PREFIX } } });
    process.env.ADMIN_EMAIL = `${OP}, second-${OP}`;
    expect(await mailOperator("Loopin: a new report", ["x"])).toBe(true);
    expect(await mailCount("mail:ops")).toBe(2);
  });

  it("an operator email refused because the shared budget is full does not use one of its own 20", async () => {
    await setMail("mail:all", 65);
    await setMail("mail:other", 65);
    expect(await mailOperator("Loopin: a new report", ["x"])).toBe(false);
    expect(await mailCount("mail:ops")).toBe(0);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("the shared count restarts with the provider's day, so invites can never take the 30 places kept for codes", async () => {
    // Yesterday's provider day is over (mail:all expired), but the shared count's own window would run for another hour.
    const past = new Date(Date.now() - 60_000);
    const soon = new Date(Date.now() + 3_600_000);
    await db.rateLimit.upsert({ where: { key: `${PREFIX}mail:all` }, create: { key: `${PREFIX}mail:all`, count: 95, resetAt: past }, update: { count: 95, resetAt: past } });
    await db.rateLimit.upsert({ where: { key: `${PREFIX}mail:other` }, create: { key: `${PREFIX}mail:other`, count: 10, resetAt: soon }, update: { count: 10, resetAt: soon } });
    // Today starts with a code: both counters now cover the same new day.
    expect(await code(addr("c"))).toBe(true);
    let invites = 0;
    for (let i = 0; i < 70; i++) if (await invite(addr("i"))) invites++;
    expect(invites).toBe(65); // hand-worked: 95 - 30 = 65 for invites today (yesterday's 10 don't count, and it never restarts mid-day)
    let codes = 1;
    for (let i = 0; i < 40; i++) if (await code(addr("c"))) codes++;
    expect(codes).toBe(30); // 1 + 29: the provider day ends at exactly 95
    expect(await mailCount("mail:all")).toBe(95);
  });

  it("ordinary mail keeps its own rules: an address stops at 10 a day, and each one counts in both counters", async () => {
    const to = addr("friend");
    const sent: boolean[] = [];
    for (let i = 0; i < 11; i++) sent.push(await sendMail(to, "hi", "hi", "<p>hi</p>"));
    expect(sent.filter(Boolean)).toHaveLength(10);
    expect(await mailCount("mail:other")).toBe(10);
    expect(await mailCount("mail:all")).toBe(10);
  });
});

describe("a support message is saved whatever happens to the email", () => {
  it("email service down: saved, and the person is still told it was received", async () => {
    mail.send.mockRejectedValue(new Error("smtp down"));
    const note = `email is down ${stamp}`;
    expect(await support(note)).toBe("REDIRECT /support?sent=1");
    expect(await db.report.count({ where: { kind: "support", note } })).toBe(1);
  });

  it("operator allowance used up: saved, nothing emailed", async () => {
    await setMail("mail:ops", 20);
    const note = `allowance used ${stamp}`;
    expect(await support(note)).toBe("REDIRECT /support?sent=1");
    expect(await db.report.count({ where: { kind: "support", note } })).toBe(1);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("signed in: the message is saved under their account and the email carries the page link, not a promise it was the only copy", async () => {
    const a = await db.account.create({ data: { email: `sup-${stamp}@example.test`, name: "Sup" } });
    accountId = a.id;
    state.session = await encodeSession({ m: {}, a: a.id, v: 0, t: today() });
    const note = `signed in ${stamp}`;
    expect(await support(note)).toBe("REDIRECT /support?sent=1");
    state.session = "";
    const row = await db.report.findFirstOrThrow({ where: { note } });
    expect(row.reporterId).toBe(a.id);
    expect(String((mail.send.mock.calls[0]?.[0] as { text?: string })?.text)).toContain("/stats/reports");
  });

  it("signed-out people share 100 messages a day across everyone: the 100th is kept, the 101st is turned away and not saved", async () => {
    await setCount("support:anon-day", 99);
    const kept = `anon hundredth ${stamp}`;
    expect(await support(kept)).toBe("REDIRECT /support?sent=1");
    const refused = `anon one-oh-one ${stamp}`;
    expect(await support(refused)).toContain("error=");
    expect(await db.report.count({ where: { kind: "support", note: kept } })).toBe(1);
    expect(await db.report.count({ where: { note: refused } })).toBe(0);
    expect(await countOf("support:anon-day")).toBe(100);
  });

  it("the app-wide signed-out allowance does not stop signed-in people", async () => {
    await setCount("support:anon-day", 100);
    const a = await db.account.create({ data: { email: `sup2-${stamp}@example.test`, name: "Sup2" } });
    state.session = await encodeSession({ m: {}, a: a.id, v: 0, t: today() });
    const note = `signed in while full ${stamp}`;
    expect(await support(note)).toBe("REDIRECT /support?sent=1");
    state.session = "";
    expect(await db.report.count({ where: { note } })).toBe(1);
    await db.account.deleteMany({ where: { id: a.id } });
  });
});
