import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { addDraft, applyMe, draftsFor } from "@/lib/offline/store";
import { memoryKV } from "@/lib/offline/memory-kv";
import { settleSignOutNote } from "@/lib/offline/signout";
import type { DraftInput } from "@/lib/offline/types";

// The last independent check: Back-button drafts, their own send limits, the half-saved offline screen, sign-out settling, the slow-storage wait.
const src = (p: string) => readFileSync(`${__dirname}/../${p}`, "utf8");

const calls = vi.hoisted(() => [] as { key: string; max: number }[]);
vi.mock("@/lib/rate-limit", () => ({ allow: async (key: string, max: number) => (calls.push({ key, max }), true), clientIp: () => "1.1.1.1" }));
vi.mock("@/lib/db", () => ({ db: { group: { findUnique: async () => ({ type: "trip" }) } } }));
vi.mock("@/lib/direct-db", () => ({ prepareDirectSave: async () => null }));
vi.mock("@/lib/identity", () => ({ getMyMemberId: async () => "asha" }));

const draft = (key: string, over: Partial<DraftInput> = {}): DraftInput => ({
  key, groupId: "g1", memberId: "asha", day: "2026-11-17", typedAt: 1_000, name: "Taxi", amount: "1200", currency: "INR", category: "",
  paidById: "asha", multiPay: false, payers: {}, forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {},
  shares: {}, kind: "expense", paymentMethod: "cash", markupChoice: "group", markupCustom: "", notes: "", rateMode: "auto", manualRate: "",
  seen: { baseCurrency: "INR", cardMarkupBp: 0, activeMemberIds: ["asha", "ben"], snapshotAt: "2026-11-17T08:00:00.000Z" },
  ...over,
});

describe("1. a key is never reused for different contents", () => {
  it("same key, different contents: both drafts are kept, the first exactly as it was", async () => {
    const kv = memoryKV();
    await applyMe(kv, { g1: "asha" });
    await addDraft(kv, draft("off-back-0000000000000001", { name: "Taxi", amount: "1200" }));
    await addDraft(kv, draft("off-back-0000000000000001", { name: "Lunch", amount: "900", typedAt: 2_000 }));
    const all = await draftsFor(kv);
    expect(all.length).toBe(2); // two expenses typed, two drafts
    const first = all.find((d) => d.key === "off-back-0000000000000001")!;
    expect([first.name, first.amount]).toEqual(["Taxi", "1200"]);
    const second = all.find((d) => d.key !== first.key)!;
    expect([second.name, second.amount]).toEqual(["Lunch", "900"]);
    expect(second.key).toMatch(/^off-/); // still an offline key (the server keeps these 400 days)
  });
  it("the very same contents again (a double tap) is still one draft", async () => {
    const kv = memoryKV();
    await applyMe(kv, { g1: "asha" });
    await addDraft(kv, draft("off-back-0000000000000002"));
    expect(await addDraft(kv, draft("off-back-0000000000000002", { typedAt: 1_500 }))).toEqual({ ok: true });
    expect((await draftsFor(kv)).length).toBe(1);
  });
  it("the offline form takes a new key after each save and when the browser brings the screen back (pageshow, persisted)", () => {
    const f = src("src/components/AddExpenseForm.tsx");
    expect(f).toContain('addEventListener("pageshow"');
    expect(f).toMatch(/if \(e\.persisted\) offlineKey\.current = null/);
    expect(f).toMatch(/offlineKey\.current = null;[^\n]*\n\s*then\(\)/);
  });
});

