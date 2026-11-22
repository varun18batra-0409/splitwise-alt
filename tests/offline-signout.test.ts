import { describe, expect, it } from "vitest";
import { W } from "@/lib/offline/words";
import { addDraft, applyMe, draftsFor, saveSnapshot, snapshotFor } from "@/lib/offline/store";
import { memoryKV } from "@/lib/offline/memory-kv";
import { settleSignOutNote, type MeAnswer } from "@/lib/offline/signout";
import type { DraftInput } from "@/lib/offline/types";
import type { Snapshot } from "@/lib/offline/snapshot-types";

// Sign out and Delete account leave a note; the next page decides what happens to what the phone kept. In memory, no browser needed.
const draft = (key: string): DraftInput => ({
  key, groupId: "g1", memberId: "asha", day: "2026-11-17", typedAt: 1_000, name: "Taxi", amount: "1200", currency: "INR", category: "",
  paidById: "asha", multiPay: false, payers: {}, forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {},
  shares: {}, kind: "expense", paymentMethod: "cash", markupChoice: "group", markupCustom: "", notes: "", rateMode: "auto", manualRate: "",
  seen: { baseCurrency: "INR", cardMarkupBp: 0, activeMemberIds: ["asha", "ben"], snapshotAt: "2026-11-17T08:00:00.000Z" },
});
const snap = (): Snapshot => ({
  memberId: "asha", groupId: "g1", name: "Goa trip", type: "trip", currency: "INR", cardMarkupBp: 0, splitName: "Group split", tz: "Asia/Kolkata",
  peopleCount: 2, dayLine: "", members: [{ id: "asha", name: "Asha", splitWeight: 100 }, { id: "ben", name: "Ben", splitWeight: 100 }],
  balance: { paise: 0, text: "All square", eq: "", tone: "square", label: "Your balance", summary: "", canSettle: false }, rows: [], savedAt: new Date().toISOString(),
});
async function phone() {
  const kv = memoryKV();
  await saveSnapshot(kv, snap());
  await addDraft(kv, draft("off-signout-0000000000000001"));
  return kv;
}
const note = (at: number | null) => {
  let value = at;
  return { read: () => value, clear: () => void (value = null), get left() { return value; } };
};
const count = async (kv: ReturnType<typeof memoryKV>) => ({ snapshots: (await kv.all("snapshots")).length, drafts: (await kv.all("drafts")).length });

describe("the note left by Sign out / Delete account", () => {
  it("no note: nothing happens (copies and the waiting expense are as they were, and still shown)", async () => {
    const kv = await phone();
    const n = note(null);
    expect(await settleSignOutNote(kv, n, async () => { throw new Error("must not ask"); })).toBe("none");
    expect(await count(kv)).toEqual({ snapshots: 1, drafts: 1 });
    expect((await draftsFor(kv)).length).toBe(1);
  });

  it("the server cannot be reached: everything stays HIDDEN (waiting expense kept but not shown, copy gone), the note stays, even if it is very old", async () => {
    const kv = await phone();
    const n = note(1); // a note from 1970: it never expires by time
    expect(await settleSignOutNote(kv, n, async () => null)).toBe("hidden");
    expect((await draftsFor(kv)).length).toBe(0); // hidden
    expect(await snapshotFor(kv, "g1")).toBeUndefined();
    expect(await count(kv)).toEqual({ snapshots: 0, drafts: 1 }); // the waiting expense is not lost
    expect(n.left).toBe(1);
  });

  it("confirmed: no account on the phone any more -> everything is wiped (0 copies, 0 waiting expenses, nothing who-am-I), the note is cleared", async () => {
    const kv = await phone();
    const n = note(Date.now());
    const me: MeAnswer = { on: true, groups: { g1: "asha" }, account: false, left: false }; // after Delete account the guest names can remain; the account is gone
    expect(await settleSignOutNote(kv, n, async () => me)).toBe("wiped");
    expect(await count(kv)).toEqual({ snapshots: 0, drafts: 0 });
    expect((await kv.all("meta")).length).toBe(0);
    expect(n.left).toBeNull();
  });

  const NOW = Date.parse("2026-11-22T10:00:00.000Z");
  const still: MeAnswer = { on: true, groups: { g1: "asha" }, account: true, left: false };

  it("THE RACE: an answer that says 'account' but arrives right after the tap (the sign-out has not finished) never restores anything: still hidden, the note stays", async () => {
    const kv = await phone();
    const n = note(NOW - 5_000); // the button was tapped 5 seconds ago
    expect(await settleSignOutNote(kv, n, async () => still, NOW)).toBe("hidden");
    expect((await draftsFor(kv)).length).toBe(0); // not shown to whoever is next
    expect(await count(kv)).toEqual({ snapshots: 0, drafts: 1 });
    expect(n.left).toBe(NOW - 5_000);
    // ... the sign-out then finishes: the next answer carries the 'finished' note, and everything is wiped, even though an account answer arrived first.
    expect(await settleSignOutNote(kv, n, async () => ({ ...still, left: true }), NOW + 3_000)).toBe("wiped");
    expect(await count(kv)).toEqual({ snapshots: 0, drafts: 0 });
    expect(n.left).toBeNull();
  });

  it("the finished note wins even if another account is signed in by then (the old person's things go)", async () => {
    const kv = await phone();
    expect(await settleSignOutNote(kv, note(NOW - 60_000), async () => ({ on: true, groups: { g9: "zed" }, account: true, left: true }), NOW)).toBe("wiped");
    expect(await count(kv)).toEqual({ snapshots: 0, drafts: 0 });
  });

  it("the sign-out did not happen (still an account, no finished note, 3 minutes on): nothing is wiped, the waiting expense shows again, the copy is re-saved on the next online open", async () => {
    const kv = await phone();
    const n = note(NOW - 3 * 60_000);
    expect(await settleSignOutNote(kv, n, async () => still, NOW)).toBe("restored");
    expect((await draftsFor(kv)).length).toBe(1); // shown again
    expect(await count(kv)).toEqual({ snapshots: 0, drafts: 1 }); // the copy was dropped, never lost money: it is saved again when the group is opened
    expect(n.left).toBeNull();
  });

  it("while it is being settled, a different person's phone never shows the old person's things: asked first, hidden first", async () => {
    const kv = await phone();
    let shownWhileAsking = -1;
    await settleSignOutNote(kv, note(Date.now()), async () => {
      shownWhileAsking = (await draftsFor(kv)).length + (await snapshotFor(kv, "g1") ? 1 : 0);
      return { on: true, groups: {}, account: false, left: false };
    });
    expect(shownWhileAsking).toBe(0);
    await applyMe(kv, {}); // (harmless afterwards)
  });
});

describe("the words for waiting expenses", () => {
  it("sign-out and Delete account each have their own, singular and plural", () => {
    expect(W.signOutWarn(1)).toBe("1 expense is waiting on this phone and hasn’t been added. Signing out removes it from this phone.");
    expect(W.signOutWarn(3)).toBe("3 expenses are waiting on this phone and haven’t been added. Signing out removes them from this phone.");
    expect(W.deleteWarn(1)).toBe("1 expense waiting on this phone hasn’t been added. Deleting your account removes it from this phone.");
    expect(W.deleteWarn(2)).toBe("2 expenses waiting on this phone haven’t been added. Deleting your account removes them from this phone.");
  });
});
