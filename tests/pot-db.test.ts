import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { netBalances } from "@/lib/balances";
import { addPlayerToGame, adjustGap, buyIn, cashOut, countOut, deleteGame, finishGame, gamesToSettle, inPlay, loadGame, markGamePaid, recordMove, removeMove, reopenGame, startGame } from "@/lib/pot-db";
import { undoEvent } from "@/lib/undo";
import { parsePlayers } from "@/lib/pot";
import { spentAmount } from "@/lib/payers";
import { POT_DELETE_ERROR, POT_EDIT_ERROR, saveExpense, setExpenseDeleted, type SaveExpenseInput } from "@/lib/save-expense";
import { changeGroupCurrency } from "@/lib/group-changes";
import { groupAdminId } from "@/lib/group-admin";

// The Pot against a real database: a game from start to settle, the gap
// check, the host's rules, and a finished game's result in the balances.
const groups: string[] = [];
afterAll(async () => {
  await eraseGroups(groups);
});

async function table(type = "pot") {
  const g = await db.group.create({
    data: { name: "Friday cards", type, currency: "INR", inviteCode: `pot-${Date.now()}-${Math.random()}`, members: { create: [{ name: "Asha" }, { name: "Bina" }, { name: "Chirag" }, { name: "Dev" }] } },
    include: { members: { orderBy: { name: "asc" } } },
  });
  groups.push(g.id);
  const [a, b, c, d] = g.members.map((m) => m.id);
  return { g, a, b, c, d };
}

async function balances(groupId: string) {
  const members = await db.member.findMany({ where: { groupId }, select: { id: true } });
  const [expenses, payments] = await Promise.all([
    db.expense.findMany({ where: { groupId, deletedAt: null }, include: { shares: true } }),
    db.payment.findMany({ where: { groupId, deletedAt: null } }),
  ]);
  return netBalances(members.map((m) => m.id), expenses, payments);
}

