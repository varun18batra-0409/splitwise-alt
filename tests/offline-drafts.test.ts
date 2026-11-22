import { describe, expect, it } from "vitest";
import { addDraft, allDraftsCount, applyMe, checkWaiting, draftsFor, memoryLock, readMe, removeConfirmed, removeDraft, saveSnapshot, sendWaiting, snapshotFor, visibleSnapshots, wipeAll, type Post } from "@/lib/offline/store";
import { memoryKV } from "@/lib/offline/memory-kv";
import { MAX_DRAFTS } from "@/lib/offline/words";
import type { AddAnswer, DraftInput } from "@/lib/offline/types";
import type { Snapshot } from "@/lib/offline/snapshot-types";

// The phone's side, tested with an in-memory store (no browser, no new package). Nothing here works out money.

const draft = (key: string, over: Partial<DraftInput> = {}): DraftInput => ({
  key, groupId: "g1", memberId: "asha", day: "2026-11-17", typedAt: 1_000, name: "Taxi", amount: "1200", currency: "INR", category: "",
  paidById: "asha", multiPay: false, payers: {}, forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {},
  shares: {}, kind: "expense", paymentMethod: "cash", markupChoice: "group", markupCustom: "", notes: "", rateMode: "auto", manualRate: "",
  seen: { baseCurrency: "INR", cardMarkupBp: 0, activeMemberIds: ["asha", "ben"], snapshotAt: "2026-11-17T08:00:00.000Z" },
  ...over,
});
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  memberId: "asha", groupId: "g1", name: "Goa trip", type: "trip", currency: "INR", cardMarkupBp: 0, splitName: "Group split", tz: "Asia/Kolkata",
  peopleCount: 2, dayLine: "", members: [{ id: "asha", name: "Asha", splitWeight: 100 }, { id: "ben", name: "Ben", splitWeight: 100 }],
  balance: { paise: 0, text: "All square", eq: "", tone: "square", label: "Your balance", summary: "", canSettle: false }, rows: [], savedAt: "2026-11-17T08:00:00.000Z", ...over,
});
const added = (id = "e1"): AddAnswer => ({ status: "added", id });
const NOW = Date.parse("2026-11-18T10:00:00.000Z");

async function signedInAsAsha() {
  const kv = memoryKV();
  await applyMe(kv, { g1: "asha" });
  return kv;
}

describe("what a draft keeps", () => {
  it("only what was typed, plus ids and what the phone had seen: no shares worked out, no totals, no converted amount", async () => {
    const kv = await signedInAsAsha();
    expect(await addDraft(kv, draft("off-a-0000000000000001"))).toEqual({ ok: true });
    const [d] = await draftsFor(kv);
    expect(Object.keys(d).sort()).toEqual(
      [
        "amount", "category", "currency", "day", "exact", "forMode", "groupId", "key", "kind", "manualRate", "markupChoice", "markupCustom", "memberId", "multiPay", "name",
        "notes", "onePersonId", "paidById", "payers", "paymentMethod", "percent", "rateMode", "seen", "selected", "shares", "splitType", "status", "typedAt",
      ].sort(),
    );
    expect(d.amount).toBe("1200"); // the text as typed, never a number of paise
    expect(d.status).toBe("waiting");
  });
  it("is written and read back before it counts; if storage fails nothing is kept and it says so", async () => {
    const kv = memoryKV({ failPuts: true });
    expect(await addDraft(kv, draft("off-a-0000000000000002"))).toEqual({ ok: false, reason: "storage" });
    expect(await allDraftsCount(kv)).toBe(0);
  });
  it("at most 50 per phone: the 51st is refused and the other 50 are untouched", async () => {
    const kv = await signedInAsAsha();
    for (let i = 0; i < MAX_DRAFTS; i++) expect((await addDraft(kv, draft(`off-b-${String(i).padStart(16, "0")}`, { typedAt: i }))).ok).toBe(true);
    expect(await addDraft(kv, draft("off-b-over000000000000"))).toEqual({ ok: false, reason: "full" });
    expect(await allDraftsCount(kv)).toBe(50);
  });
});

