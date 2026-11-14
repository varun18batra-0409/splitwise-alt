import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Reporting and blocking for moments: a report is only possible for a moment the reporter can see, and it points at the author's
// account. Blocking hides the author's moments (the access rules themselves are in moments-storage-e2e.test.ts).

const state = vi.hoisted(() => ({ session: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.session ? { value: state.session } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/fresh-redirect", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const { resolveReportTarget, REPORT_KINDS } = await import("@/lib/reports");
const { reportAction, blockAction } = await import("@/app/safety-actions");
const { loadMomentViewer } = await import("@/lib/moments-access");
const { listMoments, removeMoment } = await import("@/lib/moments-db");
const { deleteAccount } = await import("@/lib/auth");
const { eraseGroups } = await import("@/lib/purge");

process.env.MAIL_OUTBOX = "1";
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

async function account(label: string) {
  const a = await db.account.create({ data: { email: `mr-${label.toLowerCase()}-${stamp}@example.test`, name: label } });
  accountIds.push(a.id);
  return a;
}
const asAccount = async (a: { id: string } | null) => {
  state.session = a ? await encodeSession({ m: {}, a: a.id, v: 0, t: today() }) : "";
};
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function redirected(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    const m = /^REDIRECT (.*)$/.exec(String((err as Error).message));
    if (!m) throw err;
    return m[1];
  }
  return "";
}

const T = {} as Record<"asha" | "ben" | "cleo" | "dev" | "lou" | "out", Awaited<ReturnType<typeof account>>>;
let g: { id: string; ben: string; lou: string };
let momentId: string;
let lateId: string;

beforeAll(async () => {
  for (const n of ["asha", "ben", "cleo", "dev", "lou", "out"] as const) T[n] = await account(n);
  const grp = await db.group.create({
    data: {
      name: `Moment reports ${stamp}`, inviteCode: `mr-${stamp}`, type: "trip",
      members: {
        create: [
          { name: "Asha", accountId: T.asha.id, claimedAt: new Date(), createdAt: new Date(2026, 0, 1) },
          { name: "Ben", accountId: T.ben.id, claimedAt: new Date(), createdAt: new Date(2026, 0, 2) },
          { name: "Cleo", accountId: T.cleo.id, claimedAt: new Date(), createdAt: new Date(2026, 0, 3) },
          { name: "Lou", accountId: T.lou.id, claimedAt: new Date(), createdAt: new Date(2026, 0, 4), leftAt: ago(1) },
          { name: "Dev", accountId: T.dev.id, createdAt: new Date(2026, 0, 5), addedBy: "Asha" }, // never opened the group
        ],
      },
    },
    include: { members: true },
  });
  groupIds.push(grp.id);
  const m = (n: string) => grp.members.find((x) => x.name === n)!.id;
  g = { id: grp.id, ben: m("Ben"), lou: m("Lou") };
  const mk = (createdAt: Date) => db.moment.create({ data: { groupId: grp.id, authorId: g.ben, authorAccountId: T.ben.id, caption: "hello", data: new Uint8Array(), thumbData: new Uint8Array(), createdAt } });
  momentId = (await mk(ago(3))).id; // before Lou left
  lateId = (await mk(new Date())).id; // after Lou left
});
afterAll(async () => {
  await db.report.deleteMany({ where: { reporterId: { in: accountIds } } });
  await db.moment.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.block.deleteMany({ where: { OR: [{ blockerId: { in: accountIds } }, { blockedId: { in: accountIds } }] } });
  await db.outbox.deleteMany({ where: { to: { contains: stamp } } }).catch(() => undefined);
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("reporting a moment", () => {
  it("moment is a kind of report", () => expect(REPORT_KINDS).toContain("moment"));

  it("a member's report points at the author's account", async () => {
    expect(await resolveReportTarget(T.asha.id, "moment", momentId)).toEqual({ accountId: T.ben.id });
    expect(await resolveReportTarget(T.cleo.id, "moment", lateId)).toEqual({ accountId: T.ben.id });
  });

  it("someone who left can report one from before they left, not one added after", async () => {
    expect(await resolveReportTarget(T.lou.id, "moment", momentId)).toEqual({ accountId: T.ben.id });
    expect(await resolveReportTarget(T.lou.id, "moment", lateId)).toBeNull();
  });

  it("a non-member, a person who never opened the group, and the author themselves can't report it", async () => {
    expect(await resolveReportTarget(T.out.id, "moment", momentId)).toBeNull();
    expect(await resolveReportTarget(T.dev.id, "moment", momentId)).toBeNull();
    expect(await resolveReportTarget(T.ben.id, "moment", momentId)).toBeNull();
    expect(await resolveReportTarget(T.asha.id, "moment", "no-such-moment")).toBeNull();
  });

  it("the report action saves it with kind moment, once, and refuses a non-member", async () => {
    await asAccount(T.asha);
    const send = (id: string, reason = "abusive") => redirected(() => reportAction(form({ kind: "moment", id, reason, note: "not kind", back: `/groups/${g.id}/moments` })));
    expect(await send(momentId)).toContain("done=1");
    await send(momentId);
    const rows = await db.report.findMany({ where: { reporterId: T.asha.id, kind: "moment" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetId: momentId, targetAccountId: T.ben.id, reason: "abusive", status: "open" });
    await asAccount(T.out);
    expect(await send(momentId)).toContain("error=");
    expect(await db.report.count({ where: { reporterId: T.out.id } })).toBe(0);
    await asAccount(null);
    expect(await send(momentId)).toContain("/signin");
  });
});

describe("blocking the author of a moment", () => {
  it("their moments disappear from the blocker's list, and the blocker's from theirs", async () => {
    await asAccount(T.cleo);
    expect((await listMoments(await loadMomentViewer(g.id))).map((c) => c.id).sort()).toEqual([momentId, lateId].sort());
    expect(await redirected(() => blockAction(form({ accountId: T.ben.id, back: `/groups/${g.id}/moments` })))).toContain("blocked=1");
    expect(await listMoments(await loadMomentViewer(g.id))).toEqual([]);
    // The author no longer sees the blocker's moments either (there are none here, but the viewer carries the block).
    await asAccount(T.ben);
    expect((await loadMomentViewer(g.id))!.blocked.has(T.cleo.id)).toBe(true);
    // Everyone else is unaffected.
    await asAccount(T.asha);
    expect(await listMoments(await loadMomentViewer(g.id))).toHaveLength(2);
  });
});

describe("what happens to a moment's open reports when it goes", () => {
  async function reported(label: string) {
    const author = await account(`au-${label}`);
    const reporter = await account(`rp-${label}`);
    const grp = await db.group.create({
      data: {
        name: `Report close ${label} ${stamp}`, inviteCode: `rc-${label}-${stamp}`, type: "trip",
        members: { create: [{ name: "Author", accountId: author.id, claimedAt: new Date() }, { name: "Reporter", accountId: reporter.id, claimedAt: new Date() }] },
      },
      include: { members: true },
    });
    groupIds.push(grp.id);
    const mk = (caption: string) => db.moment.create({ data: { groupId: grp.id, authorId: grp.members[0].id, authorAccountId: author.id, caption, data: new Uint8Array(), thumbData: new Uint8Array() } });
    const mine = await mk("x");
    const other = await mk("y");
    const report = (targetId: string, status = "open", resolvedAt: Date | null = null) =>
      db.report.create({ data: { reporterId: reporter.id, kind: "moment", targetId, targetAccountId: author.id, reason: "other", status, resolvedAt } });
    const reload = (id: string) => db.report.findUniqueOrThrow({ where: { id } });
    return { grp, author, reporter, mine, other, report, reload };
  }

  it("the author deleting their own moment leaves its open reports OPEN (the operator still sees them)", async () => {
    const t = await reported("author");
    const r = await t.report(t.mine.id);
    expect(await removeMoment(t.mine.id)).toBe(true);
    expect(await db.moment.count({ where: { id: t.mine.id } })).toBe(0);
    expect(await t.reload(r.id)).toMatchObject({ status: "open", resolvedAt: null });
  });

  it("the operator's remove closes that moment's open reports (with a time), and only those", async () => {
    const t = await reported("op");
    const a = await t.report(t.mine.id);
    const b = await t.report(t.mine.id);
    const elsewhere = await t.report(t.other.id);
    expect(await removeMoment(t.mine.id, { resolveReports: true })).toBe(true);
    for (const id of [a.id, b.id]) {
      const r = await t.reload(id);
      expect(r.status).toBe("resolved");
      expect(r.resolvedAt).not.toBeNull();
    }
    expect(await t.reload(elsewhere.id)).toMatchObject({ status: "open", resolvedAt: null });
  });

  it("the operator removing a moment the author already deleted still closes its reports", async () => {
    const t = await reported("gone");
    const r = await t.report(t.mine.id);
    await removeMoment(t.mine.id); // the author's delete: report stays open
    expect(await t.reload(r.id)).toMatchObject({ status: "open" });
    expect(await removeMoment(t.mine.id, { resolveReports: true })).toBe(false); // already gone
    expect(await t.reload(r.id)).toMatchObject({ status: "resolved" });
    expect((await t.reload(r.id)).resolvedAt).not.toBeNull();
  });

  it("a report that was already resolved keeps its original time", async () => {
    const t = await reported("old");
    const before = new Date(2026, 0, 5);
    const done = await t.report(t.mine.id, "resolved", before);
    await removeMoment(t.mine.id, { resolveReports: true });
    expect((await t.reload(done.id)).resolvedAt?.getTime()).toBe(before.getTime());
  });

  it("deleting the author's account leaves open reports on their moments OPEN", async () => {
    const t = await reported("acct");
    const a = await t.report(t.mine.id);
    const b = await t.report(t.other.id);
    await deleteAccount(t.author.id);
    expect(await db.moment.count({ where: { authorAccountId: t.author.id } })).toBe(0);
    expect(await t.reload(a.id)).toMatchObject({ status: "open", resolvedAt: null });
    expect(await t.reload(b.id)).toMatchObject({ status: "open", resolvedAt: null });
  });

  it("erasing a deleted group closes the open reports on all its moments, and not other groups' reports", async () => {
    const t = await reported("purge");
    const keep = await reported("keep");
    const a = await t.report(t.mine.id);
    const b = await t.report(t.other.id);
    const unrelated = await keep.report(keep.mine.id);
    await db.group.update({ where: { id: t.grp.id }, data: { deletedAt: new Date(Date.now() - 40 * 86_400_000) } });
    expect(await eraseGroups([t.grp.id])).toBe(1);
    expect(await db.moment.count({ where: { groupId: t.grp.id } })).toBe(0);
    for (const id of [a.id, b.id]) {
      const r = await t.reload(id);
      expect(r.status).toBe("resolved");
      expect(r.resolvedAt).not.toBeNull();
    }
    expect(await t.reload(unrelated.id)).toMatchObject({ status: "open" });
  });
});
