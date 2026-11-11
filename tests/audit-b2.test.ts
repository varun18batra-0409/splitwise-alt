import { afterAll, describe, expect, it, vi } from "vitest";

// Fixes from the second independent audit of Batch B. Every account, email and name here is unique per test
// (a label plus a stamp), so a test never collides with another one.

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
}));
// React's per-request cache isn't running here: call straight through.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { inviteByEmail } = await import("@/lib/invites");
const { acceptInvitation, declineInvitation, loadInvitations } = await import("@/lib/invitations");
const { joinExisting, joinNew, invitedNameRows } = await import("@/lib/join");
const { getMemberships } = await import("@/lib/identity");
const { encodeSession, today } = await import("@/lib/session");
const { netBalances } = await import("@/lib/balances");
const { saveExpense, setExpenseDeleted } = await import("@/lib/save-expense");
const { syncChargePayer } = await import("@/lib/home/bills-db");
const { addGoalEntryFor, tapKey } = await import("@/lib/home/goals-db");
const { replaceGroupPhoto } = await import("@/lib/photo-store");
const { membersAsOf, gameVisible, createdByCut, leaverCut } = await import("@/lib/left-view");
const { groupCsv, involvedIds } = await import("@/lib/csv");
type SaveInput = import("@/lib/save-expense").SaveExpenseInput;

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
process.env.MAIL_OUTBOX = "1";
const origin = "https://loopin.test";

async function account(label: string) {
  const a = await db.account.create({ data: { email: `ab2-${label.toLowerCase()}-${stamp}@example.test`, name: label } });
  accountIds.push(a.id);
  return { id: a.id, name: label, email: a.email };
}
async function signedInAs(accountId: string) {
  state.cookie = await encodeSession({ m: {}, a: accountId, v: 0, t: today() });
}
// Asha (first in, so she looks after it) and Meera, both on Loopin. `label` makes every name and code unique.
async function trip(label: string) {
  const asha = await account(`Asha${label}`);
  const meera = await account(`Meera${label}`);
  const g = await db.group.create({
    data: {
      name: `Trip ${label}`, inviteCode: `ab2-${label}-${stamp}`, type: "trip",
      members: { create: [{ name: "Asha", accountId: asha.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }, { name: "Meera", accountId: meera.id, claimedAt: new Date() }] },
    },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  groupIds.push(g.id);
  return { g, asha, meera, ashaId: g.members[0].id, meeraId: g.members[1].id };
}
async function groupBalances(groupId: string) {
  const g = await db.group.findUniqueOrThrow({ where: { id: groupId }, include: { members: true, expenses: { include: { shares: true } }, payments: true } });
  return netBalances(g.members.map((m) => m.id), g.expenses.filter((e) => !e.deletedAt), g.payments.filter((p) => !p.deletedAt));
}

afterAll(async () => {
  state.cookie = "";
  await db.blobTrash.deleteMany({ where: { key: { contains: stamp } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
  await db.outbox.deleteMany({ where: { to: { contains: stamp } } });
});

// ---- 2. A name made for an email invitation can't be taken with "That's me" ----
describe("audit 2: an invited name belongs to the invitation", () => {
  it("a stranger with the group link can't take it; the invited email can; a plain name can still be taken", async () => {
    const t = await trip("i2");
    const uma = await account("Uma2");
    const stranger = await account("Stranger2");
    await inviteByEmail(t.g.id, t.ashaId, uma.email, origin);
    const row = await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: uma.email } });
    expect(row.memberId).not.toBe("");
    expect((await invitedNameRows(t.g.id)).has(row.memberId)).toBe(true); // hidden from the join page's list

    expect(await joinExisting(t.g.inviteCode, stranger, row.memberId)).toEqual({ ok: false, reason: "claimed" });
    expect((await db.member.findUniqueOrThrow({ where: { id: row.memberId } })).accountId).toBeNull();

    const ok = await joinExisting(t.g.inviteCode, uma, row.memberId);
    expect(ok).toEqual({ ok: true, memberId: row.memberId });
    expect((await db.member.findUniqueOrThrow({ where: { id: row.memberId } })).accountId).toBe(uma.id);

    // A name added by hand (no invitation) is still there for "That's me".
    const plain = await db.member.create({ data: { groupId: t.g.id, name: "Plain2" } });
    expect((await invitedNameRows(t.g.id)).has(plain.id)).toBe(false);
    expect((await joinExisting(t.g.inviteCode, stranger, plain.id)).ok).toBe(true);
  });

  it("after Not now the invitation is no longer open, so the name can be taken from the link again", async () => {
    const t = await trip("i2b");
    const kai = await account("Kai2b");
    const other = await account("Other2b");
    await inviteByEmail(t.g.id, t.ashaId, kai.email, origin);
    const rowId = (await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: kai.email } })).memberId;
    await signedInAs(kai.id);
    await declineInvitation(kai, (await loadInvitations(kai))[0].key);
    expect((await joinExisting(t.g.inviteCode, other, rowId)).ok).toBe(true);
  });
});

