import { afterAll, describe, expect, it, vi } from "vitest";

// Fixes from the fourth round of the Batch B audit (items 1 to 6, plus the weaker tests from round 3).
// Every account, email and name here is unique per test (a label plus a stamp), so a test never collides with another one.

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test" }),
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
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/push", async (orig) => ({ ...(await orig<typeof import("@/lib/push")>()), sendPushTo: async () => 0 }));

const { db } = await import("@/lib/db");
const { inviteByEmail, inviteToClaim, cancelInvitation, CANCEL_NOT_ALLOWED, openInvitesFor, alreadyInvitedAs, INVITE_EMAILS_PER_DAY } = await import("@/lib/invites");
const { invitedNameRows, joinExisting } = await import("@/lib/join");
const { confirmUsedPending } = await import("@/lib/membership");
const { saveExpense } = await import("@/lib/save-expense");
const { undoEvent } = await import("@/lib/undo");
const { chargeLockedText } = await import("@/lib/home/charge-lock");
const { stillIn } = await import("@/lib/left-view");
type SaveInput = import("@/lib/save-expense").SaveExpenseInput;

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
const limitKeys: string[] = [];
process.env.MAIL_OUTBOX = "1";
const origin = "https://loopin.test";

async function account(label: string) {
  const a = await db.account.create({ data: { email: `ab4-${label.toLowerCase()}-${stamp}@example.test`, name: label } });
  accountIds.push(a.id);
  return { id: a.id, name: label, email: a.email };
}
// Asha (first in, so she looks after it), Meera and Third (plain members) and a plain name "Bob" nobody has claimed.
async function trip(label: string, type = "trip") {
  const asha = await account(`Asha${label}`);
  const meera = await account(`Meera${label}`);
  const third = await account(`Third${label}`);
  const g = await db.group.create({
    data: {
      name: `Trip ${label}`, inviteCode: `ab4-${label}-${stamp}`, type,
      members: {
        create: [
          { name: "Asha", accountId: asha.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) },
          { name: "Meera", accountId: meera.id, claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2) },
          { name: "Third", accountId: third.id, claimedAt: new Date(2026, 0, 3), createdAt: new Date(2026, 0, 3) },
          { name: "Bob", createdAt: new Date(2026, 0, 4) },
        ],
      },
    },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  groupIds.push(g.id);
  return { g, asha, meera, third, ashaId: g.members[0].id, meeraId: g.members[1].id, thirdId: g.members[2].id, bobId: g.members[3].id };
}
type Trip = Awaited<ReturnType<typeof trip>>;
const rate = async () => ({ ok: true as const, rate: "1", date: "2026-11-05" });
const entry = (groupId: string, name: string, amount: string, payer: string): SaveInput => ({
  groupId, name, category: "bills", amount, currency: "INR", paidById: payer, forMode: "everyone", selected: [], onePersonId: "", splitType: "equal",
  exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", date: "2026-11-05",
});
// An open invitation written straight into the database, for a name, sent by a member.
const openInvite = (t: Trip, email: string, memberId: string, invitedById: string) =>
  db.invite.create({ data: { groupId: t.g.id, email, invitedById, memberId, token: `tok-${memberId}-${email}` } });

