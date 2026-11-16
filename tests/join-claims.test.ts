import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// Joining and accounts (Step 5):
//  - AS-5: a name that has left the group can't be taken over with "That's me", or through an invitation to it.
//  - AS-8: someone the admin removed, who deletes their account and signs up again with the same email, can't walk back in with the
//    link; only an invitation from the admin (sent after the removal) lets them in, and accepting it clears the group's note. The note
//    is only a keyed fingerprint of the email, and goes with the group.
//  - AS-6: one connection can ask for at most 20 sign-in codes a day.
// The mail service is a stand-in (nothing leaves this machine); the mail counters are this file's own.
const mail = vi.hoisted(() => ({ send: vi.fn(async (_m: unknown) => ({})) }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mail.send, close: () => undefined }) } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { joinExisting, joinNew } = await import("@/lib/join");
const { acceptInvitation } = await import("@/lib/invitations");
const { deleteAccount, accountForEmail, requestLoginCode } = await import("@/lib/auth");
const { eraseGroups } = await import("@/lib/purge");
const { sendMail } = await import("@/lib/mail");
const { emailFingerprint } = await import("@/lib/fingerprint");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const PREFIX = `jc-${stamp}:`;
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
  await db.notifyLog.deleteMany({ where: { key: { startsWith: PREFIX } } });
  await db.loginCode.deleteMany({ where: { email: { contains: stamp } } });
  await db.invite.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.appSetting.deleteMany({ where: { OR: groupIds.map((id) => ({ key: { startsWith: `removed:${id}:` } })) } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(tag: string) {
  const a = await db.account.create({ data: { email: `${tag}-${++n}-${stamp}@example.com`, name: tag } });
  accountIds.push(a.id);
  return a;
}
const asJoin = (a: { id: string; name: string; email: string }) => ({ id: a.id, name: a.name, email: a.email });
const T0 = new Date("2026-11-16T08:00:00Z").getTime();

describe("AS-5: a name that has left can't be taken over", () => {
  it("'That's me' on a left name is refused with 'left', and the row is exactly as it was", async () => {
    const zoe = await account("Zoe");
    const g = await db.group.create({
      data: {
        name: `Left ${stamp}`, inviteCode: `jc-left-${stamp}`,
        members: { create: [{ name: "Meera", claimedAt: new Date(), createdAt: new Date("2026-11-01T00:00:00Z") }, { name: "Ravi", leftAt: new Date("2026-11-10T00:00:00Z"), createdAt: new Date("2026-11-01T00:00:01Z") }, { name: "Kabir", createdAt: new Date("2026-11-01T00:00:02Z") }] },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const ravi = g.members.find((m) => m.name === "Ravi")!;
    const kabir = g.members.find((m) => m.name === "Kabir")!;
    const r = await joinExisting(g.inviteCode, asJoin(zoe), ravi.id);
    expect(r).toEqual({ ok: false, reason: "left" });
    const after = await db.member.findUniqueOrThrow({ where: { id: ravi.id } });
    expect([after.accountId, after.claimedAt, after.grantEpoch, after.leftAt?.toISOString()]).toEqual([ravi.accountId, ravi.claimedAt, ravi.grantEpoch, ravi.leftAt?.toISOString()]);
    expect(after.accountId).toBeNull();
    // Control: a name that has not left is still taken as before.
    const ok = await joinExisting(g.inviteCode, asJoin(zoe), kabir.id);
    expect(ok.ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: kabir.id } })).accountId).toBe(zoe.id);
  });

  it("an invitation to a left name gives 'This invitation is no longer open.' and nothing changes", async () => {
    const zoe = await account("Zoe");
    const g = await db.group.create({
      data: { name: `LeftInv ${stamp}`, inviteCode: `jc-linv-${stamp}`, members: { create: [{ name: "Meera", claimedAt: new Date() }, { name: "Ravi", leftAt: new Date() }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    const ravi = g.members.find((m) => m.name === "Ravi")!;
    await db.invite.create({ data: { groupId: g.id, email: zoe.email, invitedById: g.members[0].id, memberId: ravi.id, token: `tok-left-${stamp}` } });
    expect(await acceptInvitation(asJoin(zoe), `tok-left-${stamp}`)).toEqual({ ok: false, error: "This invitation is no longer open." });
    expect((await db.member.findUniqueOrThrow({ where: { id: ravi.id } })).accountId).toBeNull();
  });

  it("the join page and the join action say it in plain words", () => {
    const page = readFileSync("src/app/join/[code]/page.tsx", "utf8");
    expect(page).toContain('error === "left"');
    expect(page).toContain("That name has left this group, so it can’t be taken over. Join as yourself instead.");
    expect(readFileSync("src/app/actions.ts", "utf8")).toContain('r.reason === "left" ? "?error=left"');
  });
});

describe("AS-8: removed, deleted the account, signed up again", () => {
  // Meera (admin) started it; Pat joined later (not the admin); Rex was removed by Meera on 15 Nov.
  async function goa(tag: string) {
    const rex = await account("Rex");
    const g = await db.group.create({
      data: {
        name: `Goa ${tag} ${stamp}`, inviteCode: `jc-goa-${tag}-${stamp}`,
        members: {
          create: [
            { name: "Meera", claimedAt: new Date("2026-11-01T00:00:00Z"), createdAt: new Date("2026-11-01T00:00:00Z") },
            { name: "Pat", claimedAt: new Date("2026-11-01T00:00:01Z"), createdAt: new Date("2026-11-01T00:00:01Z") },
          ],
        },
      },
      include: { members: { orderBy: { createdAt: "asc" } } },
    });
    groupIds.push(g.id);
    const [meera, pat] = g.members;
    const removedAt = new Date("2026-11-15T00:00:00Z");
    const row = await db.member.create({ data: { name: "Rex", groupId: g.id, accountId: rex.id, claimedAt: removedAt, createdAt: new Date("2026-11-01T00:00:02Z"), leftAt: removedAt, removedAt, removedById: meera.id } });
    return { g, meera, pat, rex, row };
  }
  async function resignUp(rex: { id: string; email: string }) {
    await deleteAccount(rex.id);
    const again = await accountForEmail(rex.email);
    accountIds.push(again.id);
    return again;
  }
  const markKeys = (groupId: string) => db.appSetting.findMany({ where: { key: { startsWith: `removed:${groupId}:` } } });
  const REMOVED = "Meera removed you from this group. Ask them to invite you again.";

  it("the link no longer brings him back (joinNew and joinExisting), no row is made, and only a fingerprint of the email is kept", async () => {
    const t = await goa("a");
    const again = await resignUp(t.rex);
    expect(again.id).not.toBe(t.rex.id);
    const name = await db.member.create({ data: { name: "Someone", groupId: t.g.id } }); // a plain name row he might try to take
    const before = await db.member.count({ where: { groupId: t.g.id } });
    expect(await joinNew(t.g.inviteCode, asJoin(again), "Rex")).toEqual({ ok: false, reason: "removed", adminName: "Meera" });
    expect(await joinExisting(t.g.inviteCode, asJoin(again), name.id)).toEqual({ ok: false, reason: "removed", adminName: "Meera" });
    expect(await db.member.count({ where: { groupId: t.g.id } })).toBe(before);
    expect(await db.member.count({ where: { groupId: t.g.id, accountId: again.id } })).toBe(0);
    const keys = await markKeys(t.g.id);
    expect(keys.map((k) => k.key)).toEqual([`removed:${t.g.id}:${emailFingerprint("removed", t.rex.email)}`]);
    expect(keys[0].key + keys[0].value).not.toContain(t.rex.email);
    expect(JSON.parse(keys[0].value)).toEqual({ at: "2026-11-15T00:00:00.000Z", by: t.meera.id });
    // The join page shows the existing 'removed' screen from the same note.
    const page = readFileSync("src/app/join/[code]/page.tsx", "utf8");
    expect(page).toContain("removedByEmail");
    expect(page).toContain("removed you from this group. Ask them to invite you again.");
  });

  it("a different email is not affected (control)", async () => {
    const t = await goa("b");
    await resignUp(t.rex);
    const other = await account("Other");
    const r = await joinNew(t.g.inviteCode, asJoin(other), "Other");
    expect(r.ok).toBe(true);
  });

  it("an invitation from a non-admin is refused with the removed text, and the note stays", async () => {
    const t = await goa("c");
    const again = await resignUp(t.rex);
    const name = await db.member.create({ data: { name: "Rex2", groupId: t.g.id, addedBy: t.pat.id } });
    await db.invite.create({ data: { groupId: t.g.id, email: again.email, invitedById: t.pat.id, memberId: name.id, token: `tok-pat-${stamp}` } });
    expect(await acceptInvitation(asJoin(again), `tok-pat-${stamp}`)).toEqual({ ok: false, error: REMOVED });
    expect(await db.member.count({ where: { groupId: t.g.id, accountId: again.id } })).toBe(0);
    expect((await markKeys(t.g.id)).length).toBe(1);
  });

  it("an invitation the admin sent AFTER the removal lets him in, and the note is gone", async () => {
    const t = await goa("d");
    const again = await resignUp(t.rex);
    const name = await db.member.create({ data: { name: "Rex2", groupId: t.g.id } });
    await db.invite.create({ data: { groupId: t.g.id, email: again.email, invitedById: t.meera.id, memberId: name.id, token: `tok-meera-${stamp}` } });
    const r = await acceptInvitation(asJoin(again), `tok-meera-${stamp}`);
    expect(r.ok).toBe(true);
    expect((await db.member.findFirst({ where: { groupId: t.g.id, accountId: again.id } }))?.removedAt).toBeNull();
    expect((await markKeys(t.g.id)).length).toBe(0);
    // He is now in like anyone: the link works for him as before.
    expect((await joinNew(t.g.inviteCode, asJoin(again), "Rex")).ok).toBe(true);
  });

  it("an admin invitation sent BEFORE the removal does not count", async () => {
    const t = await goa("e");
    const again = await resignUp(t.rex);
    const name = await db.member.create({ data: { name: "Rex2", groupId: t.g.id } });
    await db.invite.create({ data: { groupId: t.g.id, email: again.email, invitedById: t.meera.id, memberId: name.id, token: `tok-old-${stamp}`, createdAt: new Date("2026-11-14T00:00:00Z") } });
    expect(await acceptInvitation(asJoin(again), `tok-old-${stamp}`)).toEqual({ ok: false, error: REMOVED });
  });

  it("an account that was never removed is untouched when it deletes itself (no note)", async () => {
    const t = await goa("f");
    const other = await account("Plain");
    await deleteAccount(other.id);
    expect((await markKeys(t.g.id)).length).toBe(0);
  });

  it("erasing the group deletes the note", async () => {
    const t = await goa("g");
    await resignUp(t.rex);
    expect((await markKeys(t.g.id)).length).toBe(1);
    expect(await eraseGroups([t.g.id])).toBe(1);
    expect((await markKeys(t.g.id)).length).toBe(0);
  });
});

describe("AS-6: sign-in codes per connection", () => {
  const IP = `ip-${stamp}`;
  const ask = (i: number, atMs: number) => requestLoginCode(`code-${i}-${stamp}@example.com`, IP, "https://loopin.test", new Date(atMs));
  const TOO_MANY = "Too many codes asked for from here today. Try again tomorrow, or sign in with Google or your fingerprint or face above.";

  it("8 at the start and 8 sixteen minutes later are fine, 4 more make 20, the 21st is refused, and a day later it works again", async () => {
    let i = 0;
    for (let k = 0; k < 8; k++) expect((await ask(++i, T0)).ok).toBe(true); // 8
    for (let k = 0; k < 8; k++) expect((await ask(++i, T0 + 16 * 60_000)).ok).toBe(true); // 16
    for (let k = 0; k < 4; k++) expect((await ask(++i, T0 + 32 * 60_000)).ok).toBe(true); // 20
    expect(await ask(++i, T0 + 33 * 60_000)).toEqual({ ok: false, error: TOO_MANY }); // the 21st
    expect((await db.rateLimit.findUnique({ where: { key: `code-ip-day:${IP}` } }))?.count).toBe(20);
    expect((await ask(++i, T0 + 24 * 3_600_000 + 60_000)).ok).toBe(true);
    expect((await db.rateLimit.findUnique({ where: { key: `code-ip-day:${IP}` } }))?.count).toBe(1);
  });

  it("another connection is not affected", async () => {
    expect((await requestLoginCode(`other-${stamp}@example.com`, `${IP}-other`, "https://loopin.test", new Date(T0))).ok).toBe(true);
  });

  it("half of the day's email allowance used: one line in the error list, once a day", async () => {
    process.env.MAIL_DAILY_CAP = "4"; // half is 2
    const lines = () => db.errorLog.count({ where: { path: "mail", message: "half of today's email allowance used" } });
    const before = await lines();
    const send = (k: number) => sendMail(`half-${k}-${stamp}@example.com`, "123456 is your Loopin code", "code", "<p>code</p>", { signInCode: true });
    expect(await send(1)).toBe(true);
    expect(await lines()).toBe(before); // 1 of 4 used
    expect(await send(2)).toBe(true);
    expect(await lines()).toBe(before + 1); // 2 of 4 used: half
    expect(await send(3)).toBe(true);
    expect(await lines()).toBe(before + 1); // not noted twice in a day
  });
});