// ---- 4. One reply for every email ----
describe("audit 4: no Undo bar for an email invite", () => {
  it("the reply has the same shape for a registered, unknown, existing and own email: nothing to undo", async () => {
    const t = await trip("i4");
    const reg = await account("Reg4");
    const cases = [reg.email, `nobody-i4-${stamp}@example.test`, t.meera.email, t.asha.email];
    for (const email of cases) {
      const r = await inviteByEmail(t.g.id, t.ashaId, email, origin);
      expect(Object.keys(r).sort(), email).toEqual(["bad", "people"]);
      expect(r.bad, email).toEqual([]);
      expect(r.people.length, email).toBe(1);
      expect(r.people[0].email, email).toBe(email);
      expect("eventIds" in r, email).toBe(false);
    }
  });
});

// ---- 5. Legacy "Not now" on a removed person ----
describe("audit 5: a removed person can't unlink themselves with Not now", () => {
  it("does nothing for a removed legacy row; works for a normal one", async () => {
    const t = await trip("i5");
    const pat = await account("Pat5");
    const row = await db.member.create({ data: { groupId: t.g.id, name: "Pat", accountId: pat.id, claimedAt: new Date(), addedBy: t.ashaId, leftAt: new Date(), removedAt: new Date(), removedById: t.ashaId } });
    await signedInAs(pat.id);
    const r = await declineInvitation(pat, `m:${row.id}`);
    expect(r.ok).toBe(false);
    expect(await db.member.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ accountId: pat.id, addedBy: t.ashaId }); // still linked, still removed
    // And they can't come back through the link either.
    expect(await joinNew(t.g.inviteCode, pat, "Pat")).toMatchObject({ ok: false, reason: "removed" });
  });
});