describe("2. offline sends and dry runs have their own limits", () => {
  it("online save: 'expense' 300; offline send: 'offline-expense' 300; dry run: 'offline-check' 600; the shared count is only the online one", async () => {
    const { addExpenseChecks } = await import("@/lib/add-expense-checks");
    calls.length = 0;
    await addExpenseChecks({ ip: "9.9.9.9", groupId: "g1", currency: "INR", editing: false });
    await addExpenseChecks({ ip: "9.9.9.9", groupId: "g1", currency: "INR", editing: false, offline: true });
    await addExpenseChecks({ ip: "9.9.9.9", groupId: "g1", currency: "INR", editing: false, offline: true, dryRun: true });
    expect(calls).toEqual([
      { key: "expense:9.9.9.9", max: 300 },
      { key: "offline-expense:9.9.9.9", max: 300 },
      { key: "offline-check:9.9.9.9", max: 600 },
    ]);
  });
  it("the route passes the dry-run flag on", () => {
    expect(src("src/app/api/offline/add/route.ts")).toContain("editing: false, offline: true, dryRun });");
  });
});

describe("3. the offline screen is used only when complete", () => {
  const sw = src("public/sw.js");
  it("the marker is written after the last file, and only a copy that has it is used", () => {
    const save = sw.slice(sw.indexOf("async function saveShell("), sw.indexOf("async function newest"));
    expect(save.indexOf('cache.put("/__meta"')).toBeGreaterThan(save.indexOf("await cache.put(f, r)"));
    const newest = sw.slice(sw.indexOf("async function newest"), sw.indexOf("async function saved"));
    expect(newest).toContain('match("/__meta")');
  });
});

describe("5. past-day foreign saves with an off- key need a typed rate", () => {
  it("anything but manual is refused", () => {
    expect(src("src/app/actions.ts")).toContain('input.rateMode !== "manual" && input.date < todayKey');
  });
});

describe("6. the finished note and drafts of an earlier person", () => {
  it("the me route reads the note only when settling; the settling call asks for it", () => {
    expect(src("src/app/api/offline/me/route.ts")).toContain('left = settling ? await takeLeft() : false;');
    expect(src("src/lib/offline/client.ts")).toContain("/api/offline/me?settle=1");
    expect(src("src/components/offline/OfflineSync.tsx")).toContain("() => fetchMe(true)");
  });
  it("on restore, waiting expenses that belong to nobody signed in now are deleted; the signed-in person's stay", async () => {
    const kv = memoryKV();
    await applyMe(kv, { g1: "asha" });
    await addDraft(kv, draft("off-mine-0000000000000001"));
    await addDraft(kv, draft("off-old-00000000000000001", { memberId: "zed" })); // an earlier person's
    await addDraft(kv, draft("off-other-0000000000000001", { groupId: "g9" })); // a group nobody here is in
    let at: number | null = 0;
    const r = await settleSignOutNote(kv, { read: () => at, clear: () => void (at = null) }, async () => ({ on: true, groups: { g1: "asha" }, account: true, left: false }), 10 * 60_000);
    expect(r).toBe("restored");
    expect((await kv.all<DraftInput>("drafts")).map((d) => d.key)).toEqual(["off-mine-0000000000000001"]);
  });
});

describe("7 and 8. slow storage and the complete-copy check", () => {
  it("Sign out and Delete account wait about 1.5 seconds for the storage check, then ask as usual", () => {
    expect(src("src/components/ConfirmButton.tsx")).toMatch(/Promise\.race\(\[check, new Promise<null>\(\(done\) => setTimeout\(\(\) => done\(null\), 1500\)\)\]\)/);
  });
  it("the end-to-end 'ready' check waits for the marker", () => {
    expect(src("e2e/tests/54-offline-add.spec.ts")).toContain('paths.includes("/__meta") && paths.includes("/offline-app")');
  });
});

describe("1. the same-contents test looks inside nested values too", () => {
  it("same key, only a split amount inside 'exact' differs: that is a different expense, kept as a second draft", async () => {
    const kv = memoryKV();
    await applyMe(kv, { g1: "asha" });
    await addDraft(kv, draft("off-nest-00000000000000001", { exact: { asha: "500" } }));
    await addDraft(kv, draft("off-nest-00000000000000001", { exact: { asha: "700" } }));
    expect((await draftsFor(kv)).length).toBe(2);
  });
});
