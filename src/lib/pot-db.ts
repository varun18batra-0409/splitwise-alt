import { db } from "./db";
import { logEvent } from "./events";
import { formatMoney, parseAmount } from "./money";
import { payersJson } from "./payers";
import { isPotGame, parsePlayers, potGameLabel, potResult, potSummary, spreadGap } from "./pot";

// "The Pot": saving and checking. Anyone in the group can record money taken
// or put back (every line says who recorded it); the person who started the
// game (the host) can fix a gap, finish, reopen or delete it.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const MAX_NOTE = 80;
const cleanNote = (s: string) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_NOTE);

async function groupFor(groupId: string, actorId: string) {
  const g = await db.group.findUnique({
    where: { id: groupId },
    select: { id: true, type: true, currency: true, closed: true, deletedAt: true, members: { select: { id: true, name: true, leftAt: true } } },
  });
  if (!g || g.deletedAt) return { error: "This group isn’t there any more." } as const;
  const me = g.members.find((m) => m.id === actorId && !m.leftAt);
  if (!me) return { error: "Only people in this group can do that." } as const;
  return { g };
}

async function gameFor(gameId: string, actorId: string) {
  const game = await db.potGame.findUnique({ where: { id: gameId }, include: { moves: { where: { deletedAt: null } } } });
  if (!game || game.deletedAt) return { error: "This game isn’t there any more." } as const;
  const r = await groupFor(game.groupId, actorId);
  if ("error" in r) return r;
  return { game, g: r.g };
}

// Start a game: its name, Poker or Teen Patti, and who's playing (at least two).
export async function startGame(groupId: string, actorId: string, input: { name: string; game: string; players: string[] }, today = new Date()): Promise<Result<{ id: string }>> {
  const r = await groupFor(groupId, actorId);
  if ("error" in r) return { ok: false, error: r.error };
  if (r.g.type !== "pot") return { ok: false, error: "Games are for Pot groups." };
  if (r.g.closed) return { ok: false, error: "This group is closed. Reopen it in settings to play." };
  const game = isPotGame(input.game) ? input.game : "teenpatti";
  const active = new Set(r.g.members.filter((m) => !m.leftAt).map((m) => m.id));
  const players = [...new Set(input.players.filter((p) => active.has(p)))];
  if (players.length < 2) return { ok: false, error: "Pick at least two players." };
  const when = today.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ").slice(0, 60) || `${potGameLabel(game)} · ${when}`;
  const created = await db.potGame.create({ data: { groupId, name, game, players: JSON.stringify(players), hostId: actorId } });
  await logEvent(db, { groupId, actorId, kind: "pot_started", text: `started a game: ${name} (${potGameLabel(game)}, ${players.length} players)` });
  return { ok: true, id: created.id };
}

// Money taken from the pot, or put back. "0" put back = lost it all.
export async function recordMove(gameId: string, actorId: string, input: { memberId: string; kind: string; amount: string; note?: string }): Promise<Result> {
  const r = await gameFor(gameId, actorId);
  if ("error" in r) return { ok: false, error: r.error };
  const { game, g } = r;
  if (game.status !== "open") return { ok: false, error: "This game is finished. The host can reopen it." };
  if (input.kind !== "take" && input.kind !== "return") return { ok: false, error: "Pick take or put back." };
  const player = g.members.find((m) => m.id === input.memberId && !m.leftAt);
  if (!player) return { ok: false, error: "Pick who it’s for." };
  const typed = String(input.amount ?? "").trim();
  const amount = input.kind === "return" && /^0+([.,]0*)?$/.test(typed) ? 0 : parseAmount(typed, g.currency);
  if (amount === null) return { ok: false, error: input.kind === "return" ? "Enter how much they put back (0 if nothing)." : "Enter how much they took." };
  const players = parsePlayers(game.players);
  await db.$transaction([
    db.potMove.create({ data: { gameId, memberId: player.id, kind: input.kind, amount, note: cleanNote(input.note ?? ""), createdById: actorId } }),
    // Someone who joins the table late becomes a player.
    ...(players.includes(player.id) ? [] : [db.potGame.update({ where: { id: gameId }, data: { players: JSON.stringify([...players, player.id]) } })]),
  ]);
  return { ok: true };
}

// Take a line back (while the game is open): whoever recorded it, or the host.
export async function removeMove(moveId: string, actorId: string): Promise<Result<{ gameId: string }>> {
  const m = await db.potMove.findUnique({ where: { id: moveId } });
  if (!m || m.deletedAt) return { ok: false, error: "That line isn’t there any more." };
  const r = await gameFor(m.gameId, actorId);
  if ("error" in r) return { ok: false, error: r.error };
  if (r.game.status !== "open") return { ok: false, error: "This game is finished. The host can reopen it." };
  if (m.createdById !== actorId && r.game.hostId !== actorId) return { ok: false, error: "Only whoever added it, or the host, can take it back." };
  await db.potMove.update({ where: { id: moveId }, data: { deletedAt: new Date() } });
  return { ok: true, gameId: m.gameId };
}

