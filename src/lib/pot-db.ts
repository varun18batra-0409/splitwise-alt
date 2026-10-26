import { db } from "./db";
import { logEvent } from "./events";
import { formatMoney, parseAmount } from "./money";
import { payersJson } from "./payers";
import { isPotGame, parsePlayers, potGameLabel, potResult, potSummary, spreadGap } from "./pot";
import { cleanNames, sameName } from "./names";

// "The Pot": saving and checking. Anyone in the group can record money taken
// or put back (every line says who recorded it); the person who started the
// game (the host) can fix a gap, finish, reopen or delete it.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const MAX_NOTE = 80;
const cleanNote = (s: string) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_NOTE);

async function groupFor(groupId: string, actorId: string) {
  const g = await db.group.findUnique({
    where: { id: groupId },
    select: { id: true, type: true, currency: true, closed: true, deletedAt: true, joinWeight: true, members: { select: { id: true, name: true, leftAt: true } } },
  });
  if (!g || g.deletedAt) return { error: "This group isn’t there any more." };
  const me = g.members.find((m) => m.id === actorId && !m.leftAt);
  if (!me) return { error: "Only people in this group can do that." };
  return { error: "", g };
}

async function gameFor(gameId: string, actorId: string) {
  const game = await db.potGame.findUnique({ where: { id: gameId }, include: { moves: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } } });
  if (!game || game.deletedAt) return { error: "This game isn’t there any more." };
  const r = await groupFor(game.groupId, actorId);
  if (!r.g) return { error: r.error };
  return { error: "", game, g: r.g };
}

// Players who don't need to join: just names, added to the group (they can
// join with the link any time and take over their name). A name that's
// already in the group is that person, not a second one.
export async function addNamedPlayers(groupId: string, actorId: string, raw: string): Promise<Result<{ ids: string[]; added: string[] }>> {
  const r = await groupFor(groupId, actorId);
  if (!r.g) return { ok: false, error: r.error };
  if (r.g.type !== "pot") return { ok: false, error: "Players are for Pot groups." };
  const names = cleanNames(String(raw ?? "").split(/[\n,]+/)).slice(0, 20);
  if (!names.length) return { ok: true, ids: [], added: [] };
  const active = r.g.members.filter((m) => !m.leftAt);
  const ids: string[] = [];
  const fresh: string[] = [];
  for (const n of names) {
    const same = active.find((m) => sameName(m.name, n));
    if (same) ids.push(same.id);
    else fresh.push(n);
  }
  if (active.length + fresh.length > 100) return { ok: false, error: "A group can have up to 100 people." };
  if (fresh.length) {
    const g = r.g;
    const made = await db.$transaction(async (tx) => {
      const rows = [];
      for (const name of fresh) rows.push(await tx.member.create({ data: { name, groupId, splitWeight: g.joinWeight } }));
      await logEvent(tx, {
        groupId,
        actorId,
        kind: "members_added",
        text: `added ${fresh.length === 1 ? fresh[0] : `${fresh.slice(0, -1).join(", ")} and ${fresh[fresh.length - 1]}`} by name`,
        undo: { type: "members_remove", memberIds: rows.map((m) => m.id) },
      });
      return rows;
    });
    ids.push(...made.map((m) => m.id));
  }
  return { ok: true, ids, added: fresh };
}

// Someone sits down mid-game: add them by name (or pick an existing name) to an open game.
export async function addPlayerToGame(gameId: string, actorId: string, raw: string): Promise<Result> {
  const r = await gameFor(gameId, actorId);
  if (!r.game || !r.g) return { ok: false, error: r.error };
  if (r.game.status !== "open") return { ok: false, error: "This game is finished. The host can reopen it." };
  if (!String(raw ?? "").trim()) return { ok: false, error: "Type their name." };
  const a = await addNamedPlayers(r.g.id, actorId, raw);
  if (!a.ok) return a;
  const players = parsePlayers(r.game.players);
  const next = [...new Set([...players, ...a.ids])];
  if (next.length !== players.length) await db.potGame.update({ where: { id: gameId }, data: { players: JSON.stringify(next) } });
  return { ok: true };
}

