import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
const KEYS = ["mail:ops", "mail:other", "mail:all", `mail:to:${OP}`, `mail:to:friend-${stamp}@example.com`];
let accountId = "";

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
  await db.rateLimit.deleteMany({ where: { key: { in: KEYS } } });
});
afterAll(async () => {
  await db.rateLimit.deleteMany({ where: { key: { in: KEYS } } });
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

describe("operator mail has its own allowance", () => {
  it("12 reports/support emails to the same operator address all go out (an ordinary address stops at 10)", async () => {
    for (let i = 0; i < 12; i++) expect(await mailOperator("Loopin: a new report", ["x"])).toBe(true);
    expect(mail.send).toHaveBeenCalledTimes(12);
    mail.send.mockClear();
    const sent: boolean[] = [];
    for (let i = 0; i < 11; i++) sent.push(await sendMail(`friend-${stamp}@example.com`, "hi", "hi", "<p>hi</p>"));
    expect(sent.filter(Boolean)).toHaveLength(10); // the eleventh to one address is refused
    expect(mail.send).toHaveBeenCalledTimes(10);
  });

  it("once the operator allowance (200 a day) is used, further operator mail is refused", async () => {
    const future = new Date(Date.now() + 3_600_000);
    await db.rateLimit.create({ data: { key: "mail:ops", count: 200, resetAt: future } });
    expect(await mailOperator("Loopin: a new report", ["x"])).toBe(false);
    expect(mail.send).not.toHaveBeenCalled();
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
    await db.rateLimit.create({ data: { key: "mail:ops", count: 200, resetAt: new Date(Date.now() + 3_600_000) } });
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
});
