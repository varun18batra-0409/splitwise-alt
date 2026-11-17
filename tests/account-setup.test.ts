import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// L-2: if the saved blocks can't be put back when an account is made, the account is not made (with a clear retry message), never an
// account that quietly has none of the blocks against it. And the fingerprint key: the session's own secret (AUTH_SECRET, else the database token), never a new setting.
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

describe("two sign-ups for the same email at the same moment", () => {
  it("both get the same account, and the block is put back exactly once", async () => {
    const blocker = await db.account.create({ data: { email: `race-blocker-${stamp}@example.test`, name: "Asha" } });
    const target = await db.account.create({ data: { email: `race-target-${stamp}@example.test`, name: "Ben" } });
    await blockAccount(blocker.id, target.id);
    const { deleteAccount } = await import("@/lib/auth");
    await deleteAccount(target.id);
    const [one, two] = await Promise.all([accountForEmail(target.email), accountForEmail(target.email)]);
    expect(one.id).toBe(two.id);
    expect(await db.account.count({ where: { email: target.email } })).toBe(1);
    expect(await db.block.count({ where: { blockerId: blocker.id, blockedId: one.id } })).toBe(1);
    // A third, later sign-in is the same account, and changes nothing.
    expect((await accountForEmail(target.email)).id).toBe(one.id);
    expect(await db.block.count({ where: { blockedId: one.id } })).toBe(1);
    await db.block.deleteMany({ where: { blockedId: one.id } });
    await db.appSetting.deleteMany({ where: { key: { startsWith: "blockfp:", endsWith: `:${blocker.id}` } } });
    await db.account.deleteMany({ where: { id: { in: [blocker.id, one.id] } } });
  });

  it("the account and the blocks are made in one transaction, with no delete-after-failure path", () => {
    const auth = readFileSync("src/lib/auth.ts", "utf8");
    const fn = auth.slice(auth.indexOf("export async function accountForEmail"), auth.indexOf('// "Delete my account"'));
    expect(fn).toContain("db.$transaction(");
    expect(fn).toContain("reapplyBlocks(tx, made.id, email)");
    expect(fn).not.toContain(".catch(");
    expect(fn).not.toContain("account.delete");
  });
});

describe("the fingerprint key is the session's secret, so it never needs AUTH_SECRET", () => {
  it("with only the database token (no AUTH_SECRET) it works, and differs from a different token", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.AUTH_SECRET;
    process.env.TURSO_AUTH_TOKEN = "token-one";
    const one = emailFingerprint("block", "a@b.co");
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    process.env.TURSO_AUTH_TOKEN = "token-two";
    expect(emailFingerprint("block", "a@b.co")).not.toBe(one); // rotating the session secret resets fingerprints (it signs everyone out anyway)
  });
  it("AUTH_SECRET wins when it is set, exactly as for sessions; the purpose and the email's capitals are handled", () => {
    process.env.VERCEL_ENV = "production";
    process.env.AUTH_SECRET = "secret-one";
    process.env.TURSO_AUTH_TOKEN = "token-one";
    const a = emailFingerprint("block", "A@B.co");
    expect(a).toBe(emailFingerprint("block", " a@b.co "));
    expect(a).not.toBe(emailFingerprint("removed", "a@b.co"));
    process.env.TURSO_AUTH_TOKEN = "token-two";
    expect(emailFingerprint("block", "a@b.co")).toBe(a); // the token is not used while AUTH_SECRET is set
    process.env.AUTH_SECRET = "secret-two";
    expect(emailFingerprint("block", "a@b.co")).not.toBe(a);
  });
  it("on the live app with neither secret it refuses, the same guard sessions use; away from the live app it still works", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.AUTH_SECRET;
    delete process.env.TURSO_AUTH_TOKEN;
    expect(() => emailFingerprint("block", "a@b.co")).toThrow("AUTH_SECRET is missing");
    delete process.env.VERCEL_ENV;
    expect(emailFingerprint("block", "a@b.co")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("it is built on the session's own secret() and the session code is unchanged apart from being exported", () => {
    expect(readFileSync("src/lib/fingerprint.ts", "utf8")).toContain('import { secret } from "./session"');
    expect(readFileSync("src/lib/session.ts", "utf8")).toContain("export function secret(): string {");
  });
});