afterAll(async () => {
  await db.rateLimit.deleteMany({ where: { key: { in: limitKeys } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
  await db.outbox.deleteMany({ where: { to: { contains: stamp } } });
});

// ---- 1. A name that is already invited can only be re-pointed by the admin or the person who sent it ----
describe("1: re-pointing an invited name", () => {
  it("a member who neither looks after the group nor sent it is refused; the name stays locked to the original address", async () => {
    const t = await trip("i1a");
    const typo = await account("Typo1a");
    const mine = await account("Mine1a");
    await inviteByEmail(t.g.id, t.meeraId, typo.email, origin); // Meera sends it
    const inv = await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: typo.email } });
    const rowId = inv.memberId;

    const r = await inviteToClaim(t.g.id, t.thirdId, rowId, mine.email, origin); // Third points it at their own friend's address
    expect(r.ok).toBe(false);
    expect((await openInvitesFor(t.g.id, rowId)).map((i) => i.email)).toEqual([typo.email]);
    expect(await db.invite.count({ where: { groupId: t.g.id, email: mine.email } })).toBe(0);
    expect((await invitedNameRows(t.g.id)).has(rowId)).toBe(true);
    expect((await joinExisting(t.g.inviteCode, mine, rowId)).ok).toBe(false); // still locked
  });

  it("the person who sent it can re-point it, and so can the admin", async () => {
    const t = await trip("i1b");
    const typo = await account("Typo1b");
    const second = await account("Second1b");
    const third = await account("ThirdAddr1b");
    await inviteByEmail(t.g.id, t.meeraId, typo.email, origin);
    const rowId = (await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: typo.email } })).memberId;

    expect(await inviteToClaim(t.g.id, t.meeraId, rowId, second.email, origin)).toEqual({ ok: true, email: second.email }); // the sender
    expect((await openInvitesFor(t.g.id, rowId)).map((i) => i.email)).toEqual([second.email]);
    expect(await inviteToClaim(t.g.id, t.ashaId, rowId, third.email, origin)).toEqual({ ok: true, email: third.email }); // the admin
    expect((await openInvitesFor(t.g.id, rowId)).map((i) => i.email)).toEqual([third.email]);
    expect((await joinExisting(t.g.inviteCode, third, rowId)).ok).toBe(true);
  });

  it("a name with no open invitation can still be invited by any member", async () => {
    const t = await trip("i1c");
    const friend = await account("Friend1c");
    expect(await inviteToClaim(t.g.id, t.thirdId, t.bobId, friend.email, origin)).toEqual({ ok: true, email: friend.email });
    expect((await openInvitesFor(t.g.id, t.bobId)).map((i) => i.email)).toEqual([friend.email]);
  });
});

// ---- 2. Things a person only does themselves make them joined ----
describe("2: 'We settled outside the app' and finishing a game count as joined", () => {
  async function pendingRow(t: Trip, label: string) {
    const acc = await account(label);
    const row = await db.member.create({ data: { groupId: t.g.id, name: label, accountId: acc.id, claimedAt: new Date(), addedBy: t.ashaId, createdAt: new Date(2026, 0, 6) } });
    return { acc, row };
  }
  const event = (t: Trip, actorId: string, kind: string, text: string) => db.groupEvent.create({ data: { groupId: t.g.id, actorId, kind, text } });

  it("a pending person whose only action was settling up outside the app, or finishing a game, is joined", async () => {
    const t = await trip("i2a");
    const settler = await pendingRow(t, "Settler2a");
    const player = await pendingRow(t, "Player2a");
    const quiet = await pendingRow(t, "Quiet2a");
    await event(t, settler.row.id, "group_settled_closed", "closed the group (everyone was settled up)");
    await event(t, player.row.id, "pot_finished", "finished Friday cards: Asha won ₹100.00");
    await event(t, quiet.row.id, "member_invited", "invited Bob to join"); // not something that proves anything
    expect(await confirmUsedPending(settler.acc.id)).toEqual([settler.row.id]);
    expect(await confirmUsedPending(player.acc.id)).toEqual([player.row.id]);
    expect(await confirmUsedPending(quiet.acc.id)).toEqual([]);
    expect((await db.member.findUniqueOrThrow({ where: { id: settler.row.id } })).seenAt).not.toBeNull();
    expect((await db.member.findUniqueOrThrow({ where: { id: quiet.row.id } })).seenAt).toBeNull();
  });

  it("lines written in someone's name by the app or a link holder (a bill run's 'now paid by', a pay link's 'took back') still don't count", async () => {
    const t = await trip("i2b");
    const payer = await pendingRow(t, "Payer2b");
    const linker = await pendingRow(t, "Linker2b");
    await event(t, payer.row.id, "expense_edited", "Payer2b now paid Rent");
    await event(t, linker.row.id, "payment_deleted", "took back “paid Asha ₹50.00”");
    await event(t, linker.row.id, "payment_recorded", "paid Asha ₹50.00 (from the reminder link)");
    expect(await confirmUsedPending(payer.acc.id)).toEqual([]);
    expect(await confirmUsedPending(linker.acc.id)).toEqual([]);
  });
});

