import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// INV-06: a job that broke is counted as a failure, never passed off as an empty success.
const fake = vi.hoisted(() => ({ budgetsBreak: false }));
vi.mock("@/lib/home/budgets-db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/home/budgets-db")>();
  return {
    ...real,
    checkBudgets: async (...args: Parameters<typeof real.checkBudgets>) => {
      if (fake.budgetsBreak) throw new Error("budget check broke");
      return real.checkBudgets(...args);
    },
  };
});
vi.mock("@vercel/blob", () => ({ put: vi.fn(), del: vi.fn(async () => undefined), get: vi.fn(async () => null) }));

const { db } = await import("@/lib/db");
const { runClaimedParts } = await import("@/lib/daily-job");
const { flushPhotoDeletes } = await import("@/lib/photo-store");
const { sendOpsDigest } = await import("@/lib/ops-digest");
const { sendPushTo } = await import("@/lib/push");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const saved = { VERCEL: process.env.VERCEL, TOKEN: process.env.BLOB_READ_WRITE_TOKEN, ADMIN: process.env.ADMIN_EMAIL };
const groupIds: string[] = [];

beforeAll(() => {
  process.env.VERCEL = "1";
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
});
afterAll(async () => {
  vi.restoreAllMocks();
  for (const [k, v] of [["VERCEL", saved.VERCEL], ["BLOB_READ_WRITE_TOKEN", saved.TOKEN], ["ADMIN_EMAIL", saved.ADMIN]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await db.errorLog.deleteMany({ where: { path: "push", message: { contains: "sendPushTo" } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

describe("photo clean-up", () => {
  it("a run that breaks says so (error, failed >= 1) instead of returning an empty success", async () => {
    // Fails once, then calls through to the real one. (No mockRestore: on the database client it removes the real method.)
    vi.spyOn(db.blobTrash, "findMany").mockRejectedValueOnce(new Error("db down"));
    const r = await flushPhotoDeletes();
    expect(r.error).toContain("db down");
    expect(r.failed).toBeGreaterThanOrEqual(1);
    // A normal run has no error field.
    expect((await flushPhotoDeletes()).error).toBeUndefined();
  });

  it("the daily 'blob-trash' part is listed as failed when the clean-up broke", async () => {
    // Fails once, then calls through to the real one. (No mockRestore: on the database client it removes the real method.)
    vi.spyOn(db.blobTrash, "findMany").mockRejectedValueOnce(new Error("db down"));
    const failed: string[] = [];
    const report = await runClaimedParts(new Date(), () => false, failed, ["blob-trash"]);
    expect(failed).toEqual(["blob-trash"]);
    expect(report.results["blob-trash"]).toEqual({ error: "failed" });
  });
});

describe("daily budgets part", () => {
  it("a group whose budget check broke makes the part fail (and the others still run)", async () => {
    const g = await db.group.create({ data: { name: `JF ${stamp}`, inviteCode: `jf-${stamp}`, members: { create: [{ name: "Ann" }] } } });
    groupIds.push(g.id);
    await db.budget.create({ data: { groupId: g.id, category: "food", amount: 1000 } });
    fake.budgetsBreak = true;
    try {
      const failed: string[] = [];
      await runClaimedParts(new Date(), () => false, failed, ["budgets"]);
      expect(failed).toEqual(["budgets"]);
    } finally {
      fake.budgetsBreak = false;
    }
    const ok: string[] = [];
    await runClaimedParts(new Date(), () => false, ok, ["budgets"]);
    expect(ok).toEqual([]);
  });
});

describe("daily check email", () => {
  it("a photo-delete check that couldn't run is a problem in itself, not 'all quiet'", async () => {
    process.env.ADMIN_EMAIL = `ops-${stamp}@example.test`;
    // Fails once, then calls through (no mockRestore on the database client: it would remove the real method).
    vi.spyOn(db.blobTrash, "count").mockRejectedValueOnce(new Error("db down"));
    const r = await sendOpsDigest(new Date(), []);
    expect(r.reason).toBe("issues");
  });
});

describe("push sends", () => {
  it("a send that broke is written to the error list and still returns 0", async () => {
    const before = await db.errorLog.count({ where: { path: "push", message: { startsWith: "sendPushTo" } } });
    vi.spyOn(db.pushSubscription, "findMany").mockRejectedValueOnce(new Error("db down"));
    const sent = await sendPushTo(["someone"], { title: "t", body: "b", url: "/", tag: "x" }, "expenses.added");
    expect(sent).toBe(0);
    expect(await db.errorLog.count({ where: { path: "push", message: { startsWith: "sendPushTo" } } })).toBe(before + 1);
  });
});