// Start a game: its name, Poker or Teen Patti, and who's playing (at least two).
// `newNames`: players who aren't in the group yet, added by name.
export async function startGame(groupId: string, actorId: string, input: { name: string; game: string; players: string[]; newNames?: string }, today = new Date()): Promise<Result<{ id: string }>> {
  let r = await groupFor(groupId, actorId);
  if (!r.g) return { ok: false, error: r.error };
  if (r.g.type !== "pot") return { ok: false, error: "Games are for Pot groups." };
  if (r.g.closed) return { ok: false, error: "This group is closed. Reopen it in settings to play." };
  const named = input.newNames?.trim() ? await addNamedPlayers(groupId, actorId, input.newNames) : { ok: true as const, ids: [] as string[], added: [] as string[] };
  if (!named.ok) return named;
  if (named.ids.length) r = await groupFor(groupId, actorId);
  if (!r.g) return { ok: false, error: r.error };
  const game = isPotGame(input.game) ? input.game : "teenpatti";
  const active = new Set(r.g.members.filter((m) => !m.leftAt).map((m) => m.id));
  const players = [...new Set([...input.players, ...named.ids].filter((p) => active.has(p)))];
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
  if (!r.game || !r.g) return { ok: false, error: r.error };
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
  if (!r.game || !r.g) return { ok: false, error: r.error };
  if (r.game.status !== "open") return { ok: false, error: "This game is finished. The host can reopen it." };
  if (m.createdById !== actorId && r.game.hostId !== actorId) return { ok: false, error: "Only whoever added it, or the host, can take it back." };
  await db.potMove.update({ where: { id: moveId }, data: { deletedAt: new Date() } });
  return { ok: true, gameId: m.gameId };
}

