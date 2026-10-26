"use server";

import { redirect } from "@/lib/fresh-redirect";
import { getMyMemberId } from "@/lib/identity";
import { db } from "@/lib/db";
import { adjustGap, deleteGame, finishGame, recordMove, removeMove, reopenGame, startGame } from "@/lib/pot-db";

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
  const r = await startGame(groupId, myId, { name: field(f, "name"), game: field(f, "game"), players: f.getAll("players").map(String).slice(0, 60) });
  if (!r.ok) redirect(`/groups/${groupId}/pot/new?${new URLSearchParams({ error: r.error })}`);
  redirect(`/groups/${groupId}/pot/${r.id}?started=1`);
}

export async function recordMoveAction(f: FormData) {
  const gameId = field(f, "gameId");
  const { groupId, myId } = await me(await gameGroup(gameId));
  const kind = field(f, "kind");
  const r = await recordMove(gameId, myId, { memberId: field(f, "memberId"), kind, amount: field(f, "amount"), note: field(f, "note") });
  redirect(back(groupId, gameId, r.ok ? { saved: kind, who: field(f, "memberId") } : { error: r.error, who: field(f, "memberId"), kind }));
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
