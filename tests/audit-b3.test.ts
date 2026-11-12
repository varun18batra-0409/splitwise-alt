import { afterAll, describe, expect, it, vi } from "vitest";

// Fixes from the third round of the Batch B audit (N1 to N6 and the Home stories for groups someone left).
// Every account, email and name here is unique per test (a label plus a stamp), so a test never collides with another one.

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", "x-forwarded-for": `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  RedirectType: { replace: "replace", push: "push" },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
// React's per-request cache isn't running here: call straight through.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/push", async (orig) => ({ ...(await orig<typeof import("@/lib/push")>()), sendPushTo: async () => 0 }));

const { db } = await import("@/lib/db");
const { inviteByEmail, inviteToClaim, cancelInvitation, CANCEL_NOT_ALLOWED, openInvitesFor } = await import("@/lib/invites");
const { acceptInvitation, loadInvitations } = await import("@/lib/invitations");
const { joinExisting, invitedNameRows } = await import("@/lib/join");
const { getMemberships } = await import("@/lib/identity");
const { confirmUsedPending } = await import("@/lib/membership");
const { encodeSession, today } = await import("@/lib/session");
const { runBillsForGroup } = await import("@/lib/home/bills-db");
const { saveExpense } = await import("@/lib/save-expense");
const { undoEvent, removeMembers } = await import("@/lib/undo");
const { chargeLockedText } = await import("@/lib/home/charge-lock");
const { payLinkFor } = await import("@/lib/pay-link");
const { iPaidAction } = await import("@/app/pay-link-actions");
const { finishDailyRun, recordDeferred, dailyState, markDailyStarted } = await import("@/lib/daily-job");
const { stillIn, leaverCut } = await import("@/lib/left-view");
type SaveInput = import("@/lib/save-expense").SaveExpenseInput;

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
const noteKeys: string[] = [];
process.env.MAIL_OUTBOX = "1";
const origin = "https://loopin.test";