// The host closes a gap (money missing, or more back than taken): spread over
// everyone who played, or on one player. Always with a reason.
export async function adjustGap(gameId: string, actorId: string, input: { mode: string; memberId?: string; note?: string }): Promise<Result> {
  const r = await gameFor(gameId, actorId);
  if (!r.game || !r.g) return { ok: false, error: r.error };
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
  if (!r.game || !r.g) return { ok: false, error: r.error };
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
  if (!r.game || !r.g) return { ok: false, error: r.error };
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
  if (!r.game || !r.g) return { ok: false, error: r.error };
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

// Who's still playing: bought in, and their latest money line is a take (not
// yet cashed out, or bought back in after cashing out).
export function inPlay(players: string[], moves: { memberId: string; kind: string; deletedAt?: Date | null }[]): string[] {
  const last = new Map<string, string>();
  for (const m of moves) if (!m.deletedAt && (m.kind === "take" || m.kind === "return")) last.set(m.memberId, m.kind);
  return players.filter((p) => last.get(p) === "take");
}

// Buy-in: the same amount from the pot for each player picked (everyone at the
// start, or just the ones topping up).
export async function buyIn(gameId: string, actorId: string, input: { memberIds: string[]; amount: string; note?: string }): Promise<Result<{ count: number }>> {
  const r = await gameFor(gameId, actorId);
  if (!r.game || !r.g) return { ok: false, error: r.error };
  const { game, g } = r;
  if (game.status !== "open") return { ok: false, error: "This game is finished. The host can reopen it." };
  const amount = parseAmount(String(input.amount ?? "").trim(), g.currency);
  if (amount === null) return { ok: false, error: "Enter how much each person takes." };
  const active = new Set(g.members.filter((m) => !m.leftAt).map((m) => m.id));
  const who = [...new Set(input.memberIds.filter((id) => active.has(id)))];
  if (!who.length) return { ok: false, error: "Pick who’s taking money." };
  const players = parsePlayers(game.players);
  const note = cleanNote(input.note ?? "");
  await db.$transaction([
    db.potMove.createMany({ data: who.map((memberId) => ({ gameId, memberId, kind: "take", amount, note, createdById: actorId })) }),
    ...(who.every((id) => players.includes(id)) ? [] : [db.potGame.update({ where: { id: gameId }, data: { players: JSON.stringify([...new Set([...players, ...who])]) } })]),
  ]);
  return { ok: true, count: who.length };
}

// Cash out: a player leaves the table with what they have (0 if nothing).
// Someone can take their seat: a new name (or someone in the group) with a buy-in.
export async function cashOut(gameId: string, actorId: string, input: { memberId: string; amount: string; newName?: string; newAmount?: string }): Promise<Result> {
  const r = await gameFor(gameId, actorId);
  if (!r.game || !r.g) return { ok: false, error: r.error };
  const { game, g } = r;
  if (game.status !== "open") return { ok: false, error: "This game is finished. The host can reopen it." };
  if (!inPlay(parsePlayers(game.players), game.moves).includes(input.memberId)) return { ok: false, error: "They aren’t playing right now." };
  const typed = String(input.amount ?? "").trim();
  const amount = /^0+([.,]0*)?$/.test(typed) ? 0 : parseAmount(typed, g.currency);
  if (amount === null) return { ok: false, error: "Enter what they leave with (0 if nothing)." };
  const seat = String(input.newName ?? "").trim();
  const seatAmount = seat ? parseAmount(String(input.newAmount ?? "").trim(), g.currency) : null;
  if (seat && seatAmount === null) return { ok: false, error: "Enter what the new player takes from the pot." };
  await db.potMove.create({ data: { gameId, memberId: input.memberId, kind: "return", amount, note: "cashed out", createdById: actorId } });
  if (seat && seatAmount !== null) {
    const a = await addNamedPlayers(g.id, actorId, seat.split(/[\n,]+/)[0]);
    if (!a.ok) return a;
    const id = a.ids[0];
    const players = parsePlayers(game.players);
    await db.$transaction([
      db.potMove.create({ data: { gameId, memberId: id, kind: "take", amount: seatAmount, note: `took ${g.members.find((m) => m.id === input.memberId)?.name ?? "their"}’s seat`, createdById: actorId } }),
      ...(players.includes(id) ? [] : [db.potGame.update({ where: { id: gameId }, data: { players: JSON.stringify([...players, id]) } })]),
    ]);
  }
  return { ok: true };
}

// The end of the game: what everyone still playing has, all at once. With
// `settle` (the host), the game finishes straight away if it adds up.
export async function countOut(gameId: string, actorId: string, entries: { memberId: string; amount: string }[], settle: boolean): Promise<Result<{ finished: boolean; gap: boolean }>> {
  const r = await gameFor(gameId, actorId);
  if (!r.game || !r.g) return { ok: false, error: r.error };
  const { game, g } = r;
  if (game.status !== "open") return { ok: false, error: "This game is finished. The host can reopen it." };
  const playing = new Set(inPlay(parsePlayers(game.players), game.moves));
  const name = (id: string) => g.members.find((m) => m.id === id)?.name ?? "Someone";
  const rows: { memberId: string; amount: number }[] = [];
  for (const e of entries) {
    if (!playing.has(e.memberId)) continue;
    const typed = String(e.amount ?? "").trim();
    if (!typed) continue; // not counted yet
    const amount = /^0+([.,]0*)?$/.test(typed) ? 0 : parseAmount(typed, g.currency);
    if (amount === null) return { ok: false, error: `${name(e.memberId)}: enter an amount (0 if nothing).` };
    rows.push({ memberId: e.memberId, amount });
  }
  if (!rows.length && !settle) return { ok: false, error: "Type what each person has." };
  if (rows.length) await db.potMove.createMany({ data: rows.map((x) => ({ gameId, memberId: x.memberId, kind: "return", amount: x.amount, note: "counted at the end", createdById: actorId })) });
  if (!settle || game.hostId !== actorId) return { ok: true, finished: false, gap: false };
  const missing = [...playing].filter((id) => !rows.some((x) => x.memberId === id));
  if (missing.length) return { ok: false, error: `Still to count: ${missing.map(name).join(", ")}. Put 0 for anyone who lost it all.` };
  const f = await finishGame(gameId, actorId);
  return f.ok ? { ok: true, finished: true, gap: false } : { ok: true, finished: false, gap: true };
}