// ---- 3. The first sender is kept while the invitation is open ----
describe("3: the sender of an open invitation is kept", () => {
  it("asking again keeps the first sender; a new invitation after it was closed has the new sender", async () => {
    const t = await trip("i3");
    const guest = await account("Guest3");
    await inviteByEmail(t.g.id, t.meeraId, guest.email, origin);
    const rowId = (await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: guest.email } })).memberId;
    await inviteByEmail(t.g.id, t.ashaId, guest.email, origin); // Asha asks again
    expect((await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: guest.email } })).invitedById).toBe(t.meeraId);
    expect(await inviteToClaim(t.g.id, t.ashaId, rowId, guest.email, origin)).toEqual({ ok: true, email: guest.email }); // same email again
    expect((await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: guest.email } })).invitedById).toBe(t.meeraId);

    expect((await cancelInvitation(t.g.id, t.ashaId, rowId)).ok).toBe(true); // closed
    await inviteByEmail(t.g.id, t.ashaId, guest.email, origin); // a new invitation
    const again = await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: guest.email } });
    expect(again.invitedById).toBe(t.ashaId);
    expect(again.declinedAt).toBeNull();
    expect(again.memberId).toBe(rowId);
  });
});

// ---- 4. The daily email limit is checked before anything changes ----
describe("4: over the daily email limit, re-pointing changes nothing", () => {
  it("the old invitation stays open and no new one is made", async () => {
    const t = await trip("i4");
    const typo = await account("Typo4");
    const right = await account("Right4");
    await inviteByEmail(t.g.id, t.ashaId, typo.email, origin);
    const inv = await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: typo.email } });
    const key = `invite-mail:${t.asha.id}`;
    limitKeys.push(key);
    await db.rateLimit.upsert({ where: { key }, create: { key, count: INVITE_EMAILS_PER_DAY, resetAt: new Date(Date.now() + 3_600_000) }, update: { count: INVITE_EMAILS_PER_DAY, resetAt: new Date(Date.now() + 3_600_000) } });

    const r = await inviteToClaim(t.g.id, t.ashaId, inv.memberId, right.email, origin);
    expect(r.ok).toBe(false);
    expect((await db.invite.findUniqueOrThrow({ where: { id: inv.id } })).declinedAt).toBeNull();
    expect(await db.invite.count({ where: { groupId: t.g.id, email: right.email } })).toBe(0);
    expect((await openInvitesFor(t.g.id, inv.memberId)).map((i) => i.email)).toEqual([typo.email]);
  });
});

// ---- 5. One email, one name ----
describe("5: an email already invited as one name can't be moved to another", () => {
  it("inviting it for a second name is refused and the first name stays locked", async () => {
    const t = await trip("i5a");
    const guest = await account("Guest5a");
    await inviteByEmail(t.g.id, t.ashaId, guest.email, origin);
    const inv = await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: guest.email } });
    const nameA = (await db.member.findUniqueOrThrow({ where: { id: inv.memberId } })).name;

    expect(await inviteToClaim(t.g.id, t.ashaId, t.bobId, guest.email, origin)).toEqual({ ok: false, error: alreadyInvitedAs(nameA) });
    expect((await db.invite.findUniqueOrThrow({ where: { id: inv.id } })).memberId).toBe(inv.memberId);
    expect((await invitedNameRows(t.g.id)).has(inv.memberId)).toBe(true);
    expect((await invitedNameRows(t.g.id)).has(t.bobId)).toBe(false);
  });

  it("the same holds when someone who left on their own is invited by an email already waiting on another name", async () => {
    const t = await trip("i5b");
    const leaver = await account("Leaver5b");
    const row = await db.member.create({ data: { groupId: t.g.id, name: "Leaver", accountId: leaver.id, claimedAt: new Date(), leftAt: new Date(), createdAt: new Date(2026, 0, 7) } });
    const inv = await openInvite(t, leaver.email, t.bobId, t.ashaId);
    const r = await inviteByEmail(t.g.id, t.ashaId, leaver.email, origin);
    expect(r.bad.length).toBe(1);
    expect(r.bad[0]).toContain(alreadyInvitedAs("Bob"));
    expect((await db.invite.findUniqueOrThrow({ where: { id: inv.id } })).memberId).toBe(t.bobId);
    expect((await db.member.findUniqueOrThrow({ where: { id: row.id } })).leftAt).not.toBeNull();
  });
});

