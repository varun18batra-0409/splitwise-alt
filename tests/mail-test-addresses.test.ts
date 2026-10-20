import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mail";

// ".test" addresses (used by automated tests) are kept on the private test
// copy and never sent from the live app.

const keep = { ...process.env };
afterEach(() => {
  process.env = { ...keep };
});

describe("test addresses", () => {
  it("on the test copy, the email is kept for the test to read", async () => {
    delete process.env.MAIL_OUTBOX;
    process.env.VERCEL_ENV = "preview";
    const to = `pia-${Date.now()}@uat.loopin.test`;
    expect(await sendMail(to, "Your Loopin code 123456", "123456", "<p>123456</p>")).toBe(true);
    expect(await db.outbox.count({ where: { to } })).toBe(1);
  });

  it("on the live app, it is neither sent nor kept", async () => {
    delete process.env.MAIL_OUTBOX;
    process.env.VERCEL_ENV = "production";
    process.env.SMTP_USER = "resend";
    process.env.SMTP_PASS = "not-a-real-key";
    process.env.SMTP_HOST = "127.0.0.1"; // would fail if it really tried
    const to = `pia-live-${Date.now()}@uat.loopin.test`;
    expect(await sendMail(to, "Your Loopin code 123456", "123456", "<p>123456</p>")).toBe(true);
    expect(await db.outbox.count({ where: { to } })).toBe(0);
  });
});
