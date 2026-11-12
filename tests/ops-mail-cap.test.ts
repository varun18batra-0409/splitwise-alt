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
// The counters these tests use are set to a known number before each test and put back as they were found at the end
// (or removed, if they did not exist). Nothing else in the counter table is touched.
const KEYS = ["mail:ops", "mail:other", "mail:all", "support:anon-day"];
const found = new Map<string, { count: number; resetAt: Date } | null>();
const tomorrow = () => new Date(Date.now() + 86_400_000);
const setCount = (key: string, count: number) => db.rateLimit.upsert({ where: { key }, create: { key, count, resetAt: tomorrow() }, update: { count, resetAt: tomorrow() } });
const countOf = async (key: string) => (await db.rateLimit.findUnique({ where: { key } }))?.count ?? 0;
let accountId = "";

beforeAll(async () => {
  for (const key of KEYS) {
    const row = await db.rateLimit.findUnique({ where: { key } });
    found.set(key, row ? { count: row.count, resetAt: row.resetAt } : null);
  }
});

beforeEach(async () => {
  delete process.env.MAIL_OUTBOX;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  process.env.SMTP_USER = "stand-in-user";
  process.env.SMTP_PASS = "stand-in-pass";
  process.env.MAIL_DAILY_CAP = "1000";
  process.env.ADMIN_EMAIL = OP;
  mail.send.mockReset();
  mail.send.mockResolvedValue({});
  for (const key of KEYS) await setCount(key, 0);
});
afterAll(async () => {
  for (const key of KEYS) {
    const was = found.get(key);
    if (was) await db.rateLimit.update({ where: { key }, data: was });
    else await db.rateLimit.deleteMany({ where: { key } });
  }
  await db.rateLimit.deleteMany({ where: { key: { contains: stamp } } }); // this file's own per-address counters
  await db.report.deleteMany({ where: { note: { contains: stamp } } });
  if (accountId) await db.account.deleteMany({ where: { id: accountId } });
  delete process.env.ADMIN_EMAIL;
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

describe("operator mail is a small budget of its own", () => {
  // MAIL_DAILY_CAP is 1000 here, so everything except sign-in codes stops at 1000 - 30 = 970 in mail:all.
  it("25 operator emails: 20 go out and 5 are refused; they count in the app-wide total (mail:all) but not in the invite budget (mail:other)", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 25; i++) results.push(await mailOperator("Loopin: a new report", ["x"]));
    expect(results.slice(0, 20).every(Boolean)).toBe(true);
    expect(results.slice(20).some(Boolean)).toBe(false);
    expect(mail.send).toHaveBeenCalledTimes(20);
    expect(await countOf("mail:ops")).toBe(20);
    expect(await countOf("mail:all")).toBe(20);
    expect(await countOf("mail:other")).toBe(0);
  });

  it("each operator address is one send: two addresses use two places", async () => {
    process.env.ADMIN_EMAIL = `${OP}, second-${OP}`;
    expect(await mailOperator("Loopin: a new report", ["x"])).toBe(true);
    expect(await countOf("mail:ops")).toBe(2);
    expect(await countOf("mail:all")).toBe(2);
    expect(mail.send).toHaveBeenCalledTimes(2);
  });

  it("the 30 places kept for sign-in codes are never used: at 969 of 970 one more operator email goes, then it is refused, and a code still goes", async () => {
    await setCount("mail:all", 969);
    expect(await mailOperator("Loopin: a new report", ["x"])).toBe(true);
    expect(await countOf("mail:all")).toBe(970);
    expect(await mailOperator("Loopin: a new report", ["x"])).toBe(false);
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(await countOf("mail:all")).toBe(970); // the refused one used no place
    expect(await sendMail(`friend-${stamp}@example.com`, "123456 is your Loopin code", "123456", "<p>123456</p>", { signInCode: true })).toBe(true);
    expect(await countOf("mail:all")).toBe(971);
  });

  it("invites also stop 30 places before the ceiling now that operator mail shares the count", async () => {
    await setCount("mail:all", 970);
    expect(await sendMail(`friend2-${stamp}@example.com`, "hi", "hi", "<p>hi</p>", { optOut: true })).toBe(false);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("ordinary mail keeps its own rules: an address stops at 10 a day, and each one counts in mail:other and mail:all", async () => {
    const to = `friend-${stamp}@example.com`;
    const sent: boolean[] = [];
    for (let i = 0; i < 11; i++) sent.push(await sendMail(to, "hi", "hi", "<p>hi</p>"));
    expect(sent.filter(Boolean)).toHaveLength(10);
    expect(await countOf("mail:other")).toBe(10);
    expect(await countOf("mail:all")).toBe(10);
    await db.rateLimit.deleteMany({ where: { key: `mail:to:${to}` } });
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
    await setCount("mail:ops", 20);
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
