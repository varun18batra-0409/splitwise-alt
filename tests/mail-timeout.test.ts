import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// R6 / RL3: a slow or broken mail server, with a stand-in transport (nothing leaves this machine). Each send is one real sendMail call.
const mocks = vi.hoisted(() => ({ send: vi.fn(async (_m: unknown): Promise<unknown> => ({})), close: vi.fn(() => undefined) }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mocks.send, close: mocks.close }) } }));

const { db } = await import("@/lib/db");
const { sendMail } = await import("@/lib/mail");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const saved = { ...process.env };
let n = 0;
const addr = () => `slow-${++n}-${stamp}@example.com`;
const go = () => sendMail(addr(), "Hello", "Hi", "<p>Hi</p>", { signInCode: true });

beforeEach(() => {
  process.env = { ...saved };
  delete process.env.MAIL_OUTBOX;
  delete process.env.VERCEL;
  process.env.SMTP_HOST = "smtp.resend.com";
  process.env.SMTP_USER = "resend";
  process.env.SMTP_PASS = "not-a-real-key";
  process.env.MAIL_COUNTER_PREFIX = `t-${stamp}:`;
  process.env.MAIL_SEND_LIMIT_MS = "80"; // tests only: stands in for the live 10 seconds
  mocks.send.mockReset();
  mocks.close.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});
afterAll(async () => {
  await db.rateLimit.deleteMany({ where: { OR: [{ key: { contains: stamp } }, { key: { startsWith: `t-${stamp}:` } }] } });
  await db.notifyLog.deleteMany({ where: { key: { startsWith: "mail-failed:" } } });
});

describe("a slow mail server", () => {
  it("a server that never answers: the send gives up at the limit, tries once, and leaves the shared connection alone", async () => {
    mocks.send.mockImplementation(() => new Promise(() => undefined));
    const t0 = Date.now();
    expect(await go()).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.close).not.toHaveBeenCalled();
  });
  it("nodemailer's own timeout (ETIMEDOUT): once, no retry, connection not closed", async () => {
    mocks.send.mockRejectedValue(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }));
    expect(await go()).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.close).not.toHaveBeenCalled();
  });
  it("a failure after the message was already being sent (DATA): once, so the same email is never sent twice", async () => {
    mocks.send.mockRejectedValue(Object.assign(new Error("Connection closed"), { code: "ESOCKET", command: "DATA" }));
    expect(await go()).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("an idle connection the server dropped is still retried once on a fresh connection", async () => {
    mocks.send.mockRejectedValueOnce(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })).mockResolvedValueOnce({});
    expect(await go()).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
  it("a quick, healthy send is untouched", async () => {
    mocks.send.mockResolvedValue({});
    expect(await go()).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