// ---- 7. Someone who left on their own, added again by email ----
describe("audit 7: adding by email someone who left on their own", () => {
  it("invites them to their own row; Join brings them back; the reply is the usual one", async () => {
    const t = await trip("i7");
    await db.member.update({ where: { id: t.meeraId }, data: { leftAt: new Date() } });
    const rowsBefore = await db.member.count({ where: { groupId: t.g.id } });
    const r = await inviteByEmail(t.g.id, t.ashaId, t.meera.email, origin);
    expect(Object.keys(r).sort()).toEqual(["bad", "people"]);
    expect(r.people.length).toBe(1);
    expect(await db.member.count({ where: { groupId: t.g.id } })).toBe(rowsBefore); // no second row
    const inv = await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: t.meera.email } });
    expect(inv.memberId).toBe(t.meeraId);
    expect(inv.token.length).toBeGreaterThanOrEqual(20);
    expect((await db.member.findUniqueOrThrow({ where: { id: t.meeraId } })).leftAt).not.toBeNull(); // not back until she taps Join
    expect(await db.outbox.count({ where: { to: t.meera.email, subject: { contains: "added you to Trip i7" } } })).toBe(1);

    await signedInAs(t.meera.id);
    const list = await loadInvitations(t.meera);
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ groupId: t.g.id, memberId: t.meeraId });
    expect(await acceptInvitation(t.meera, list[0].key)).toEqual({ ok: true, groupId: t.g.id, memberId: t.meeraId });
    expect((await db.member.findUniqueOrThrow({ where: { id: t.meeraId } })).leftAt).toBeNull();
    expect(await db.member.count({ where: { groupId: t.g.id, accountId: t.meera.id } })).toBe(1);
  });

  it("a person the admin removed gets no invitation and is not brought back by it", async () => {
    const t = await trip("i7b");
    await db.member.update({ where: { id: t.meeraId }, data: { leftAt: new Date(), removedAt: new Date(), removedById: t.ashaId } });
    // Asha is the admin, so the email adds him back through the normal bring-back route; a non-admin would not.
    const other = await db.member.create({ data: { groupId: t.g.id, name: "Third7b", accountId: (await account("Third7b")).id, claimedAt: new Date() } });
    const r = await inviteByEmail(t.g.id, other.id, t.meera.email, origin);
    expect(r.people.length).toBe(1);
    expect(await db.invite.count({ where: { groupId: t.g.id, email: t.meera.email } })).toBe(0);
    expect((await db.member.findUniqueOrThrow({ where: { id: t.meeraId } })).removedAt).not.toBeNull();
  });
});

// ---- 8. An invitation whose name row is gone or removed is closed ----
describe("audit 8: Join after the invited name was taken out", () => {
  it("name deleted (undone): refused, invitation closed, nothing joined as someone new", async () => {
    const t = await trip("i8");
    const lee = await account("Lee8");
    await inviteByEmail(t.g.id, t.ashaId, lee.email, origin);
    const inv = await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: lee.email } });
    await db.member.delete({ where: { id: inv.memberId } });
    await signedInAs(lee.id);
    expect(await acceptInvitation(lee, inv.token)).toEqual({ ok: false, error: "This invitation is no longer open." });
    expect(await db.member.count({ where: { groupId: t.g.id, accountId: lee.id } })).toBe(0);
    expect((await db.invite.findUniqueOrThrow({ where: { id: inv.id } })).declinedAt).not.toBeNull();
  });

  it("name removed: refused the same way", async () => {
    const t = await trip("i8b");
    const sam = await account("Sam8b");
    await inviteByEmail(t.g.id, t.ashaId, sam.email, origin);
    const inv = await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: sam.email } });
    await db.member.update({ where: { id: inv.memberId }, data: { leftAt: new Date(), removedAt: new Date(), removedById: t.ashaId } });
    expect(await acceptInvitation(sam, inv.token)).toEqual({ ok: false, error: "This invitation is no longer open." });
    expect(await db.member.count({ where: { groupId: t.g.id, accountId: sam.id } })).toBe(0);
  });
});