describe("The Pot (real database)", () => {
  it("takes, put backs, finish: the result lands in the group's balances (A +600, B −300, C −200, D −100)", async () => {
    const { g, a, b, c, d } = await table();
    const s = await startGame(g.id, a, { name: "", game: "cards", players: [a, b, c, d] }, new Date("2026-10-26T15:00:00Z"));
    if (!s.ok) throw new Error(s.error);
    const game = await loadGame(g.id, s.id);
    expect(game?.name).toBe("Cards · 26 Oct");
    expect(game?.hostId).toBe(a);

    for (const [who, amt] of [[a, "1000"], [b, "2000"], [c, "500"], [d, "1000"], [d, "500"]] as const) expect((await recordMove(s.id, b, { memberId: who, kind: "take", amount: amt })).ok).toBe(true);
    for (const [who, amt] of [[a, "1600"], [b, "1700"], [c, "300"], [d, "1300"]] as const) expect((await recordMove(s.id, who, { memberId: who, kind: "return", amount: amt })).ok).toBe(true);

    // ₹100 missing: can't finish; only the host can fix it.
    const short = await finishGame(s.id, a);
    expect(short.ok).toBe(false);
    expect(!short.ok && short.error).toMatch(/₹100 is still missing/);
    expect((await adjustGap(s.id, b, { mode: "one", memberId: d })).ok).toBe(false);
    // Turns out Dev put back ₹1,400: fix his line instead of adjusting.
    const lines = (await loadGame(g.id, s.id))!.moves;
    const wrong = lines.find((m) => m.memberId === d && m.kind === "return")!;
    expect((await removeMove(wrong.id, b)).ok).toBe(false); // not Bina's line, and she isn't the host
    expect((await removeMove(wrong.id, d)).ok).toBe(true);
    await recordMove(s.id, d, { memberId: d, kind: "return", amount: "1400" });

    expect((await finishGame(s.id, b)).ok).toBe(false); // only the host
    expect((await finishGame(s.id, a)).ok).toBe(true);
    expect(await balances(g.id)).toEqual({ [a]: 60000, [b]: -30000, [c]: -20000, [d]: -10000 });
    const result = await db.expense.findFirstOrThrow({ where: { groupId: g.id, kind: "pot" } });
    expect(result.amount).toBe(60000);
    expect((await db.groupEvent.findFirst({ where: { groupId: g.id, kind: "pot_finished" } }))?.text).toBe("finished Cards · 26 Oct: Asha came out ahead by ₹600");

    // Finished: nothing more can be added; reopening takes the result out again.
    expect((await recordMove(s.id, a, { memberId: a, kind: "take", amount: "100" })).ok).toBe(false);
    expect((await reopenGame(s.id, b)).ok).toBe(false);
    expect((await reopenGame(s.id, a)).ok).toBe(true);
    expect(await balances(g.id)).toEqual({ [a]: 0, [b]: 0, [c]: 0, [d]: 0 });
    expect((await finishGame(s.id, a)).ok).toBe(true);
    expect((await balances(g.id))[a]).toBe(60000);
  });

  it("the host can spread a missing ₹100 over everyone who played", async () => {
    const { g, a, b, c, d } = await table();
    const s = await startGame(g.id, a, { name: "Poker night", game: "poker", players: [a, b, c, d] });
    if (!s.ok) throw new Error(s.error);
    for (const who of [a, b, c, d]) await recordMove(s.id, a, { memberId: who, kind: "take", amount: "1000" });
    await recordMove(s.id, a, { memberId: a, kind: "return", amount: "2000" });
    await recordMove(s.id, a, { memberId: b, kind: "return", amount: "1900" });
    await recordMove(s.id, a, { memberId: c, kind: "return", amount: "0" }); // lost it all
    expect((await finishGame(s.id, a)).ok).toBe(false);
    expect((await adjustGap(s.id, a, { mode: "spread", note: "Rounding" })).ok).toBe(true);
    expect((await finishGame(s.id, a)).ok).toBe(true);
    const net = await balances(g.id);
    expect(Object.values(net).reduce((x, y) => x + y, 0)).toBe(0);
    expect(net).toEqual({ [a]: 102500, [b]: 92500, [c]: -97500, [d]: -97500 }); // ₹25 each written back in
  });

  it("rules: Pot groups only, two players or more, amounts must be real, and a mistaken game can be deleted", async () => {
    const trip = await table("trip");
    expect((await startGame(trip.g.id, trip.a, { name: "", game: "poker", players: [trip.a, trip.b] })).ok).toBe(false);
    const { g, a, b } = await table();
    expect((await startGame(g.id, a, { name: "", game: "poker", players: [a] })).ok).toBe(false);
    expect((await startGame(g.id, "someone-else", { name: "", game: "poker", players: [a, b] })).ok).toBe(false);
    const s = await startGame(g.id, a, { name: "Oops", game: "poker", players: [a, b] });
    if (!s.ok) throw new Error(s.error);
    expect((await recordMove(s.id, a, { memberId: a, kind: "take", amount: "abc" })).ok).toBe(false);
    expect((await recordMove(s.id, a, { memberId: a, kind: "take", amount: "0" })).ok).toBe(false);
    expect((await finishGame(s.id, a)).ok).toBe(false); // nothing taken yet
    expect((await deleteGame(s.id, b)).ok).toBe(false);
    expect((await deleteGame(s.id, a)).ok).toBe(true);
    expect(await loadGame(g.id, s.id)).toBeNull();
  });

  it("players can be just names: added to the group once (a name already there is that person), and late arrivals join the table", async () => {
    const { g, a, b } = await table();
    const s = await startGame(g.id, a, { name: "", game: "poker", players: [a, b], newNames: "Neha, neha\nAsha, Om" });
    if (!s.ok) throw new Error(s.error);
    const members = await db.member.findMany({ where: { groupId: g.id }, orderBy: { name: "asc" } });
    expect(members.map((m) => m.name)).toEqual(["Asha", "Bina", "Chirag", "Dev", "Neha", "Om"]); // no second Asha, one Neha
    expect(members.filter((m) => m.name === "Neha" || m.name === "Om").every((m) => !m.accountId && !m.claimedAt)).toBe(true);
    const game = (await loadGame(g.id, s.id))!;
    const byName = (n: string) => members.find((m) => m.name === n)!.id;
    expect(JSON.parse(game.players).sort()).toEqual([a, b, byName("Neha"), byName("Om")].sort());
    expect((await db.groupEvent.findFirst({ where: { groupId: g.id, kind: "members_added" } }))?.text).toBe("added Neha and Om by name");
    expect((await addPlayerToGame(s.id, b, "Pia")).ok).toBe(true);
    expect(JSON.parse((await loadGame(g.id, s.id))!.players)).toHaveLength(5);
    expect((await addPlayerToGame(s.id, b, "  ")).ok).toBe(false);
  });

  it("the quick way: buy-in for everyone or a few, cash out and someone takes the seat, count everyone at the end and settle", async () => {
    const { g, a, b, c, d } = await table();
    const s = await startGame(g.id, a, { name: "Quick night", game: "poker", players: [a, b, c, d] });
    if (!s.ok) throw new Error(s.error);
    // ₹500 each for all four, then a top-up for three, then Bina once more, Dev once more.
    expect(await buyIn(s.id, b, { memberIds: [a, b, c, d], amount: "500" })).toEqual({ ok: true, count: 4 });
    expect((await buyIn(s.id, b, { memberIds: [a, b, d], amount: "500" })).ok).toBe(true);
    expect((await buyIn(s.id, b, { memberIds: [b], amount: "1000" })).ok).toBe(true);
    expect((await buyIn(s.id, b, { memberIds: [d], amount: "500" })).ok).toBe(true);
    expect((await buyIn(s.id, b, { memberIds: [], amount: "500" })).ok).toBe(false);
    expect((await buyIn(s.id, b, { memberIds: [a], amount: "abc" })).ok).toBe(false);

    // Chirag cashes out with ₹300; Neha (just a name) takes his seat with ₹500.
    expect((await cashOut(s.id, a, { memberId: c, amount: "300", newName: "Neha", newAmount: "500" })).ok).toBe(true);
    expect((await cashOut(s.id, a, { memberId: c, amount: "0" })).ok).toBe(false); // already out
    let game = (await loadGame(g.id, s.id))!;
    const neha = (await db.member.findFirstOrThrow({ where: { groupId: g.id, name: "Neha" } })).id;
    expect(inPlay(parsePlayers(game.players), game.moves.filter((m) => !m.deletedAt)).sort()).toEqual([a, b, d, neha].sort());

    // Bina counts herself from her phone (not the host: saved, not settled).
    expect(await countOut(s.id, b, [{ memberId: b, amount: "1700" }, { memberId: a, amount: "" }], true)).toEqual({ ok: true, finished: false, gap: false });
    // The host can't settle with someone uncounted.
    const missing = await countOut(s.id, a, [{ memberId: a, amount: "1600" }], true);
    expect(!missing.ok && missing.error).toMatch(/Still to count: Dev, Neha/);
    // A ₹100 slip: saved, but it doesn't add up, so no settle yet.
    expect(await countOut(s.id, a, [{ memberId: a, amount: "1600" }, { memberId: d, amount: "1300" }, { memberId: neha, amount: "500" }], true)).toEqual({ ok: true, finished: false, gap: true });
    game = (await loadGame(g.id, s.id))!;
    const slip = game.moves.find((m) => m.memberId === d && m.kind === "return" && !m.deletedAt)!;
    expect((await removeMove(slip.id, a)).ok).toBe(true);
    expect(await countOut(s.id, a, [{ memberId: d, amount: "1400" }], true)).toEqual({ ok: true, finished: true, gap: false });
    const net = await balances(g.id);
    expect({ a: net[a], b: net[b], c: net[c], d: net[d], n: net[neha] }).toEqual({ a: 60000, b: -30000, c: -20000, d: -10000, n: 0 });

    // Games list: ₹600 still to settle. Dev pays his ₹100; then "Mark all paid" does the rest, and Undo puts it back.
    const games = await db.potGame.findMany({ where: { id: s.id }, include: { moves: { where: { deletedAt: null } } } });
    expect(await gamesToSettle(g.id, games)).toEqual({ [s.id]: 60000 });
    await db.payment.create({ data: { groupId: g.id, fromId: d, toId: a, amount: 10000, createdById: a } });
    expect(await gamesToSettle(g.id, games)).toEqual({ [s.id]: 50000 });
    const all = await markGamePaid(s.id, b);
    if (!all.ok) throw new Error(all.error);
    expect(await gamesToSettle(g.id, games)).toEqual({ [s.id]: 0 });
    expect(Object.values(await balances(g.id)).every((v) => v === 0)).toBe(true);
    expect((await markGamePaid(s.id, b)).ok).toBe(false); // nothing left
    const u = await undoEvent(all.eventId!, a);
    expect(u.ok).toBe(true);
    expect((await balances(g.id))[a]).toBe(50000);
  });

  it("one payment counts for one game only (the oldest still owed); Mark all paid twice at once records it once", async () => {
    const { g, a, b } = await table();
    const play = async (name: string) => {
      const s = await startGame(g.id, a, { name, game: "poker", players: [a, b] });
      if (!s.ok) throw new Error(s.error);
      await buyIn(s.id, a, { memberIds: [a, b], amount: "500" });
      const c = await countOut(s.id, a, [{ memberId: a, amount: "800" }, { memberId: b, amount: "200" }], true);
      expect(c).toEqual({ ok: true, finished: true, gap: false }); // Bina owes Asha ₹300
      return s.id;
    };
    const one = await play("Monday");
    const two = await play("Tuesday");
    const games = await db.potGame.findMany({ where: { groupId: g.id }, include: { moves: { where: { deletedAt: null } } } });
    expect(await gamesToSettle(g.id, games)).toEqual({ [one]: 30000, [two]: 30000 });
    await db.payment.create({ data: { groupId: g.id, fromId: b, toId: a, amount: 30000, createdById: b } });
    expect(await gamesToSettle(g.id, games)).toEqual({ [one]: 0, [two]: 30000 });
    // Two people tap "Mark all paid" in Tuesday's game at the same moment: one payment.
    const [x, y] = await Promise.all([markGamePaid(two, a), markGamePaid(two, b)]);
    expect([x.ok, y.ok].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    expect(await gamesToSettle(g.id, games)).toEqual({ [one]: 0, [two]: 0 });
    expect((await balances(g.id))[a]).toBe(0);
  });

  // C136. Asha takes ₹1,000 and puts back ₹1,500; Bina takes 1,000 and puts back 700; Chirag takes 1,000 and puts back 800.
  // Results +50000, −30000, −20000 (sum 0). The game tally is not in the balances until the game is finished.
  it("Game tally vs Money owed: balances stay 0 until finished, then +50000 / −30000 / −20000; reopen puts them back to 0; the result is not spending", async () => {
    const { g, a, b, c } = await table();
    const s = await startGame(g.id, a, { name: "Tally night", game: "teenpatti", players: [a, b, c] });
    if (!s.ok) throw new Error(s.error);
    for (const who of [a, b, c]) await recordMove(s.id, a, { memberId: who, kind: "take", amount: "1000" });
    for (const [who, amt] of [[a, "1500"], [b, "700"], [c, "800"]] as const) await recordMove(s.id, a, { memberId: who, kind: "return", amount: amt });
    expect(Object.values(await balances(g.id)).every((v) => v === 0)).toBe(true); // still only a tally

    expect((await finishGame(s.id, a)).ok).toBe(true);
    const done = await balances(g.id);
    expect({ a: done[a], b: done[b], c: done[c] }).toEqual({ a: 50000, b: -30000, c: -20000 });
    expect(Object.values(done).reduce((x, y) => x + y, 0)).toBe(0);
    // Not spending: out of month totals and categories.
    const result = await db.expense.findFirstOrThrow({ where: { groupId: g.id, kind: "pot" } });
    expect(spentAmount(result)).toBe(0);

    expect((await reopenGame(s.id, a)).ok).toBe(true);
    expect(Object.values(await balances(g.id)).every((v) => v === 0)).toBe(true);
  });

  // Batch C audit fixes for The Pot.
  const noRate = async () => ({ ok: false as const, reason: "unavailable" as const, message: "no rate needed" });
  const edit = (groupId: string, expenseId: string, paidById: string, over: Partial<SaveExpenseInput> = {}): SaveExpenseInput => ({
    groupId, expenseId, name: "Sneaky", amount: "500", currency: "INR", paidById, forMode: "everyone", selected: [], onePersonId: "", splitType: "equal",
    exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", category: "", rateMode: "auto", manualRate: "", ...over,
  });
  // Asha takes 1,000 and puts back 1,500; Bina takes 1,000 and puts back 500. Asha +50000, Bina -50000.
  async function playedGame(opts: { hostLeaves?: boolean } = {}) {
    const t = await table();
    const s = await startGame(t.g.id, t.a, { name: "Audit night", game: "poker", players: [t.a, t.b] });
    if (!s.ok) throw new Error(s.error);
    for (const who of [t.a, t.b]) await recordMove(s.id, t.a, { memberId: who, kind: "take", amount: "1000" });
    await recordMove(s.id, t.a, { memberId: t.a, kind: "return", amount: "1500" });
    await recordMove(s.id, t.a, { memberId: t.b, kind: "return", amount: "500" });
    if (opts.hostLeaves) await db.member.update({ where: { id: t.a }, data: { leftAt: new Date() } });
    return { ...t, gameId: s.id };
  }

  it("a card game's result can't be edited into ordinary spending; reopen then finish keeps exactly one result and balances stay 0", async () => {
    const { g, a, b, gameId } = await playedGame();
    expect((await finishGame(gameId, a)).ok).toBe(true);
    const result = await db.expense.findFirstOrThrow({ where: { groupId: g.id, kind: "pot" }, include: { shares: true } });
    const before = JSON.stringify({ d: result.description, amt: result.amount, k: result.kind, s: result.shares.map((x) => [x.memberId, x.amount]).sort(), by: result.paidById });

    const r = await saveExpense(edit(g.id, result.id, b), b, noRate);
    expect(r).toEqual({ ok: false, error: POT_EDIT_ERROR });
    expect(POT_EDIT_ERROR).toBe("Game results change through the game: open the game to change it.");
    const after = await db.expense.findFirstOrThrow({ where: { id: result.id }, include: { shares: true } });
    expect(after.kind).toBe("pot");
    expect(JSON.stringify({ d: after.description, amt: after.amount, k: after.kind, s: after.shares.map((x) => [x.memberId, x.amount]).sort(), by: after.paidById })).toBe(before);
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(1);

    // Reopen, finish again: one pot result, Asha +50000 and Bina -50000 (hand-worked), sum 0.
    expect((await reopenGame(gameId, a)).ok).toBe(true);
    expect(await db.expense.count({ where: { groupId: g.id, kind: "pot" } })).toBe(0);
    expect((await finishGame(gameId, a)).ok).toBe(true);
    expect(await db.expense.count({ where: { groupId: g.id, kind: "pot", deletedAt: null } })).toBe(1);
    const net = await balances(g.id);
    expect({ a: net[a], b: net[b] }).toEqual({ a: 50000, b: -50000 });
    expect(Object.values(net).reduce((x, y) => x + y, 0)).toBe(0);
  });

  it("editing money back without saying the kind keeps it as money back", async () => {
    const { g, a, b } = await table();
    const refund = await db.expense.create({
      data: { groupId: g.id, description: "Refund", amount: 30000, splitType: "equal", forMode: "everyone", kind: "refund", paidById: a, createdById: a, originalAmount: 30000, convertedAmount: 30000, shares: { create: [{ memberId: a, amount: 15000 }, { memberId: b, amount: 15000 }] } },
    });
    const r = await saveExpense(edit(g.id, refund.id, a, { name: "Refund (renamed)", amount: "300", selected: [a, b] }), a, noRate);
    expect(r.ok).toBe(true);
    expect((await db.expense.findFirstOrThrow({ where: { id: refund.id } })).kind).toBe("refund");
  });

  it("reopening a game in a closed group is refused and the result stays", async () => {
    const { g, a, gameId } = await playedGame();
    expect((await finishGame(gameId, a)).ok).toBe(true);
    await db.group.update({ where: { id: g.id }, data: { closed: true } });
    const r = await reopenGame(gameId, a);
    expect(r).toEqual({ ok: false, error: "This group is closed. Reopen the group first." });
    expect(await db.expense.count({ where: { groupId: g.id, kind: "pot", deletedAt: null } })).toBe(1);
    expect((await db.potGame.findUniqueOrThrow({ where: { id: gameId } })).status).toBe("done");
  });

  it("a deleted open game doesn't block a currency change", async () => {
    const { g, a } = await table();
    const s = await startGame(g.id, a, { name: "Oops", game: "poker", players: [a, g.members[1].id] });
    if (!s.ok) throw new Error(s.error);
    const blocked = await changeGroupCurrency(g.id, a, "USD", "0.012");
    expect(blocked.ok).toBe(false);
    expect((await deleteGame(s.id, a)).ok).toBe(true);
    const admin = (await groupAdminId(g.id))!;
    const ok = await changeGroupCurrency(g.id, admin, "USD", "0.012");
    expect(ok.ok).toBe(true);
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).currency).toBe("USD");
  });

  it("when the host has left, the group admin can finish the game: the result is recorded once; others still can't", async () => {
    const { g, a, b, c, gameId } = await playedGame({ hostLeaves: true });
    const admin = (await groupAdminId(g.id))!;
    expect(admin).not.toBe(a);
    const notAdmin = [b, c].find((x) => x !== admin)!;
    expect((await finishGame(gameId, notAdmin)).ok).toBe(false);
    expect((await finishGame(gameId, admin)).ok).toBe(true);
    expect((await finishGame(gameId, admin)).ok).toBe(false); // already finished
    expect(await db.expense.count({ where: { groupId: g.id, kind: "pot", deletedAt: null } })).toBe(1);
    expect((await db.expense.findFirstOrThrow({ where: { groupId: g.id, kind: "pot" } })).amount).toBe(50000);
    // Reopen by the admin works too; a present host's game is still the host's alone.
    expect((await reopenGame(gameId, admin)).ok).toBe(true);
    expect(await db.expense.count({ where: { groupId: g.id, kind: "pot" } })).toBe(0);
  });

  it("the admin can delete a left host's open game, but not while the host is still in", async () => {
    const t = await table();
    // Who looks after the group, worked out as group-admin.ts does: nobody has claimed a place, so the earliest member (createdAt, then id) who hasn't left.
    const ordered = await db.member.findMany({ where: { groupId: t.g.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
    const admin = ordered[0].id;
    expect(await groupAdminId(t.g.id)).toBe(admin);
    const host = ordered[1].id; // a member who is NOT the admin
    const other = ordered[2].id;
    const s = await startGame(t.g.id, host, { name: "Host night", game: "poker", players: [host, other] });
    if (!s.ok) throw new Error(s.error);
    expect((await loadGame(t.g.id, s.id))!.hostId).toBe(host);
    // The host is still in: the admin may not delete it, another player may not, the host may only when it is theirs to do.
    expect((await deleteGame(s.id, admin)).ok).toBe(false);
    expect((await deleteGame(s.id, other)).ok).toBe(false);
    expect(await loadGame(t.g.id, s.id)).not.toBeNull();
    // The host leaves: now the admin can (and a plain player still can't).
    await db.member.update({ where: { id: host }, data: { leftAt: new Date() } });
    expect(await groupAdminId(t.g.id)).toBe(admin);
    expect((await deleteGame(s.id, other)).ok).toBe(false);
    expect((await deleteGame(s.id, admin)).ok).toBe(true);
    expect(await loadGame(t.g.id, s.id)).toBeNull();
  });

  it("an imported card-game row (no game behind it) stays editable and deletable; a game's result does not", async () => {
    const { g, a, b } = await table();
    const imported = await db.expense.create({
      data: { groupId: g.id, description: "Imported cards", amount: 20000, splitType: "exact", forMode: "selected", kind: "pot", paidById: a, createdById: a, originalAmount: 20000, convertedAmount: 20000, shares: { create: [{ memberId: b, amount: 20000 }] } },
    });
    const r = await saveExpense(edit(g.id, imported.id, a, { name: "Imported cards (fixed)", amount: "250", forMode: "selected", selected: [b], splitType: "equal" }), a, noRate);
    expect(r.ok).toBe(true);
    const edited = await db.expense.findUniqueOrThrow({ where: { id: imported.id } });
    expect(edited.description).toBe("Imported cards (fixed)");
    expect(edited.amount).toBe(25000);
    expect(edited.kind).toBe("pot");
    expect((await setExpenseDeleted(imported.id, b, true)).ok).toBe(true);
    expect((await db.expense.findUniqueOrThrow({ where: { id: imported.id } })).deletedAt).not.toBeNull();
    expect((await setExpenseDeleted(imported.id, b, false)).ok).toBe(true);

    // A game's result in the same group is still protected.
    const s = await startGame(g.id, a, { name: "Real game", game: "poker", players: [a, b] });
    if (!s.ok) throw new Error(s.error);
    for (const who of [a, b]) await recordMove(s.id, a, { memberId: who, kind: "take", amount: "1000" });
    await recordMove(s.id, a, { memberId: a, kind: "return", amount: "1500" });
    await recordMove(s.id, a, { memberId: b, kind: "return", amount: "500" });
    expect((await finishGame(s.id, a)).ok).toBe(true);
    const result = (await db.potGame.findUniqueOrThrow({ where: { id: s.id } })).resultId;
    expect((await setExpenseDeleted(result, b, true)).ok).toBe(false);
    expect((await saveExpense(edit(g.id, result, b), b, noRate)).ok).toBe(false);
  });

  it("an imported card-game row switched to Money back saves as money back (not silently kept as a card row)", async () => {
    const { g, a, b } = await table();
    const imported = await db.expense.create({
      data: { groupId: g.id, description: "Imported cards", amount: 20000, splitType: "exact", forMode: "selected", kind: "pot", paidById: a, createdById: a, originalAmount: 20000, convertedAmount: 20000, shares: { create: [{ memberId: b, amount: 20000 }] } },
    });
    const r = await saveExpense(edit(g.id, imported.id, a, { name: "Cash back", amount: "200", forMode: "selected", selected: [b], splitType: "equal", kind: "refund" }), a, noRate);
    expect(r.ok).toBe(true);
    expect((await db.expense.findUniqueOrThrow({ where: { id: imported.id } })).kind).toBe("refund");
    // Money back ₹200 received by Asha, shared with Bina only: Asha owes Bina ₹200 → Asha -20000, Bina +20000.
    const net = await balances(g.id);
    expect({ a: net[a], b: net[b] }).toEqual({ a: -20000, b: 20000 });
  });

  it("two reopens at the same moment: only one acts; the game is open with no result and balances are back to 0", async () => {
    const { g, a, b, gameId } = await playedGame();
    expect((await finishGame(gameId, a)).ok).toBe(true);
    const [r1, r2] = await Promise.all([reopenGame(gameId, a), reopenGame(gameId, a)]);
    expect([r1.ok, r2.ok].filter(Boolean).length).toBe(1);
    const game = await db.potGame.findUniqueOrThrow({ where: { id: gameId } });
    expect({ status: game.status, resultId: game.resultId }).toEqual({ status: "open", resultId: "" });
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(0);
    expect((await db.groupEvent.count({ where: { groupId: g.id, kind: "pot_reopened" } }))).toBe(1);
    const loser = [r1, r2].find((r) => !r.ok);
    expect(loser && !loser.ok ? loser.error : "").toMatch(/^(This game changed just now|This game is still going)/);
    expect(Object.values(await balances(g.id)).every((v) => v === 0)).toBe(true);
    // Finishing again gives exactly one result: Asha +50000, Bina -50000 (worked by hand above).
    expect((await finishGame(gameId, a)).ok).toBe(true);
    expect(await db.expense.count({ where: { groupId: g.id, deletedAt: null } })).toBe(1);
    const net = await balances(g.id);
    expect({ a: net[a], b: net[b] }).toEqual({ a: 50000, b: -50000 });
    expect(Object.values(net).reduce((x, y) => x + y, 0)).toBe(0);
  });

  it("an old result that was turned into ordinary spending is still removed on reopen; finishing leaves exactly one result and balances sum to 0", async () => {
    const { g, a, b, gameId } = await playedGame();
    expect((await finishGame(gameId, a)).ok).toBe(true);
    const resultId = (await db.potGame.findUniqueOrThrow({ where: { id: gameId } })).resultId;
    await db.expense.update({ where: { id: resultId }, data: { kind: "expense" } }); // as the old edit hole did
    expect((await reopenGame(gameId, a)).ok).toBe(true);
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(0);
    expect(Object.values(await balances(g.id)).every((v) => v === 0)).toBe(true);
    expect((await finishGame(gameId, a)).ok).toBe(true);
    expect(await db.expense.count({ where: { groupId: g.id, deletedAt: null } })).toBe(1);
    // Asha took 1000 and put back 1500 (+500 = 50000 paise); Bina took 1000 and put back 500 (-500 = -50000 paise).
    const net = await balances(g.id);
    expect({ a: net[a], b: net[b] }).toEqual({ a: 50000, b: -50000 });
    expect(Object.values(net).reduce((x, y) => x + y, 0)).toBe(0);
  });

  it("a card-game result can't be deleted or restored on its own; the game's own reopen still works", async () => {
    const { g, a, b, gameId } = await playedGame();
    expect((await finishGame(gameId, a)).ok).toBe(true);
    const result = await db.expense.findFirstOrThrow({ where: { groupId: g.id, kind: "pot" } });

    const del = await setExpenseDeleted(result.id, b, true);
    expect(del).toEqual({ ok: false, error: "Game results change through the game: open the game to reopen or delete it." });
    expect(POT_DELETE_ERROR).toBe("Game results change through the game: open the game to reopen or delete it.");
    const same = await db.expense.findUniqueOrThrow({ where: { id: result.id } });
    expect(same.deletedAt).toBeNull();
    expect(same.amount).toBe(50000);
    expect(await db.groupEvent.count({ where: { groupId: g.id, kind: "expense_deleted" } })).toBe(0);
    const net = await balances(g.id);
    expect({ a: net[a], b: net[b] }).toEqual({ a: 50000, b: -50000 });

    // Restore is refused too (a row deleted before this rule existed stays as it is).
    await db.expense.update({ where: { id: result.id }, data: { deletedAt: new Date(), deletedById: a } });
    const back = await setExpenseDeleted(result.id, b, false);
    expect(back).toEqual({ ok: false, error: POT_DELETE_ERROR });
    expect((await db.expense.findUniqueOrThrow({ where: { id: result.id } })).deletedAt).not.toBeNull();
    expect(await db.groupEvent.count({ where: { groupId: g.id, kind: "expense_restored" } })).toBe(0);
    await db.expense.update({ where: { id: result.id }, data: { deletedAt: null, deletedById: null } });

    // The game's own paths are untouched: reopen removes the result, finishing again adds exactly one.
    expect((await reopenGame(gameId, a)).ok).toBe(true);
    expect((await finishGame(gameId, a)).ok).toBe(true);
    expect(await db.expense.count({ where: { groupId: g.id, kind: "pot", deletedAt: null } })).toBe(1);
  });
});