async function account(label: string) {
  const a = await db.account.create({ data: { email: `ab3-${label.toLowerCase()}-${stamp}@example.test`, name: label } });
  accountIds.push(a.id);
  return { id: a.id, name: label, email: a.email };
}
async function signedInAs(accountId: string) {
  state.cookie = await encodeSession({ m: {}, a: accountId, v: 0, t: today() });
}
// Asha (first in, so she looks after it), Meera (a plain member) and a plain name "Bob" nobody has claimed.
async function trip(label: string, type = "trip") {
  const asha = await account(`Asha${label}`);
  const meera = await account(`Meera${label}`);
  const g = await db.group.create({
    data: {
      name: `Trip ${label}`, inviteCode: `ab3-${label}-${stamp}`, type,
      members: { create: [{ name: "Asha", accountId: asha.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }, { name: "Meera", accountId: meera.id, claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2) }, { name: "Bob", createdAt: new Date(2026, 0, 3) }] },
    },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  groupIds.push(g.id);
  return { g, asha, meera, ashaId: g.members[0].id, meeraId: g.members[1].id, bobId: g.members[2].id };
}
const rate = async () => ({ ok: true as const, rate: "1", date: "2026-11-05" });
const entry = (groupId: string, name: string, amount: string, payer: string): SaveInput => ({
  groupId, name, category: "bills", amount, currency: "INR", paidById: payer, forMode: "everyone", selected: [], onePersonId: "", splitType: "equal",
  exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", date: "2026-11-05",
});

afterAll(async () => {
  state.cookie = "";
  await db.notifyLog.deleteMany({ where: { key: { in: noteKeys } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
  await db.outbox.deleteMany({ where: { to: { contains: stamp } } });
});

// ---- N1. An invited name can be freed, or re-pointed ----
describe("N1: a name invited by mistake is not locked forever", () => {
  it("typo email, the admin cancels: the name can be taken with 'That's me', the typo's token is refused, balances untouched", async () => {
    const t = await trip("n1a");
    const typo = await account("Typo1a");
    const real = await account("Real1a");
    await inviteByEmail(t.g.id, t.ashaId, typo.email, origin);
    const inv = await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: typo.email } });
    const rowId = inv.memberId;
    // A dinner with the invited name in it, so we can check no balance moves.
    await db.expense.create({ data: { groupId: t.g.id, description: "Dinner n1a", splitType: "equal", amount: 3000, originalAmount: 3000, convertedAmount: 3000, paidById: t.ashaId, createdById: t.ashaId, shares: { create: [{ memberId: t.ashaId, amount: 1000 }, { memberId: t.meeraId, amount: 1000 }, { memberId: rowId, amount: 1000 }] } } });
    expect((await invitedNameRows(t.g.id)).has(rowId)).toBe(true);
    expect((await joinExisting(t.g.inviteCode, real, rowId)).ok).toBe(false); // locked while the invitation is open

    const r = await cancelInvitation(t.g.id, t.ashaId, rowId);
    expect(r).toEqual({ ok: true, cancelled: 1 });
    expect((await db.invite.findUniqueOrThrow({ where: { id: inv.id } })).declinedAt).not.toBeNull();
    expect((await invitedNameRows(t.g.id)).has(rowId)).toBe(false);
    expect(await openInvitesFor(t.g.id, rowId)).toEqual([]);
    expect(await loadInvitations(typo)).toEqual([]); // no card for the typo address any more
    await signedInAs(typo.id);
    expect(await acceptInvitation(typo, inv.token)).toEqual({ ok: false, error: "This invitation is no longer open." });
    expect(await db.member.count({ where: { groupId: t.g.id, accountId: typo.id } })).toBe(0);

    expect(await joinExisting(t.g.inviteCode, real, rowId)).toEqual({ ok: true, memberId: rowId });
    const e = await db.expense.findFirstOrThrow({ where: { groupId: t.g.id, description: "Dinner n1a" }, include: { shares: true } });
    expect(e.shares.map((s) => s.amount).sort()).toEqual([1000, 1000, 1000]);
    expect(e.shares.some((s) => s.memberId === rowId)).toBe(true);
  });

  it("who may cancel: the admin, or the person who sent it; not another member; nothing to cancel is said plainly", async () => {
    const t = await trip("n1b");
    const typo = await account("Typo1b");
    await inviteByEmail(t.g.id, t.meeraId, typo.email, origin); // Meera sends it
    const rowId = (await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: typo.email } })).memberId;
    const third = await db.member.create({ data: { groupId: t.g.id, name: "Third1b", accountId: (await account("Third1b")).id, claimedAt: new Date(), createdAt: new Date(2026, 0, 4) } });
    expect(await cancelInvitation(t.g.id, third.id, rowId)).toEqual({ ok: false, error: CANCEL_NOT_ALLOWED });
    expect((await openInvitesFor(t.g.id, rowId)).length).toBe(1);
    expect(await cancelInvitation(t.g.id, t.meeraId, rowId)).toEqual({ ok: true, cancelled: 1 }); // the person who sent it
    expect((await cancelInvitation(t.g.id, t.ashaId, rowId)).ok).toBe(false); // nothing left to cancel
    // Someone who left can't cancel.
    await inviteByEmail(t.g.id, t.ashaId, typo.email, origin);
    await db.member.update({ where: { id: t.meeraId }, data: { leftAt: new Date() } });
    expect((await cancelInvitation(t.g.id, t.meeraId, rowId)).ok).toBe(false);
  });

  it("inviting another email from the name's row re-points it: the old address is closed, the new one can join", async () => {
    const t = await trip("n1c");
    const typo = await account("Typo1c");
    const right = await account("Right1c");
    const stranger = await account("Stranger1c");
    await inviteByEmail(t.g.id, t.ashaId, typo.email, origin);
    const typoInv = await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: typo.email } });
    const rowId = typoInv.memberId;

    const r = await inviteToClaim(t.g.id, t.ashaId, rowId, right.email, origin);
    expect(r).toEqual({ ok: true, email: right.email });
    const rightInv = await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: right.email } });
    expect(rightInv.memberId).toBe(rowId);
    expect((await db.invite.findUniqueOrThrow({ where: { id: typoInv.id } })).declinedAt).not.toBeNull();
    expect((await openInvitesFor(t.g.id, rowId)).map((i) => i.email)).toEqual([right.email]);

    await signedInAs(typo.id);
    expect(await acceptInvitation(typo, typoInv.token)).toEqual({ ok: false, error: "This invitation is no longer open." });
    expect((await joinExisting(t.g.inviteCode, typo, rowId)).ok).toBe(false);
    expect((await joinExisting(t.g.inviteCode, stranger, rowId)).ok).toBe(false);
    expect(await joinExisting(t.g.inviteCode, right, rowId)).toEqual({ ok: true, memberId: rowId });
    expect((await db.member.findUniqueOrThrow({ where: { id: rowId } })).accountId).toBe(right.id);
  });

  it("'invite to claim' on a plain name ties the invitation to that name (nobody else can take it), and asking again for the same email is fine", async () => {
    const t = await trip("n1d");
    const right = await account("Right1d");
    const other = await account("Other1d");
    expect((await joinExisting(t.g.inviteCode, other, t.bobId)).ok).toBe(true); // before any invitation, a plain name is open to "That's me"
    const t2 = await trip("n1d2");
    expect(await inviteToClaim(t2.g.id, t2.ashaId, t2.bobId, right.email, origin)).toEqual({ ok: true, email: right.email });
    expect((await db.invite.findFirstOrThrow({ where: { groupId: t2.g.id, email: right.email } })).memberId).toBe(t2.bobId);
    expect((await invitedNameRows(t2.g.id)).has(t2.bobId)).toBe(true);
    expect((await joinExisting(t2.g.inviteCode, other, t2.bobId)).ok).toBe(false);
    expect(await inviteToClaim(t2.g.id, t2.ashaId, t2.bobId, right.email, origin)).toEqual({ ok: true, email: right.email });
    expect(await db.invite.count({ where: { groupId: t2.g.id, email: right.email } })).toBe(1);
    expect((await joinExisting(t2.g.inviteCode, right, t2.bobId)).ok).toBe(true);
  });
});

