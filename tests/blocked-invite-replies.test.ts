import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// N5: an invitation by email to someone who blocked the inviter must look EXACTLY like a real one from the outside, in every
// situation, so nobody can work out from the reply whether they were blocked. The blocked email goes through the same checks
// and counters (opted out, invite emails switched off, daily cap, mail not set up, one address's daily limit) and gives the
// same answer; the only difference is that it is never handed to the mail service.
// The reply is given from the checks alone: the email goes after the reply (the `later` job), so a blocked invite can't be told
// apart by how long it takes, and a send that can't go (opted out, caps, mail not set up) does not change the reply either.
// nodemailer is replaced by a stand-in: nothing leaves this machine. The mail counters are this file's own (MAIL_COUNTER_PREFIX).
const mail = vi.hoisted(() => ({ send: vi.fn(async (_m: unknown) => ({})) }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mail.send, close: () => undefined }) } }));

const { db } = await import("@/lib/db");
const { inviteToClaim } = await import("@/lib/invites");
const { blockAccount } = await import("@/lib/blocks");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const PREFIX = `bi-${stamp}:`;
const saved = { ...process.env };
const accountIds: string[] = [];
const groupIds: string[] = [];
let n = 0;

beforeEach(async () => {
  process.env = { ...saved };
  delete process.env.MAIL_OUTBOX;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  process.env.SMTP_HOST = "smtp.resend.com";
  process.env.SMTP_USER = "stand-in-user";
  process.env.SMTP_PASS = "stand-in-pass";
  process.env.MAIL_DAILY_CAP = "95";
  process.env.MAIL_COUNTER_PREFIX = PREFIX;
  mail.send.mockReset();
  mail.send.mockResolvedValue({});
  await db.rateLimit.deleteMany({ where: { key: { startsWith: PREFIX } } });
});
afterAll(async () => {
  process.env = { ...saved };
  await db.rateLimit.deleteMany({ where: { key: { contains: stamp } } });
  await db.emailOptOut.deleteMany({ where: { email: { contains: stamp } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(tag: string, extra: { notifyPrefs?: string } = {}) {
  const a = await db.account.create({ data: { email: `${tag}-${++n}-${stamp}@example.com`, name: tag, ...extra } });
  accountIds.push(a.id);
  return a;
}

// One run of the same situation twice: once to a person who blocked the inviter, once to a person who did not.
async function bothReplies(prepare: (email: string) => Promise<void> = async () => undefined, opts: { notifyPrefs?: string } = {}) {
  const inviter = await account("inviter");
  const blocker = await account("blocker", opts);
  const friend = await account("friend", opts);
  const g = await db.group.create({
    data: { name: `BI ${stamp} ${n}`, inviteCode: `bi-${n}-${stamp}`, members: { create: [{ name: "Inviter", accountId: inviter.id, claimedAt: new Date() }, { name: "Name A" }, { name: "Name B" }] } },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  groupIds.push(g.id);
  const [me, a, b] = g.members;
  await blockAccount(blocker.id, inviter.id);
  await prepare(blocker.email);
  await prepare(friend.email);
  mail.send.mockClear();
  const toBlocker = await inviteToClaim(g.id, me.id, a.id, blocker.email, "https://loopin.test");
  const sentToBlocker = mail.send.mock.calls.length;
  mail.send.mockClear();
  const toFriend = await inviteToClaim(g.id, me.id, b.id, friend.email, "https://loopin.test");
  const sentToFriend = mail.send.mock.calls.length;
  const strip = (r: typeof toBlocker) => ("error" in r ? { ok: r.ok, error: r.error } : { ok: r.ok });
  return { blocked: strip(toBlocker), open: strip(toFriend), sentToBlocker, sentToFriend };
}

describe("a blocked invitation gives the same reply as a real one", () => {
  it("normal case: both succeed; only the real one reaches the mail service", async () => {
    const r = await bothReplies();
    expect(r.blocked).toEqual({ ok: true });
    expect(r.blocked).toEqual(r.open);
    expect(r.sentToFriend).toBe(1);
    expect(r.sentToBlocker).toBe(0);
  });

  it("the person has opted out of invite emails: the same reply", async () => {
    const r = await bothReplies(async (email) => {
      await db.emailOptOut.create({ data: { email: email.toLowerCase() } });
    });
    expect(r.blocked).toEqual(r.open);
    expect(r.sentToBlocker + r.sentToFriend).toBe(0);
  });

  it("the person switched 'added to a group' emails off: the same reply", async () => {
    const r = await bothReplies(undefined, { notifyPrefs: '{"email":{"groups.added":false}}' });
    expect(r.blocked).toEqual(r.open);
    expect(r.sentToBlocker + r.sentToFriend).toBe(0);
  });

  it("the daily cap is reached: the same reply for both; nothing is sent", async () => {
    // The shared budget is full within the provider's current day (both counters cover the same 24 hours).
    for (const [k, c] of [["mail:all", 65], ["mail:other", 65]] as const) {
      await db.rateLimit.upsert({ where: { key: `${PREFIX}${k}` }, create: { key: `${PREFIX}${k}`, count: c, resetAt: new Date(Date.now() + 86_400_000) }, update: { count: c, resetAt: new Date(Date.now() + 86_400_000) } });
    }
    const r = await bothReplies();
    expect(r.open.ok).toBe(true);
    expect(r.blocked).toEqual(r.open);
    expect(r.sentToBlocker + r.sentToFriend).toBe(0);
  });

  it("mail is not set up: the same reply for both; nothing is sent", async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const r = await bothReplies();
    expect(r.open.ok).toBe(true);
    expect(r.blocked).toEqual(r.open);
  });

  it("one address has had its 10 for the day: the same reply for both; nothing is sent", async () => {
    const r = await bothReplies(async (email) => {
      const key = `mail:to:${email.toLowerCase()}`;
      await db.rateLimit.upsert({ where: { key }, create: { key, count: 10, resetAt: new Date(Date.now() + 86_400_000) }, update: { count: 10 } });
    });
    expect(r.open.ok).toBe(true);
    expect(r.blocked).toEqual(r.open);
    expect(r.sentToBlocker + r.sentToFriend).toBe(0);
  });

  it("the reply does not wait for the send: nothing reaches the mail service until the after-reply job runs", async () => {
    const inviter = await account("inviter");
    const blocker = await account("blocker");
    const friend = await account("friend");
    const g = await db.group.create({
      data: { name: `BI ${stamp} later`, inviteCode: `bi-later-${stamp}`, members: { create: [{ name: "Inviter", accountId: inviter.id, claimedAt: new Date() }, { name: "Name A" }, { name: "Name B" }] } },
      include: { members: { orderBy: { createdAt: "asc" } } },
    });
    groupIds.push(g.id);
    const [me, a, b] = g.members;
    await blockAccount(blocker.id, inviter.id);
    mail.send.mockClear();
    const jobs: (() => Promise<unknown>)[] = [];
    const later = (job: () => Promise<unknown>) => void jobs.push(job);
    const r1 = await inviteToClaim(g.id, me.id, a.id, blocker.email, "https://loopin.test", { later });
    const r2 = await inviteToClaim(g.id, me.id, b.id, friend.email, "https://loopin.test", { later });
    expect(r1).toEqual({ ok: true, email: blocker.email });
    expect(r2).toEqual({ ok: true, email: friend.email });
    expect(jobs).toHaveLength(2); // one background job each, handled the same way
    expect(mail.send).not.toHaveBeenCalled(); // nothing was sent while replying
    for (const job of jobs) await job();
    expect(mail.send).toHaveBeenCalledTimes(1); // only the real one goes out
  });

  it("and the blocked one uses the same counters: after one of each, mail:other and mail:all are at 2", async () => {
    await bothReplies();
    expect((await db.rateLimit.findUnique({ where: { key: `${PREFIX}mail:other` } }))?.count).toBe(2);
    expect((await db.rateLimit.findUnique({ where: { key: `${PREFIX}mail:all` } }))?.count).toBe(2);
  });
});
