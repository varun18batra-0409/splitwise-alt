import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// L-2: if the saved blocks can't be put back when an account is made, the account is not made (with a clear retry message), never an
// account that quietly has none of the blocks against it. And the fingerprint secret: AUTH_SECRET only, never a fallback, on the live app.
const flaky = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/block-marks", async (orig) => {
  const real = await orig<typeof import("@/lib/block-marks")>();
  return { ...real, reapplyBlocks: async (...a: Parameters<typeof real.reapplyBlocks>) => (flaky.fail ? Promise.reject(new Error("database busy")) : real.reapplyBlocks(...a)) };
});

const { db } = await import("@/lib/db");
const { accountForEmail, AccountSetupError, ACCOUNT_SETUP_FAILED } = await import("@/lib/auth");
const { blockAccount } = await import("@/lib/blocks");
const { emailFingerprint } = await import("@/lib/fingerprint");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  flaky.fail = false;
});

describe("account set-up when the saved blocks can't be put back", () => {
  it("no account is made, the message says to try again, and it works on the next try with the block back", async () => {
    const blocker = await db.account.create({ data: { email: `as-blocker-${stamp}@example.test`, name: "Asha" } });
    const target = await db.account.create({ data: { email: `as-target-${stamp}@example.test`, name: "Ben" } });
    await blockAccount(blocker.id, target.id);
    const { deleteAccount } = await import("@/lib/auth");
    await deleteAccount(target.id);
    flaky.fail = true;
    await expect(accountForEmail(target.email)).rejects.toBeInstanceOf(AccountSetupError);
    expect(await db.account.count({ where: { email: target.email } })).toBe(0);
    expect(ACCOUNT_SETUP_FAILED).toBe("Couldn’t finish setting up your account. Wait a minute, then ask for a new code and try again.");
    flaky.fail = false;
    const again = await accountForEmail(target.email);
    expect(await db.block.count({ where: { blockerId: blocker.id, blockedId: again.id } })).toBe(1);
    await db.block.deleteMany({ where: { blockedId: again.id } });
    await db.appSetting.deleteMany({ where: { key: { startsWith: "blockfp:", endsWith: `:${blocker.id}` } } });
    await db.account.deleteMany({ where: { id: { in: [blocker.id, again.id] } } });
  });

  it("email sign-in and Google both turn it into a message, not a crash", () => {
    expect(readFileSync("src/lib/auth.ts", "utf8")).toContain("if (err instanceof AccountSetupError) return { ok: false, error: ACCOUNT_SETUP_FAILED };");
    expect(readFileSync("src/app/api/auth/google/callback/route.ts", "utf8")).toContain("AccountSetupError");
  });
});

describe("the fingerprint secret", () => {
  it("on the live app with no AUTH_SECRET it refuses, even if a database token is present", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.AUTH_SECRET;
    process.env.TURSO_AUTH_TOKEN = "some-database-token";
    expect(() => emailFingerprint("block", "a@b.co")).toThrow("AUTH_SECRET is missing");
  });
  it("with AUTH_SECRET it works, and a different secret gives a different fingerprint", () => {
    process.env.VERCEL_ENV = "production";
    process.env.AUTH_SECRET = "secret-one";
    const one = emailFingerprint("block", "a@b.co");
    process.env.AUTH_SECRET = "secret-two";
    expect(emailFingerprint("block", "a@b.co")).not.toBe(one);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
  });
  it("away from the live app it still works (local development and tests)", () => {
    delete process.env.AUTH_SECRET;
    delete process.env.VERCEL_ENV;
    expect(emailFingerprint("block", "a@b.co")).toMatch(/^[0-9a-f]{64}$/);
  });
});