// The host closes a gap (money missing, or more back than taken): spread over
// everyone who played, or on one player. Always with a reason.
export async function adjustGap(gameId: string, actorId: string, input: { mode: string; memberId?: string; note?: string }): Promise<Result> {
  const r = await gameFor(gameId, actorId);
  if ("error" in r) return { ok: false, error: r.error };
  const { game } = r;
  if (game.hostId !== actorId) return { ok: false, error: "Only the host can fix the difference." };
  if (game.status !== "open") return { ok: false, error: "This game is finished." };
  const { lines, totals } = potSummary(parsePlayers(game.players), game.moves);
  if (totals.balanced) return { ok: false, error: "It already adds up." };
  const note = cleanNote(input.note ?? "") || (totals.gap < 0 ? "Missing from the pot" : "Extra in the pot");
  const players = lines.filter((l) => l.taken > 0 || l.returnedYet).map((l) => l.memberId);
  let parts: { memberId: string; amount: number }[];
  if (input.mode === "one") {
    if (!input.memberId || !lines.some((l) => l.memberId === input.memberId)) return { ok: false, error: "Pick who it goes on." };
    parts = [{ memberId: input.memberId, amount: -totals.gap }];
  } else parts = spreadGap(totals.gap, players.length ? players : lines.map((l) => l.memberId));
  await db.potMove.createMany({ data: parts.map((p) => ({ gameId, memberId: p.memberId, kind: "adjust", amount: p.amount, note, createdById: actorId })) });
  return { ok: true };
}

// Finish: only when everything adds up. The result goes into the group's
// balances as one line, so settling up works as for any group.
export async function finishGame(gameId: string, actorId: string): Promise<Result> {
  const r = await gameFor(gameId, actorId);
  if ("error" in r) return { ok: false, error: r.error };
  const { game, g } = r;
  if (game.hostId !== actorId) return { ok: false, error: "Only the host can finish the game." };
  if (game.status !== "open") return { ok: false, error: "This game is already finished." };
  if (g.closed) return { ok: false, error: "This group is closed. Reopen it in settings first." };
  const { lines, totals } = potSummary(parsePlayers(game.players), game.moves);
  if (!totals.taken) return { ok: false, error: "Nobody has taken anything from the pot yet." };
  if (!totals.balanced) {
    const gap = formatMoney(Math.abs(totals.gap), g.currency);
    return { ok: false, error: totals.gap < 0 ? `${gap} is still missing from the pot. Find it, or fix the difference.` : `${gap} more came back than was taken. Check the amounts, or fix the difference.` };
  }
  const res = potResult(lines);
  const name = (id: string) => g.members.find((m) => m.id === id)?.name ?? "Someone";
  const now = new Date();
  await db.$transaction(async (tx) => {
    let resultId = "";
    if (res.total > 0) {
      const e = await tx.expense.create({
        data: {
          groupId: g.id,
          description: game.name,
          amount: res.total,
          splitType: "exact",
          forMode: "selected",
          category: "other",
          kind: "pot",
          paidById: res.winners[0].memberId,
          payers: payersJson(res.winners),
          originalAmount: res.total,
          originalCurrency: g.currency,
          baseCurrency: g.currency,
          convertedAmount: res.total,
          createdById: actorId,
          spentAt: now,
          shares: { create: res.losers.map((l) => ({ memberId: l.memberId, amount: l.amount })) },
        },
      });
      resultId = e.id;
    }
    const won = res.winners.map((w) => `${name(w.memberId)} won ${formatMoney(w.amount, g.currency)}`).join(", ");
    await logEvent(tx, { groupId: g.id, actorId, kind: "pot_finished", text: `finished ${game.name}: ${won || "everyone broke even"}`, ...(resultId ? { expenseId: resultId } : {}) });
    await tx.potGame.update({ where: { id: gameId }, data: { status: "done", finishedAt: now, resultId } });
  });
  return { ok: true };
}

// Reopen a finished game (a wrong amount): its result comes out of the balances until it's finished again.
export async function reopenGame(gameId: string, actorId: string): Promise<Result> {
  const r = await gameFor(gameId, actorId);
  if ("error" in r) return { ok: false, error: r.error };
  const { game, g } = r;
  if (game.hostId !== actorId) return { ok: false, error: "Only the host can reopen the game." };
  if (game.status !== "done") return { ok: false, error: "This game is still going." };
  await db.$transaction(async (tx) => {
    if (game.resultId) {
      // The event that pointed at it stays in the history, without the link.
      await tx.groupEvent.updateMany({ where: { expenseId: game.resultId }, data: { expenseId: null } });
      await tx.expense.deleteMany({ where: { id: game.resultId, kind: "pot" } });
    }
    await tx.potGame.update({ where: { id: gameId }, data: { status: "open", finishedAt: null, resultId: "" } });
    await logEvent(tx, { groupId: g.id, actorId, kind: "pot_reopened", text: `reopened ${game.name} (its result is out of the balances until it’s finished again)` });
  });
  return { ok: true };
}

// Delete a game started by mistake (only while it's open).
export async function deleteGame(gameId: string, actorId: string): Promise<Result<{ groupId: string }>> {
  const r = await gameFor(gameId, actorId);
  if ("error" in r) return { ok: false, error: r.error };
  if (r.game.hostId !== actorId) return { ok: false, error: "Only the host can delete the game." };
  if (r.game.status !== "open") return { ok: false, error: "Reopen it first." };
  await db.potGame.update({ where: { id: gameId }, data: { deletedAt: new Date() } });
  await logEvent(db, { groupId: r.g.id, actorId, kind: "pot_deleted", text: `deleted the game ${r.game.name}` });
  return { ok: true, groupId: r.g.id };
}

export async function loadGames(groupId: string) {
  return db.potGame.findMany({ where: { groupId, deletedAt: null }, include: { moves: { where: { deletedAt: null } } }, orderBy: { createdAt: "desc" }, take: 100 });
}

export async function loadGame(groupId: string, gameId: string) {
  const g = await db.potGame.findUnique({ where: { id: gameId }, include: { moves: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  return g && !g.deletedAt && g.groupId === groupId ? g : null;
}