// ---- N2 and N3. Only things a person really did themselves make them "joined" ----
describe("N2/N3: the bill run and a pay link don't make anyone joined", () => {
  async function pendingRow(t: Awaited<ReturnType<typeof trip>>, label: string) {
    const acc = await account(label);
    const row = await db.member.create({ data: { groupId: t.g.id, name: label, accountId: acc.id, claimedAt: new Date(), addedBy: t.ashaId, createdAt: new Date(2026, 0, 5) } });
    return { acc, row };
  }

  it("a pending person made the payer of an automatic bill stays pending after the run", async () => {
    const t = await trip("n2a", "home");
    const { acc, row } = await pendingRow(t, "Payer2a");
    await db.bill.create({ data: { groupId: t.g.id, name: "Rent n2a", category: "bills", nature: "fixed", amount: 3000000, day: 1, startMonth: "2026-10", payer: row.id, tz: "Asia/Kolkata" } });
    const counts = await runBillsForGroup(t.g.id, new Date("2026-10-16T06:00:00Z"));
    expect(counts.added).toBe(1);
    const e = await db.expense.findFirstOrThrow({ where: { groupId: t.g.id, description: "Rent n2a" } });
    expect([e.paidById, e.createdById]).toEqual([row.id, row.id]); // the payer is in the books, as before
    await signedInAs(acc.id);
    expect(await confirmUsedPending(acc.id)).toEqual([]);
    expect(await getMemberships()).toEqual({});
    expect((await db.member.findUniqueOrThrow({ where: { id: row.id } })).seenAt).toBeNull();
  });

  it("a pending person tapping 'I paid' on a reminder link stays pending; the tap is recorded (as a claim Asha confirms)", async () => {
    const t = await trip("n2b");
    const { acc, row } = await pendingRow(t, "Payer2b");
    await db.expense.create({ data: { groupId: t.g.id, description: "Dinner n2b", splitType: "equal", amount: 2000, originalAmount: 2000, convertedAmount: 2000, paidById: t.ashaId, createdById: t.ashaId, shares: { create: [{ memberId: t.ashaId, amount: 1000 }, { memberId: row.id, amount: 1000 }] } } });
    const token = await payLinkFor(t.g.id, row.id, t.ashaId, t.ashaId);
    const f = new FormData();
    f.set("token", token);
    await iPaidAction(f).catch((err: Error) => {
      if (!/^NEXT_REDIRECT/.test(String(err.message))) throw err;
    });
    // Batch C: Asha has joined, so "I paid" is a claim waiting for her "Confirm received", not a payment yet.
    const claim = await db.paymentClaim.findFirstOrThrow({ where: { groupId: t.g.id, fromId: row.id } });
    expect([claim.amount, claim.status]).toEqual([1000, "waiting"]);
    expect(await db.payment.count({ where: { groupId: t.g.id, fromId: row.id } })).toBe(0);
    await signedInAs(acc.id);
    expect(await confirmUsedPending(acc.id)).toEqual([]);
    expect(await getMemberships()).toEqual({});
  });

  it("someone who added an expense or a payment themselves counts as joined; one who only appears in others' entries does not", async () => {
    const t = await trip("n2c");
    const spender = await pendingRow(t, "Spender2c");
    const quiet = await pendingRow(t, "Quiet2c");
    const r = await saveExpense(entry(t.g.id, "Tea n2c", "100", t.ashaId), spender.row.id, rate);
    expect(r.ok).toBe(true);
    await signedInAs(quiet.acc.id);
    expect(await getMemberships()).toEqual({});
    await signedInAs(spender.acc.id);
    expect(await getMemberships()).toEqual({ [t.g.id]: spender.row.id });
    expect((await db.member.findUniqueOrThrow({ where: { id: spender.row.id } })).seenAt).not.toBeNull();
    expect((await db.member.findUniqueOrThrow({ where: { id: quiet.row.id } })).seenAt).toBeNull();
  });

  it("N3: no pending rows means nothing to check; pending rows in one group are not confused with another group's", async () => {
    const t = await trip("n3");
    const u = await trip("n3b");
    const solo = await account("Solo3");
    expect(await confirmUsedPending(solo.id)).toEqual([]); // no rows at all
    expect(await confirmUsedPending(t.asha.id)).toEqual([]); // only a joined row (addedBy empty)
    // Same account pending in two groups; it acted only in the second.
    const a = await db.member.create({ data: { groupId: t.g.id, name: "Two3", accountId: solo.id, claimedAt: new Date(), addedBy: t.ashaId } });
    const b = await db.member.create({ data: { groupId: u.g.id, name: "Two3", accountId: solo.id, claimedAt: new Date(), addedBy: u.ashaId } });
    expect((await saveExpense(entry(u.g.id, "Snack n3", "50", u.ashaId), b.id, rate)).ok).toBe(true);
    expect(await confirmUsedPending(solo.id)).toEqual([b.id]);
    expect((await db.member.findUniqueOrThrow({ where: { id: a.id } })).seenAt).toBeNull();
    expect((await db.member.findUniqueOrThrow({ where: { id: b.id } })).seenAt).not.toBeNull();
    expect(await confirmUsedPending(solo.id)).toEqual([]); // remembered: nothing pending for b any more
  });
});

