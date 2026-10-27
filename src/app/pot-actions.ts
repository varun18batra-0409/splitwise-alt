"use server";

import { redirect } from "@/lib/fresh-redirect";
import { getMyMemberId } from "@/lib/identity";
import { db } from "@/lib/db";
import { addPlayerToGame, adjustGap, buyIn, cashOut, countOut, deleteGame, finishGame, removeMove, reopenGame, startGame } from "@/lib/pot-db";

// The Pot's buttons. Every one checks you're in the group (and the host
// rules in pot-db.ts), then goes back to the game with a note.

const field = (f: FormData, k: string) => String(f.get(k) ?? "");
const okId = (s: string) => (/^[A-Za-z0-9_-]{6,40}$/.test(s) ? s : "");

async function me(groupId: string) {
  const id = okId(groupId);
  const myId = id ? await getMyMemberId(id) : undefined;
  if (!myId) redirect("/private");
  return { groupId: id, myId };
}

async function gameGroup(gameId: string) {
  const g = okId(gameId) ? await db.potGame.findUnique({ where: { id: gameId }, select: { groupId: true } }) : null;
  if (!g) redirect("/");
  return g.groupId;
}

const back = (groupId: string, gameId: string, q: Record<string, string>) => `/groups/${groupId}/pot/${gameId}?${new URLSearchParams(q)}`;

export async function startGameAction(f: FormData) {
  const { groupId, myId } = await me(field(f, "groupId"));
  const r = await startGame(groupId, myId, { name: field(f, "name"), game: field(f, "game"), players: f.getAll("players").map(String).slice(0, 60), newNames: field(f, "newNames").slice(0, 1000) });
  if (!r.ok) redirect(`/groups/${groupId}/pot/new?${new URLSearchParams({ error: r.error })}`);
  redirect(`/groups/${groupId}/pot/${r.id}?started=1`);
}

export async function removeMoveAction(f: FormData) {
  const gameId = field(f, "gameId");
  const { groupId, myId } = await me(await gameGroup(gameId));
  const r = await removeMove(field(f, "moveId"), myId);
  redirect(back(groupId, gameId, r.ok ? { removed: "1" } : { error: r.error }));
}

export async function adjustAction(f: FormData) {
  const gameId = field(f, "gameId");
  const { groupId, myId } = await me(await gameGroup(gameId));
  const r = await adjustGap(gameId, myId, { mode: field(f, "mode"), memberId: field(f, "memberId"), note: field(f, "note") });
  redirect(back(groupId, gameId, r.ok ? { adjusted: "1" } : { error: r.error }));
}

export async function finishGameAction(f: FormData) {
  const gameId = field(f, "gameId");
  const { groupId, myId } = await me(await gameGroup(gameId));
  const r = await finishGame(gameId, myId);
  redirect(back(groupId, gameId, r.ok ? { finished: "1" } : { error: r.error }));
}

export async function reopenGameAction(f: FormData) {
  const gameId = field(f, "gameId");
  const { groupId, myId } = await me(await gameGroup(gameId));
  const r = await reopenGame(gameId, myId);
  redirect(back(groupId, gameId, r.ok ? { reopened: "1" } : { error: r.error }));
}

export async function deleteGameAction(f: FormData) {
  const gameId = field(f, "gameId");
  const { groupId, myId } = await me(await gameGroup(gameId));
  const r = await deleteGame(gameId, myId);
  if (!r.ok) redirect(back(groupId, gameId, { error: r.error }));
  redirect(`/groups/${groupId}?tab=games`);
}

// Someone sits down mid-game: just their name.
export async function addPlayerAction(f: FormData) {
  const gameId = field(f, "gameId");
  const { groupId, myId } = await me(await gameGroup(gameId));
  const r = await addPlayerToGame(gameId, myId, field(f, "name").slice(0, 200));
  redirect(back(groupId, gameId, r.ok ? { joined: "1" } : { error: r.error }));
}

// Buy-in: one amount for everyone ticked.
export async function buyInAction(f: FormData) {
  const gameId = field(f, "gameId");
  const { groupId, myId } = await me(await gameGroup(gameId));
  const r = await buyIn(gameId, myId, { memberIds: f.getAll("memberIds").map(String).slice(0, 60), amount: field(f, "amount"), note: field(f, "note") });
  redirect(back(groupId, gameId, r.ok ? { bought: String(r.count) } : { error: r.error }));
}

// Cash out (and maybe someone new takes the seat).
export async function cashOutAction(f: FormData) {
  const gameId = field(f, "gameId");
  const { groupId, myId } = await me(await gameGroup(gameId));
  const r = await cashOut(gameId, myId, { memberId: field(f, "memberId"), amount: field(f, "amount"), newName: field(f, "newName").slice(0, 80), newAmount: field(f, "newAmount") });
  redirect(back(groupId, gameId, r.ok ? { cashed: "1", ...(field(f, "newName").trim() ? { seat: "1" } : {}) } : { error: r.error }));
}

// End of the game: everyone's count in one go, then (host) settle.
export async function countOutAction(f: FormData) {
  const gameId = field(f, "gameId");
  const { groupId, myId } = await me(await gameGroup(gameId));
  const ids = f.getAll("memberId").map(String).slice(0, 60);
  const entries = ids.map((memberId) => ({ memberId, amount: field(f, `count_${memberId}`) }));
  const r = await countOut(gameId, myId, entries, field(f, "settle") === "1");
  if (!r.ok) redirect(back(groupId, gameId, { error: r.error }));
  redirect(back(groupId, gameId, r.finished ? { finished: "1" } : r.gap ? { counted: "1", gap: "1" } : { counted: "1" }));
}

// Fix a player's name (a spelling slip): players who are just a name, or yourself.
// A friend who joined Loopin owns their name.
export async function renamePlayerAction(f: FormData) {
  const gameId = field(f, "gameId");
  const { groupId, myId } = await me(await gameGroup(gameId));
  const memberId = field(f, "memberId");
  const m = await db.member.findUnique({ where: { id: memberId }, select: { groupId: true, accountId: true, claimedAt: true } });
  if (!m || m.groupId !== groupId) redirect(back(groupId, gameId, { error: "That player isn’t in this group." }));
  if (memberId !== myId && (m.accountId || m.claimedAt)) redirect(back(groupId, gameId, { error: "They joined Loopin, so their name is theirs to change." }));
  const { renameMember } = await import("@/lib/people");
  const r = await renameMember(groupId, myId, memberId, field(f, "name").slice(0, 60));
  redirect(back(groupId, gameId, r.ok ? { renamed: "1" } : { error: r.error }));
}

// "Mark all paid" inside a finished game.
export async function markGamePaidAction(f: FormData) {
  const gameId = field(f, "gameId");
  const { groupId, myId } = await me(await gameGroup(gameId));
  const { markGamePaid } = await import("@/lib/pot-db");
  const { cleanKey } = await import("@/lib/once");
  const r = await markGamePaid(gameId, myId, cleanKey(f.get("rid")) ?? "");
  redirect(back(groupId, gameId, r.ok ? { allpaid: "1", ...(r.eventId ? { did: r.eventId } : {}) } : { error: r.error }));
}