// ---- 13. Joining sets seenAt; an older user who used the group stays in ----
describe("audit 13: older people added straight in", () => {
  it("joining by the link (as themselves, or taking a name) sets seenAt", async () => {
    const t = await trip("i13");
    const pat = await account("Pat13");
    const row = await db.member.create({ data: { groupId: t.g.id, name: "Pat", accountId: pat.id, claimedAt: new Date(), addedBy: t.ashaId } });
    expect(await joinNew(t.g.inviteCode, pat, "Pat")).toEqual({ ok: true, memberId: row.id });
    expect((await db.member.findUniqueOrThrow({ where: { id: row.id } })).seenAt).not.toBeNull();

    const lou = await account("Lou13");
    const fresh = await joinNew(t.g.inviteCode, lou, "Lou");
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect((await db.member.findUniqueOrThrow({ where: { id: fresh.memberId } })).seenAt).not.toBeNull();

    const name = await db.member.create({ data: { groupId: t.g.id, name: "Name13" } });
    const taker = await account("Taker13");
    expect((await joinExisting(t.g.inviteCode, taker, name.id)).ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: name.id } })).seenAt).not.toBeNull();
  });

  it("a pending older row that has added an expense or a payment itself counts as joined (and is remembered); one that hasn't stays pending", async () => {
    const t = await trip("i13b");
    const used = await account("Used13b");
    const quiet = await account("Quiet13b");
    const payer = await account("Payer13b");
    const usedRow = await db.member.create({ data: { groupId: t.g.id, name: "Used", accountId: used.id, claimedAt: new Date(), addedBy: t.ashaId } });
    await db.expense.create({ data: { groupId: t.g.id, description: "Tea", splitType: "equal", amount: 1000, originalAmount: 1000, convertedAmount: 1000, paidById: usedRow.id, createdById: usedRow.id, shares: { create: [{ memberId: usedRow.id, amount: 500 }, { memberId: t.ashaId, amount: 500 }] } } });
    await signedInAs(used.id);
    expect(await getMemberships()).toEqual({ [t.g.id]: usedRow.id });
    expect((await db.member.findUniqueOrThrow({ where: { id: usedRow.id } })).seenAt).not.toBeNull();

    const quietRow = await db.member.create({ data: { groupId: t.g.id, name: "Quiet", accountId: quiet.id, claimedAt: new Date(), addedBy: t.ashaId } });
    await signedInAs(quiet.id);
    expect(await getMemberships()).toEqual({});
    expect((await db.member.findUniqueOrThrow({ where: { id: quietRow.id } })).seenAt).toBeNull();

    // A payment they recorded counts too.
    const payRow = await db.member.create({ data: { groupId: t.g.id, name: "Payer", accountId: payer.id, claimedAt: new Date(), addedBy: t.ashaId } });
    await db.payment.create({ data: { groupId: t.g.id, fromId: payRow.id, toId: t.ashaId, amount: 100, createdById: payRow.id } });
    await signedInAs(payer.id);
    expect(await getMemberships()).toEqual({ [t.g.id]: payRow.id });
  });
});