// ---- N4. Undo then Redo of the add keeps the invitation ----
describe("N4: undo and redo of 'added someone' keep the invitation", () => {
  it("undo: no card and Join is refused (invitation left as it is); redo: the card is back and Join works", async () => {
    const t = await trip("n4");
    const lee = await account("Lee4");
    await inviteByEmail(t.g.id, t.ashaId, lee.email, origin);
    const inv = await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: lee.email } });
    const rowId = inv.memberId;
    const added = await db.groupEvent.findFirstOrThrow({ where: { groupId: t.g.id, kind: "members_added" }, orderBy: { createdAt: "desc" } });
    expect((await loadInvitations(lee)).length).toBe(1);

    const undone = await undoEvent(added.id, t.ashaId);
    expect(undone.ok).toBe(true);
    expect(await db.member.count({ where: { id: rowId } })).toBe(0);
    expect(await loadInvitations(lee)).toEqual([]);
    await signedInAs(lee.id);
    expect(await acceptInvitation(lee, inv.token)).toEqual({ ok: false, error: "This invitation is no longer open." });
    expect((await db.invite.findUniqueOrThrow({ where: { id: inv.id } })).declinedAt).toBeNull();

    // Redo = the undo's own history line, undone again (the same row id comes back).
    const redoEvent = await db.groupEvent.findFirstOrThrow({ where: { groupId: t.g.id, kind: "members_removed" }, orderBy: { createdAt: "desc" } });
    expect((await undoEvent(redoEvent.id, t.ashaId)).ok).toBe(true);
    expect(await db.member.count({ where: { id: rowId } })).toBe(1);
    const cards = await loadInvitations(lee);
    expect(cards.map((c) => c.memberId)).toEqual([rowId]);
    expect(await acceptInvitation(lee, cards[0].key)).toEqual({ ok: true, groupId: t.g.id, memberId: rowId });
    expect((await db.member.findUniqueOrThrow({ where: { id: rowId } })).accountId).toBe(lee.id);
  });

  it("removeMembers is the same path the add's Undo uses (nothing else deletes the invitation)", async () => {
    const t = await trip("n4b");
    const kim = await account("Kim4b");
    await inviteByEmail(t.g.id, t.ashaId, kim.email, origin);
    const inv = await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: kim.email } });
    expect((await removeMembers(t.g.id, t.ashaId, [inv.memberId])).ok).toBe(true);
    expect(await db.invite.count({ where: { id: inv.id } })).toBe(1);
  });
});

