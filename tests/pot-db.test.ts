import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { netBalances } from "@/lib/balances";
import { addPlayerToGame, adjustGap, buyIn, cashOut, countOut, deleteGame, finishGame, inPlay, loadGame, recordMove, removeMove, reopenGame, startGame } from "@/lib/pot-db";
import { parsePlayers } from "@/lib/pot";

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
    const s = await startGame(g.id, a, { name: "", game: "teenpatti", players: [a, b, c, d] }, new Date("2026-10-26T15:00:00Z"));
    if (!s.ok) throw new Error(s.error);
    const game = await loadGame(g.id, s.id);
    expect(game?.name).toBe("Teen Patti · 26 Oct");
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
    expect((await db.groupEvent.findFirst({ where: { groupId: g.id, kind: "pot_finished" } }))?.text).toBe("finished Teen Patti · 26 Oct: Asha won ₹600");

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
  });
});