// ---- 6. Cancel: who can close what, and what the history says ----
describe("6: cancel reaches only what the person may cancel; history never shows the email", () => {
  it("a sender cancels only their own invitation; the admin cancels all; a member who sent none can't; re-pointing with a stranger's invitation open is refused", async () => {
    const t = await trip("i6a");
    const e1 = await account("Mail6a1");
    const e2 = await account("Mail6a2");
    const e3 = await account("Mail6a3");
    const mine = await openInvite(t, e1.email, t.bobId, t.meeraId);
    const hers = await openInvite(t, e2.email, t.bobId, t.ashaId);

    expect(await cancelInvitation(t.g.id, t.thirdId, t.bobId)).toEqual({ ok: false, error: CANCEL_NOT_ALLOWED });
    // Meera can't re-point while Asha's invitation for the same name is open (she could not cancel it).
    expect((await inviteToClaim(t.g.id, t.meeraId, t.bobId, e3.email, origin)).ok).toBe(false);
    expect(await db.invite.count({ where: { groupId: t.g.id, email: e3.email } })).toBe(0);

    expect(await cancelInvitation(t.g.id, t.meeraId, t.bobId)).toEqual({ ok: true, cancelled: 1 });
    expect((await db.invite.findUniqueOrThrow({ where: { id: mine.id } })).declinedAt).not.toBeNull();
    expect((await db.invite.findUniqueOrThrow({ where: { id: hers.id } })).declinedAt).toBeNull(); // Asha's is untouched
    expect(await cancelInvitation(t.g.id, t.meeraId, t.bobId)).toEqual({ ok: false, error: CANCEL_NOT_ALLOWED }); // only Asha's is left

    await openInvite(t, e3.email, t.bobId, t.meeraId);
    expect(await cancelInvitation(t.g.id, t.ashaId, t.bobId)).toEqual({ ok: true, cancelled: 2 }); // the admin closes everything
    expect(await openInvitesFor(t.g.id, t.bobId)).toEqual([]);
  });

  it("the history line for an invitation names the person, never the email", async () => {
    const t = await trip("i6b");
    const friend = await account("Friend6b");
    expect(await inviteToClaim(t.g.id, t.ashaId, t.bobId, friend.email, origin)).toEqual({ ok: true, email: friend.email });
    const ev = await db.groupEvent.findMany({ where: { groupId: t.g.id, kind: "member_invited" } });
    expect(ev.map((e) => e.text)).toEqual(["invited Bob to join"]);
    expect(ev.some((e) => e.text.includes("@") || e.text.includes(friend.email))).toBe(false);
  });
});

// ---- Round 3 tests that were too weak ----
describe("N5 (in the transaction): the move-out charge lock is checked again right before the change", () => {
  it("a bill run counting the charge after the first look but before the change still stops the undo", async () => {
    const t = await trip("n5", "home");
    const ex = await saveExpense(entry(t.g.id, "Milk charge n5b", "240", t.ashaId), t.ashaId, rate);
    if (!ex.ok) throw new Error(ex.error);
    const edit = await saveExpense({ ...entry(t.g.id, "Milk charge n5b", "300", t.ashaId), expenseId: ex.id }, t.ashaId, rate);
    if (!edit.ok) throw new Error(edit.error);
    const bill = await db.bill.create({ data: { groupId: t.g.id, name: "Milk n5b", category: "bills", nature: "daily", amount: 6000, day: 1, startMonth: "2026-10", payer: t.ashaId, tz: "Asia/Kolkata", prepaid: JSON.stringify({ "2026-11": [{ m: t.meeraId, a: 30000, e: ex.id }] }) } });
    await db.billRun.create({ data: { billId: bill.id, period: "2026-11", status: "waiting" } });

    // The undo's first look sees the month still waiting. Just before its transaction starts, the bill run counts the charge.
    // (No hook in the app: this wraps the database client's own $transaction for that one call.)
    const real = db.$transaction.bind(db) as (...a: unknown[]) => Promise<unknown>;
    const spy = vi.spyOn(db, "$transaction").mockImplementationOnce((async (...a: unknown[]) => {
      await db.billRun.update({ where: { billId_period: { billId: bill.id, period: "2026-11" } }, data: { status: "added" } });
      return real(...a);
    }) as never);
    try {
      expect(await undoEvent(edit.eventId!, t.ashaId)).toEqual({ ok: false, error: chargeLockedText("Milk n5b") });
    } finally {
      spy.mockRestore();
    }
    expect((await db.expense.findUniqueOrThrow({ where: { id: ex.id } })).amount).toBe(30000); // still the edited amount
  });
});

describe("Home stories: a group row with the field present but empty", () => {
  it("stillIn treats leaver: undefined like a missing field (still in the group)", () => {
    const groups: { id: string; leaver?: unknown }[] = [{ id: "undef", leaver: undefined }, { id: "missing" }, { id: "null", leaver: null }, { id: "left", leaver: { cut: true } }];
    expect(stillIn(groups).map((g) => g.id)).toEqual(["undef", "missing", "null"]);
  });
});
