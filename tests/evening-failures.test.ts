import { afterAll, describe, expect, it, vi } from "vitest";

// R11: what the evening job does when its catch-up fails: the failure is written to the error log (scrubbed), which the morning email reads.
const mocks = vi.hoisted(() => ({ pulse: vi.fn(async () => ({ sent: 0 }) as unknown), parts: vi.fn(async (_now: Date, _stop: unknown, failed: string[]): Promise<{ results: Record<string, unknown>; deferred: string[] }> => ({ results: {}, deferred: [] })) }));
vi.mock("@/lib/daily-job", async (orig) => ({ ...(await orig<typeof import("@/lib/daily-job")>()), runDeferredParts: mocks.parts }));
vi.mock("@/lib/countdown-db", async (orig) => ({ ...(await orig<typeof import("@/lib/countdown-db")>()), sendDayPulse: mocks.pulse }));
vi.mock("@/lib/passport-db", async (orig) => ({ ...(await orig<typeof import("@/lib/passport-db")>()), celebrateRecentTrips: vi.fn(async () => 0) }));

const { db } = await import("@/lib/db");
const { GET } = await import("@/app/api/cron/evening/route");

const saved = process.env.CRON_SECRET;
const call = () => GET(new Request("http://x/api/cron/evening", { headers: { authorization: "Bearer evening-test-secret" } }));
const lines = async () => (await db.errorLog.findMany({ where: { path: "cron/evening" }, orderBy: { createdAt: "asc" } })).map((r) => r.message);
afterAll(async () => {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
  await db.errorLog.deleteMany({ where: { path: "cron/evening" } });
});

describe("the evening job writes its failures to the error log", () => {
  it("parts that failed again tonight are listed, once", async () => {
    process.env.CRON_SECRET = "evening-test-secret";
    await db.errorLog.deleteMany({ where: { path: "cron/evening" } });
    mocks.parts.mockImplementationOnce(async (_n, _s, failed) => {
      failed.push("bills", "budgets");
      return { results: {}, deferred: [] };
    });
    const res = await call();
    expect((await res.json()).failed).toEqual(["bills", "budgets"]);
    expect(await lines()).toEqual(["evening catch-up failed: bills, budgets"]);
  });
  it("a catch-up that crashes is logged and the job still answers", async () => {
    await db.errorLog.deleteMany({ where: { path: "cron/evening" } });
    mocks.parts.mockRejectedValueOnce(new Error("db down for ana@example.com"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await lines()).toEqual(["evening job: catch-up of the morning parts failed"]);
  });
  it("the whole job failing answers 500, and what is stored has no email address", async () => {
    await db.errorLog.deleteMany({ where: { path: "cron/evening" } });
    mocks.pulse.mockRejectedValueOnce(new Error("cannot reach ana@example.com"));
    expect((await call()).status).toBe(500);
    expect(await lines()).toEqual(["evening job failed: cannot reach [email]"]);
  });
  it("a quiet evening writes nothing", async () => {
    await db.errorLog.deleteMany({ where: { path: "cron/evening" } });
    await call();
    expect(await lines()).toEqual([]);
  });
});