describe("who can see it", () => {
  it("is hidden when the phone's last-known person in that group is someone else, and kept for them to come back to", async () => {
    const kv = await signedInAsAsha();
    await addDraft(kv, draft("off-c-0000000000000001"));
    await saveSnapshot(kv, snap());
    expect((await draftsFor(kv)).length).toBe(1);
    // The phone changes hands: Ben signs in and the app is opened online.
    await applyMe(kv, { g1: "ben" });
    expect(await draftsFor(kv)).toEqual([]);
    expect(await snapshotFor(kv, "g1", NOW)).toBeUndefined(); // Asha's copy is dropped, not shown to Ben
    expect(await visibleSnapshots(kv, NOW)).toEqual([]);
    expect(await allDraftsCount(kv)).toBe(1); // her draft is still on the phone, hidden
    // Asha signs back in: it is there again.
    await applyMe(kv, { g1: "asha" });
    expect((await draftsFor(kv)).map((d) => d.key)).toEqual(["off-c-0000000000000001"]);
  });
  it("a sign-in that ended by itself (nobody signed in) shows nothing, and drafts wait", async () => {
    const kv = await signedInAsAsha();
    await addDraft(kv, draft("off-c-0000000000000002"));
    await applyMe(kv, {});
    expect(await draftsFor(kv)).toEqual([]);
    expect(await allDraftsCount(kv)).toBe(1);
  });
  it("a group's copy stops showing 30 days after it was saved", async () => {
    const kv = await signedInAsAsha();
    await saveSnapshot(kv, snap({ savedAt: "2026-11-17T08:00:00.000Z" }));
    expect(await snapshotFor(kv, "g1", Date.parse("2026-12-17T08:00:00.000Z"))).toBeDefined(); // day 30
    expect(await snapshotFor(kv, "g1", Date.parse("2026-12-17T08:00:01.000Z"))).toBeUndefined(); // just past day 30
  });
  it("sign-out wipes everything", async () => {
    const kv = await signedInAsAsha();
    await addDraft(kv, draft("off-c-0000000000000003"));
    await saveSnapshot(kv, snap());
    await wipeAll(kv);
    expect(kv.dump()).toEqual({ snapshots: [], drafts: [], meta: [] });
    expect(await readMe(kv)).toEqual({});
  });
});