// ---- 3 + 6. What someone who left sees (the pure parts) ----
describe("audit 3 and 6: the group as it was on the day they left", () => {
  const at = (d: string) => new Date(`2026-11-${d}T10:00:00Z`);
  const m = (id: string, created: string, leftAt: string | null = null) => ({ id, name: id, createdAt: at(created), leftAt: leftAt ? at(leftAt) : null, removedAt: null as Date | null });

  it("people: those added by the day they left, and anyone who left only after that day still counts as in", () => {
    // R leaves on 12 Nov. A and M were there from 1 Nov; N joined on 20 Nov; K left on 5 Nov (before R); Q left on 15 Nov (after R).
    const members = [m("A", "01"), m("R", "01", "12"), m("M", "01"), m("N", "20"), m("K", "01", "05"), m("Q", "01", "15")];
    const seen = membersAsOf(members, "R", at("12"));
    expect(seen.map((x) => x.id)).toEqual(["A", "R", "M", "K", "Q"]); // N joined later: not listed
    expect(seen.filter((x) => !x.leftAt).map((x) => x.id)).toEqual(["A", "M", "Q"]); // R himself is out; K left earlier; Q was still in
    expect(seen.find((x) => x.id === "Q")!.removedAt).toBeNull();
    // A person who joined exactly on the day counts as there.
    expect(membersAsOf([m("A", "12"), m("R", "01", "12")], "R", at("12")).map((x) => x.id)).toEqual(["A", "R"]);
  });

  it("games: shown only if they finished by the day the person left", () => {
    const cut = leaverCut({ leftAt: at("12"), removedAt: null });
    expect(gameVisible(cut, { finishedAt: at("14"), createdAt: at("13") })).toBe(false); // played after they left
    expect(gameVisible(cut, { finishedAt: at("12"), createdAt: at("11") })).toBe(true); // finished that very moment
    expect(gameVisible(cut, { finishedAt: at("10"), createdAt: at("09") })).toBe(true);
    expect(gameVisible(cut, { finishedAt: null, createdAt: at("13") })).toBe(false); // started after they left
    expect(gameVisible(null, { finishedAt: at("30"), createdAt: at("29") })).toBe(true); // still in the group: everything
  });

  it("anything created after they left is cut; people still in see everything", () => {
    const cut = leaverCut({ leftAt: at("12"), removedAt: null });
    expect(createdByCut(cut, at("13"))).toBe(false);
    expect(createdByCut(cut, at("12"))).toBe(true);
    expect(createdByCut(null, at("30"))).toBe(true);
  });

  it("the spreadsheet for a leaver has share columns only for people in the rows they can see", () => {
    const members = [{ id: "A", name: "Asha" }, { id: "R", name: "Ravi" }, { id: "M", name: "Meera" }, { id: "N", name: "Nina" }];
    const dinner = {
      description: "Dinner", category: "food", amount: 90000, paidById: "A", payers: "", kind: "expense", originalAmount: 90000, originalCurrency: "INR", exchangeRate: "1",
      markupAmount: 0, paymentMethod: "cash", createdAt: at("10"), spentAt: null, deletedAt: null,
      shares: [{ memberId: "A", amount: 30000 }, { memberId: "R", amount: 30000 }, { memberId: "M", amount: 30000 }],
    };
    const payment = { fromId: "R", toId: "A", amount: 30000, createdAt: at("11"), deletedAt: null };
    expect([...involvedIds([dinner], [payment])].sort()).toEqual(["A", "M", "R"]);
    const header = (csv: string) => csv.replace(/^\uFEFF/, "").split("\r\n")[0];
    const forLeaver = header(groupCsv({ name: "Flat", currency: "INR" }, members, [dinner], [payment], "UTC", { onlyInvolved: true }));
    expect(forLeaver).toContain("Asha's share (INR)");
    expect(forLeaver).toContain("Meera's share (INR)");
    expect(forLeaver).not.toContain("Nina");
    // Still in the group: every column, as before.
    expect(header(groupCsv({ name: "Flat", currency: "INR" }, members, [dinner], [payment], "UTC"))).toContain("Nina's share (INR)");
    // Rows line up with the header: each line has the same number of cells.
    const lines = groupCsv({ name: "Flat", currency: "INR" }, members, [dinner], [payment], "UTC", { onlyInvolved: true }).trim().split("\r\n");
    expect(new Set(lines.map((l) => l.split(",").length)).size).toBe(1);
  });
});