// ---- N5. A move-out daily charge counted in a bill can't be undone back ----
describe("N5: undoing an edit of a move-out charge once its month's bill has counted it", () => {
  it("is refused with the bill's name; allowed while the month is still waiting", async () => {
    const t = await trip("n5", "home");
    const ex = await saveExpense(entry(t.g.id, "Milk charge n5", "240", t.ashaId), t.ashaId, rate);
    if (!ex.ok) throw new Error(ex.error);
    const edit = await saveExpense({ ...entry(t.g.id, "Milk charge n5", "300", t.ashaId), expenseId: ex.id }, t.ashaId, rate);
    if (!edit.ok) throw new Error(edit.error);
    const bill = await db.bill.create({ data: { groupId: t.g.id, name: "Milk n5", category: "bills", nature: "daily", amount: 6000, day: 1, startMonth: "2026-10", payer: t.ashaId, tz: "Asia/Kolkata", prepaid: JSON.stringify({ "2026-11": [{ m: t.meeraId, a: 30000, e: ex.id }] }) } });
    const run = await db.billRun.create({ data: { billId: bill.id, period: "2026-11", status: "added", expenseId: "x" } });
    expect(edit.eventId).toBeTruthy();
    expect(await undoEvent(edit.eventId!, t.ashaId)).toEqual({ ok: false, error: chargeLockedText("Milk n5") });
    expect((await db.expense.findUniqueOrThrow({ where: { id: ex.id } })).amount).toBe(30000); // still the edited amount

    await db.billRun.update({ where: { id: run.id }, data: { status: "waiting" } });
    expect((await undoEvent(edit.eventId!, t.ashaId)).ok).toBe(true);
    expect((await db.expense.findUniqueOrThrow({ where: { id: ex.id } })).amount).toBe(24000);
  });
});

// ---- N6. A failed note-taking write means the day is not marked finished ----
describe("N6: the morning marks the day finished only when what is left was written down", () => {
  const failing = async () => {
    throw new Error("database busy");
  };
  const day = (n: number) => new Date(`2026-12-${String(n).padStart(2, "0")}T00:30:00Z`);
  const keep = (at: Date) => {
    const d = at.toISOString().slice(0, 10);
    noteKeys.push(`daily-started:${d}`, `daily-finished:${d}`, ...["bills", "reminders", "countdowns"].map((p) => `daily-deferred:${d}:${p}`));
  };

  it("all writes work: finished is written, and the deferred parts are listed", async () => {
    const at = day(3);
    keep(at);
    await markDailyStarted(at);
    expect(await finishDailyRun(at, ["reminders"])).toBe(true);
    expect(await dailyState(at)).toEqual({ started: true, finished: true });
    expect(await db.notifyLog.count({ where: { key: "daily-deferred:2026-12-03:reminders" } })).toBe(1);
    // Run again for the same day (a second call): already written down is fine.
    expect(await finishDailyRun(at, ["reminders"])).toBe(true);
  });

  it("writing the deferred list fails: not finished, so the evening runs every part", async () => {
    const at = day(4);
    keep(at);
    await markDailyStarted(at);
    expect(await recordDeferred(at, ["bills", "reminders"], failing)).toBe(false);
    expect(await finishDailyRun(at, ["bills", "reminders"], failing)).toBe(false);
    expect(await dailyState(at)).toEqual({ started: true, finished: false });
  });

  it("only the finished mark fails: still not finished", async () => {
    const at = day(5);
    keep(at);
    await markDailyStarted(at);
    const onlyFinished = async (key: string, now: Date) => {
      if (key.startsWith("daily-finished:")) throw new Error("database busy");
      await db.notifyLog.create({ data: { key, state: "done", createdAt: now } });
    };
    expect(await finishDailyRun(at, ["countdowns"], onlyFinished)).toBe(false);
    expect(await dailyState(at)).toEqual({ started: true, finished: false });
  });

  it("nothing to write down and the finished mark works: finished", async () => {
    const at = day(6);
    keep(at);
    await markDailyStarted(at);
    expect(await finishDailyRun(at, [])).toBe(true);
    expect(await dailyState(at)).toEqual({ started: true, finished: true });
  });
});

// ---- Home stories for groups the viewer left ----
describe("Home: stories about how a group is now skip groups the viewer left", () => {
  it("stillIn keeps only groups with no leaver cut, in order", () => {
    const left = leaverCut({ leftAt: new Date("2026-11-01T00:00:00Z"), removedAt: null });
    const removed = leaverCut({ leftAt: new Date("2026-11-01T00:00:00Z"), removedAt: new Date("2026-11-01T00:00:00Z") });
    const groups = [
      { id: "in-1", leaver: null },
      { id: "left", leaver: left },
      { id: "in-2", leaver: null },
      { id: "removed", leaver: removed },
      { id: "no-field" },
    ];
    expect(stillIn(groups).map((g) => g.id)).toEqual(["in-1", "in-2", "no-field"]);
    expect(stillIn([])).toEqual([]);
  });
});