describe("when a draft goes", () => {
  it("only when the server confirms it (or the person removes it): no signal, busy and not-signed-in keep it", async () => {
    const kv = await signedInAsAsha();
    await addDraft(kv, draft("off-d-0000000000000001", { typedAt: 1 }));
    await addDraft(kv, draft("off-d-0000000000000002", { typedAt: 2 }));
    const lock = memoryLock();
    const offline: Post = async () => { throw new Error("no signal"); };
    expect(await sendWaiting(kv, offline, { lock })).toEqual({ added: 0, stopped: true });
    const busy: Post = async () => ({ status: "later", reason: "busy" });
    expect(await sendWaiting(kv, busy, { lock })).toEqual({ added: 0, stopped: true });
    expect(await allDraftsCount(kv)).toBe(2);
    // The first is added, the second gets no signal: only the first goes.
    let calls = 0;
    const half: Post = async () => { if (calls++ === 0) return added("e1"); throw new Error("no signal"); };
    expect(await sendWaiting(kv, half, { lock })).toEqual({ added: 1, stopped: true });
    expect((await draftsFor(kv)).map((d) => d.key)).toEqual(["off-d-0000000000000002"]);
    await removeDraft(kv, "off-d-0000000000000002"); // the person's own tap
    expect(await allDraftsCount(kv)).toBe(0);
  });
  it("a refusal keeps it with the reason; a duplicate keeps it with the match; both stay for the person to decide", async () => {
    const kv = await signedInAsAsha();
    await addDraft(kv, draft("off-d-0000000000000003", { typedAt: 1 }));
    await addDraft(kv, draft("off-d-0000000000000004", { typedAt: 2 }));
    const post: Post = async (d) =>
      d.key.endsWith("3")
        ? { status: "refused", code: "people-joined", reason: "Someone joined the group since you saved this. Open it and check the split." }
        : { status: "duplicate", dup: { id: "e9", description: "Breakfast", amount: 90000, by: "Asha", when: "2026-11-18T12:00:00.000Z", addedAt: "2026-11-18T03:10:00.000Z", byId: "asha" } };
    expect(await sendWaiting(kv, post, { lock: memoryLock() })).toEqual({ added: 0, stopped: false });
    const [a, b] = await draftsFor(kv);
    expect(a.status).toBe("refused");
    expect(a.code).toBe("people-joined");
    expect(b.status).toBe("duplicate");
    expect(b.dup?.description).toBe("Breakfast");
  });
  it("the server's answer for a used key (a dry run says 'already added') removes it", async () => {
    const kv = await signedInAsAsha();
    await addDraft(kv, draft("off-d-0000000000000005"));
    const dry: Post = async (_d, o) => (o.dryRun ? added("e5") : { status: "later", reason: "?" });
    expect(await checkWaiting(kv, dry, { lock: memoryLock() })).toEqual({ added: 1, stopped: false });
    expect(await allDraftsCount(kv)).toBe(0);
  });
  it("a dry run changes nothing when the server says ok; 'Different, keep both' is sent with allowDuplicate", async () => {
    const kv = await signedInAsAsha();
    await addDraft(kv, draft("off-d-0000000000000006"));
    const seen: { dryRun?: boolean; allowDuplicate?: boolean }[] = [];
    const post: Post = async (_d, o) => { seen.push(o); return o.dryRun ? { status: "ok" } : added("e6"); };
    await checkWaiting(kv, post, { lock: memoryLock() });
    expect((await draftsFor(kv))[0].status).toBe("waiting");
    const { patchDraft } = await import("@/lib/offline/store");
    await patchDraft(kv, "off-d-0000000000000006", { status: "duplicate", keepBoth: true });
    await sendWaiting(kv, post, { lock: memoryLock() });
    expect(seen).toEqual([{ dryRun: true, allowDuplicate: false }, { dryRun: false, allowDuplicate: true }]);
    expect(await allDraftsCount(kv)).toBe(0);
  });
  it("the server's 'done' list (status check) removes exactly those", async () => {
    const kv = await signedInAsAsha();
    await addDraft(kv, draft("off-d-0000000000000007"));
    await addDraft(kv, draft("off-d-0000000000000008"));
    await removeConfirmed(kv, { "off-d-0000000000000007": "e7" });
    expect((await draftsFor(kv)).map((d) => d.key)).toEqual(["off-d-0000000000000008"]);
  });
  it("a second sender on the phone waits its turn: each draft is posted once", async () => {
    const kv = await signedInAsAsha();
    for (let i = 1; i <= 3; i++) await addDraft(kv, draft(`off-e-000000000000000${i}`, { typedAt: i }));
    const lock = memoryLock();
    const posted: string[] = [];
    const slow: Post = async (d) => {
      posted.push(d.key);
      await new Promise((r) => setTimeout(r, 5));
      return added();
    };
    const [x, y] = await Promise.all([sendWaiting(kv, slow, { lock }), sendWaiting(kv, slow, { lock })]);
    expect(posted).toEqual(["off-e-0000000000000001", "off-e-0000000000000002", "off-e-0000000000000003"]); // oldest first, once each
    expect(x.added + y.added).toBe(3);
    expect(await allDraftsCount(kv)).toBe(0);
  });
});