// ---- 9. Move-out daily charge: locked once its month's bill is being added or was added ----
describe("audit 9: the move-out daily charge and its month's bill", () => {
  const rate = async () => ({ ok: true as const, rate: "1", date: "2026-11-23" });
  // Hand-worked: Milk is 4800 a day. Ravi was there 13 days of 3 flatmates: 13 x 4800 / 3 = 20800, only Ravi shares it.
  // The charge was first credited to Asha; the month's payer is Meera. After the month-end step Meera is credited 20800.
  async function flat(label: string, runStatus: string) {
    const g = await db.group.create({
      data: { name: `Flat ${label} ${stamp}`, type: "home", currency: "INR", inviteCode: `ab2c-${label}-${stamp}`, members: { create: [{ name: "Asha" }, { name: "Ravi" }, { name: "Meera" }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    const id = (n: string) => g.members.find((x) => x.name === n)!.id;
    const [asha, ravi, meera] = [id("Asha"), id("Ravi"), id("Meera")];
    const charge = await db.expense.create({
      data: { groupId: g.id, description: "Milk · 1–14 Nov (Ravi’s share)", splitType: "exact", forMode: "one", amount: 20800, originalAmount: 20800, convertedAmount: 20800, paidById: asha, createdById: asha, shares: { create: [{ memberId: ravi, amount: 20800 }] } },
    });
    const bill = await db.bill.create({
      data: { groupId: g.id, name: "Milk", nature: "daily", amount: 4800, day: 1, startMonth: "2026-11", payer: meera, prepaid: JSON.stringify({ "2026-11": [{ m: ravi, a: 20800, e: charge.id, d: "2026-11-14" }] }) },
    });
    await db.billRun.create({ data: { billId: bill.id, period: "2026-11", status: runStatus } });
    return { g, asha, ravi, meera, charge, bill };
  }
  const editInput = (f: { g: { id: string }; asha: string; ravi: string; charge: { id: string } }, amount: string): SaveInput => ({
    groupId: f.g.id, expenseId: f.charge.id, name: "Milk charge", category: "", amount, currency: "INR", paidById: f.asha, forMode: "one", selected: [], onePersonId: f.ravi,
    splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "",
  });
  const locked = "This was counted in this month’s Milk. Edit Milk instead.";

  it("before the month's bill is added the charge can still be edited", async () => {
    const f = await flat("c1", "waiting");
    const r = await saveExpense(editInput(f, "150"), f.asha, rate);
    expect(r.ok).toBe(true);
    expect((await db.expense.findUniqueOrThrow({ where: { id: f.charge.id } })).amount).toBe(15000);
  });

  it("while the month's bill is being added or after it was added: edit and delete are refused, nothing changes", async () => {
    for (const status of ["adding", "added"]) {
      const f = await flat(`c2${status}`, status);
      const edit = await saveExpense(editInput(f, "150"), f.asha, rate);
      expect(edit, status).toEqual({ ok: false, error: locked });
      const del = await setExpenseDeleted(f.charge.id, f.asha, true);
      expect(del, status).toEqual({ ok: false, error: locked });
      const row = await db.expense.findUniqueOrThrow({ where: { id: f.charge.id } });
      expect(row.amount).toBe(20800);
      expect(row.deletedAt).toBeNull();
    }
  });

  it("restoring a deleted charge is refused once the month's bill is being added (not only once added)", async () => {
    const f = await flat("c3", "waiting");
    expect((await setExpenseDeleted(f.charge.id, f.asha, true)).ok).toBe(true);
    await db.billRun.updateMany({ where: { billId: f.bill.id }, data: { status: "adding" } });
    const r = await setExpenseDeleted(f.charge.id, f.asha, false);
    expect(r).toEqual({ ok: false, error: "This month’s Milk was already added, so this charge can’t come back. Add it again by hand if needed." });
    expect((await db.expense.findUniqueOrThrow({ where: { id: f.charge.id } })).deletedAt).not.toBeNull();
  });

  it("the month-end step credits the month's payer and writes a short history line; shares and totals are unchanged", async () => {
    const f = await flat("c4", "adding");
    expect(await groupBalances(f.g.id)).toEqual({ [f.asha]: 20800, [f.ravi]: -20800, [f.meera]: 0 });
    await db.$transaction((tx) => syncChargePayer(tx, f.g.id, [{ m: f.ravi, a: 20800, e: f.charge.id }], f.meera));
    const row = await db.expense.findUniqueOrThrow({ where: { id: f.charge.id }, include: { shares: true } });
    expect(row.paidById).toBe(f.meera);
    expect(row.shares.map((s) => [s.memberId, s.amount])).toEqual([[f.ravi, 20800]]); // only Ravi still shares it, same amount
    const after = await groupBalances(f.g.id);
    expect(after).toEqual({ [f.asha]: 0, [f.ravi]: -20800, [f.meera]: 20800 });
    expect(Object.values(after).reduce((n, x) => n + x, 0)).toBe(0);
    const ev = await db.groupEvent.findMany({ where: { groupId: f.g.id, expenseId: f.charge.id } });
    expect(ev.length).toBe(1);
    expect(ev[0].text).toBe("Meera now paid Milk · 1–14 Nov (Ravi’s share)");
    expect(ev[0].touches.split(",").sort()).toEqual([f.asha, f.meera].sort()); // Ravi's own money did not move
    // Run again: already credited, so no second line.
    await db.$transaction((tx) => syncChargePayer(tx, f.g.id, [{ m: f.ravi, a: 20800, e: f.charge.id }], f.meera));
    expect(await db.groupEvent.count({ where: { groupId: f.g.id, expenseId: f.charge.id } })).toBe(1);
  });
});

// ---- 10. Replacing a group photo ----
describe("audit 10: replacing a photo that was just moved to file storage", () => {
  it("replaces it and queues the file the row points at right then, not an older key", async () => {
    const t = await trip("i10");
    const old = new Date("2026-11-01T10:00:00Z");
    await db.groupPhoto.create({ data: { groupId: t.g.id, data: Buffer.from([1, 2, 3]), blobKey: "", updatedAt: old } });
    // The daily job moves it to file storage after we looked (the version stamp is untouched).
    const moved = `group/moved-${stamp}`;
    await db.groupPhoto.update({ where: { groupId: t.g.id }, data: { blobKey: moved, updatedAt: old } });
    const next = new Date("2026-11-02T10:00:00Z");
    const fresh = `group/new-${stamp}`;
    const ok = await replaceGroupPhoto(t.g.id, { updatedAt: old }, { data: new Uint8Array([9]), blobKey: fresh, type: "image/webp", createdById: t.ashaId, updatedAt: next }, next);
    expect(ok).toBe(true);
    expect((await db.groupPhoto.findUniqueOrThrow({ where: { groupId: t.g.id } })).blobKey).toBe(fresh);
    expect(await db.blobTrash.count({ where: { key: moved } })).toBe(1);
    // Someone else's newer photo got there first: nothing changes.
    const again = await replaceGroupPhoto(t.g.id, { updatedAt: old }, { data: new Uint8Array([7]), blobKey: `group/late-${stamp}`, type: "image/webp", createdById: t.ashaId, updatedAt: next }, next);
    expect(again).toBe(false);
    expect((await db.groupPhoto.findUniqueOrThrow({ where: { groupId: t.g.id } })).blobKey).toBe(fresh);
  });
});

// ---- 11. Saving towards a goal: two taps without a key ----
describe("audit 11: a goal tap without a key is saved once", () => {
  it("the stand-in key depends on who, which goal, how much and the 10-second window", () => {
    const k = tapKey("m1", "g1", 10000, 1_000_000);
    expect(tapKey("m1", "g1", 10000, 1_005_000)).toBe(k); // same 10 seconds
    expect(tapKey("m1", "g1", 10000, 1_010_000)).not.toBe(k); // next window
    expect(tapKey("m2", "g1", 10000, 1_000_000)).not.toBe(k);
    expect(tapKey("m1", "g2", 10000, 1_000_000)).not.toBe(k);
    expect(tapKey("m1", "g1", 20000, 1_000_000)).not.toBe(k);
  });

  it("two taps at the same moment: one entry; a different amount is a different tap", async () => {
    const t = await trip("i11");
    const goal = await db.goal.create({ data: { groupId: t.g.id, name: "Bali", target: 500000, createdById: t.ashaId } });
    const both = await Promise.all([addGoalEntryFor(t.g.id, t.ashaId, goal.id, "100"), addGoalEntryFor(t.g.id, t.ashaId, goal.id, "100")]);
    expect(both.every((r) => r.ok)).toBe(true);
    expect(await db.goalEntry.count({ where: { goalId: goal.id } })).toBe(1);
    expect((await addGoalEntryFor(t.g.id, t.ashaId, goal.id, "250")).ok).toBe(true);
    expect((await db.goalEntry.findMany({ where: { goalId: goal.id } })).map((e) => e.amount).sort((a, b) => a - b)).toEqual([10000, 25000]);
  });
});
