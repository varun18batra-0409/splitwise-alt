import { notFound, redirect } from "next/navigation";
import { TrophyIcon } from "@/components/DrawnIcons";
import Link from "@/components/Link";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { ErrorNote, PageHeader, inputClass, secondaryButtonClass } from "@/components/ui";
import { Notice } from "@/components/Notice";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PotBuyIn } from "@/components/PotBuyIn";
import { PotCount } from "@/components/PotCount";
import { PotName } from "@/components/PotName";
import { addPlayerAction, adjustAction, cashOutAction, deleteGameAction, finishGameAction, markGamePaidAction, removeMoveAction, reopenGameAction } from "@/app/pot-actions";
import { gameSettlement, inPlay, loadGame } from "@/lib/pot-db";
import { parsePlayers, potGameLabel, potSummary } from "@/lib/pot";
import { UndoBar } from "@/components/UndoBar";
import { canUndo } from "@/lib/undo";
import { decimalsOf, formatMoney, toInputAmount } from "@/lib/money";
import { recordCustomPayment } from "@/app/actions";
import { newRequestKey } from "@/lib/once";
import { getTimeZone } from "@/lib/tz";

// One game of The Pot: money taken and put back, live; then who won, who
// lost and who pays whom. Settling up happens in the group, as always.

const CASHED = "cashed out";
const COUNTED = "counted at the end";

type SP = { did?: string; undone?: string; allpaid?: string; paid?: string; renamed?: string; error?: string; bought?: string; cashed?: string; seat?: string; counted?: string; gap?: string; joined?: string; started?: string; saved?: string; who?: string; kind?: string; removed?: string; adjusted?: string; finished?: string; reopened?: string };

export default async function GamePage({ params, searchParams }: { params: Promise<{ id: string; gameId: string }>; searchParams: Promise<SP> }) {
  const { id, gameId } = await params;
  const sp = await searchParams;
  const group = await db.group.findUnique({ where: { id }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId && !m.leftAt)) redirect("/private");
  const game = await loadGame(group.id, gameId);
  if (!game) notFound();
  const tz = await getTimeZone();

  const money = (n: number) => formatMoney(n, group.currency);
  const nameOf = (mid: string) => group.members.find((m) => m.id === mid)?.name ?? "Someone";
  const you = (mid: string) => (mid === myId ? "You" : nameOf(mid));
  const youLow = (mid: string) => (mid === myId ? "you" : nameOf(mid)); // in the middle of a sentence
  const players = parsePlayers(game.players);
  const live = game.moves.filter((m) => !m.deletedAt);
  const { lines, totals } = potSummary(players, live);
  const open = game.status === "open";
  const host = game.hostId === myId;
  const ranked = [...lines].sort((a, b) => b.net - a.net);
  const playing = inPlay(players, live);
  const lineOf = (mid: string) => lines.find((l) => l.memberId === mid);
  const time = (d: Date) => d.toLocaleTimeString("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  // Quick amounts: ₹500 / 1,000 / 2,000 (or 10 / 20 / 50 in other currencies).
  const unit = 10 ** decimalsOf(group.currency);
  const quick = (group.currency === "INR" ? [500, 1000, 2000, 5000] : [10, 20, 50, 100]).map((n) => ({ value: String(n), label: formatMoney(n * unit, group.currency) }));
  const gapText = formatMoney(Math.abs(totals.gap), group.currency);

  // Once finished: each payment and what's left of it, and what's still owed in the whole group.
  const settlement = open ? null : await gameSettlement(group.id, game);
  const stillOwed = settlement?.stillOwed ?? 0;
  const pending = (settlement?.transfers ?? []).filter((t) => !t.done);
  // Undo right after Mark paid / Mark all paid.
  const justDid = sp.did && /^[A-Za-z0-9_-]{6,40}$/.test(sp.did) ? await db.groupEvent.findFirst({ where: { id: sp.did, groupId: group.id } }) : null;
  const newer = justDid ? await db.groupEvent.findMany({ where: { groupId: group.id, createdAt: { gte: justDid.createdAt } } }) : [];
  const showUndo = Boolean(justDid && canUndo(justDid, newer).ok);

  const form = (action: (f: FormData) => Promise<void>, label: string, cls: string, confirm?: string, extra?: React.ReactNode) => (
    <form action={action}>
      <input type="hidden" name="gameId" value={game.id} />
      {extra}
      {confirm ? (
        <ConfirmButton message={confirm} className={cls}>
          {label}
        </ConfirmButton>
      ) : (
        <button type="submit" className={cls}>
          {label}
        </button>
      )}
    </form>
  );

  const whoPays = (
        <section aria-label="Who pays whom" className="mt-6">
          <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">Who pays whom</h2>
          {!settlement || settlement.transfers.length === 0 ? (
            <p className="rounded-xl bg-mist px-4 py-3 text-sm text-gray-500">Nobody owes anybody for this game.</p>
          ) : (
            <ul className="space-y-2">
              {settlement.transfers.map((t) => {
                const { left, done } = t;
                return (
                  <li key={`${t.from}-${t.to}`} className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3" data-transfer={done ? "paid" : "pending"}>
                    <span className="min-w-0 flex-1 text-sm">
                      <strong className="font-semibold">{you(t.from)}</strong> {t.from === myId ? "pay" : "pays"} <strong className="font-semibold">{youLow(t.to)}</strong>
                    </span>
                    <span className="text-right font-semibold tabular-nums">
                      {money(done || left === t.amount ? t.amount : left)}
                      {!done && left !== t.amount && <span className="block text-[11px] font-normal text-gray-500">left of {money(t.amount)}</span>}
                    </span>
                    {done || group.closed ? (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${done ? "bg-owed/[0.14] text-owed" : "bg-fg/[0.08] text-fg/60"}`}>{done ? "paid ✓" : "pending"}</span>
                    ) : (
                      // Paid? Mark it right here: you stay on the game.
                      <form action={recordCustomPayment} className="shrink-0">
                        <input type="hidden" name="groupId" value={group.id} />
                        <input type="hidden" name="fromId" value={t.from} />
                        <input type="hidden" name="toId" value={t.to} />
                        <input type="hidden" name="amount" value={toInputAmount(left, group.currency)} />
                        <input type="hidden" name="back" value={`pot:${game.id}`} />
                        <input type="hidden" name="rid" value={newRequestKey()} />
                        <button type="submit" className="rounded-full bg-fg px-3 py-1 text-xs font-semibold text-canvas" aria-label={`Mark paid: ${you(t.from)} ${t.from === myId ? "pay" : "pays"} ${youLow(t.to)}`}>
                          Mark paid
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {pending.length > 1 && !group.closed && (
            <form action={markGamePaidAction} className="mt-3">
              <input type="hidden" name="gameId" value={game.id} />
              <input type="hidden" name="rid" value={newRequestKey()} />
              <ConfirmButton message={`Mark all ${pending.length} payments of this game paid? Everyone is told, and you can undo it.`} className={secondaryButtonClass}>
                Mark all {pending.length} paid
              </ConfirmButton>
            </form>
          )}
          <p className="mt-3 text-sm text-gray-500" data-still-owed={stillOwed}>
            {stillOwed > 0 ? `Still to settle in this group: ${money(stillOwed)}.` : "Everyone in this group is square ✓"}
          </p>
          {stillOwed > 0 && (
            <Link href={`/groups/${group.id}/settle`} className={`mt-3 ${secondaryButtonClass}`}>
              Settle up
            </Link>
          )}
        </section>
  );

  return (
    <>
      <PageHeader title={game.name} back={`/groups/${group.id}?tab=games`} />
      {sp.error && <ErrorNote>{sp.error.slice(0, 200)}</ErrorNote>}
      {sp.started && (
        <Notice tone="success" params={["started"]} className="mb-4">
          Game on! Tap “Give” to buy everyone in. Anyone in the group can add to it.
        </Notice>
      )}
      {sp.saved && (
        <Notice tone="success" params={["saved", "who"]} className="mb-4">
          {sp.saved === "take" ? "Taken from the pot." : "Put back."} Saved.
        </Notice>
      )}
      {sp.bought && (
        <Notice tone="success" params={["bought"]} className="mb-4">
          Bought in{Number(sp.bought) > 1 ? ` for ${Number(sp.bought)} players` : ""}. Saved.
        </Notice>
      )}
      {sp.cashed && (
        <Notice tone="success" params={["cashed", "seat"]} className="mb-4">
          Cashed out.{sp.seat ? " The new player is in their seat." : ""}
        </Notice>
      )}
      {sp.counted && (
        <Notice tone={sp.gap ? undefined : "success"} params={["counted", "gap"]} className="mb-4">
          {sp.gap ? "Count saved, but it doesn’t add up yet. See below." : "Count saved."}
        </Notice>
      )}
      {sp.paid && (
        <Notice tone="success" params={["paid", "did"]} className="mb-4">
          Marked paid ✓ It’s in the group’s balances. If the person paid is on Loopin, they’re asked to confirm.
        </Notice>
      )}
      {sp.allpaid && !sp.undone && <Notice tone="success" params={["allpaid"]} className="mb-4">All marked paid ✓</Notice>}
      {sp.renamed && <Notice params={["renamed"]} className="mb-4">Name fixed everywhere in the group.</Notice>}
      {sp.removed && <Notice params={["removed"]} className="mb-4">Taken off the list.</Notice>}
      {sp.joined && <Notice tone="success" params={["joined"]} className="mb-4">Added to the table.</Notice>}
      {sp.adjusted && <Notice params={["adjusted"]} className="mb-4">Difference fixed. It now adds up.</Notice>}
      {sp.finished && (
        <Notice tone="success" params={["finished"]} className="mb-4">
          Game over! The result is in the group’s balances. Settle up whenever you’re ready.
        </Notice>
      )}
      {sp.reopened && <Notice params={["reopened"]} className="mb-4">Reopened. Its result is out of the balances until you finish it again.</Notice>}

      {/* The pot */}
      <section aria-label="The pot" className="relative overflow-hidden rounded-[24px] px-5 pb-5 pt-5 text-fg [background:radial-gradient(90%_100%_at_100%_0%,#1f6b4a_0%,transparent_60%),linear-gradient(160deg,#123a2a_0%,#0b1612_80%)]">
        <p className="pr-14 text-[11px] font-semibold text-fg/55">
          {potGameLabel(game.game)} · host {youLow(game.hostId)} · {open ? "playing" : "finished"}
        </p>
        {open ? (
          <>
            <p className="mt-2 money text-[40px] font-semibold leading-none tabular-nums" data-pot-out>
              {money(totals.out)}
            </p>
            <p className="mt-1 font-hand text-[21px] font-bold leading-none text-[#ffd9a8]">out of the pot, in play</p>
          </>
        ) : (
          <>
            <p className="mt-2 flex items-center gap-2.5 font-display text-[34px] font-semibold leading-none">
              Game over <TrophyIcon size={30} className="text-[#e8d29a]" />
            </p>
            <p className="mt-1.5 font-hand text-[21px] font-bold leading-none text-[#ffd9a8]">
              {ranked[0] && ranked[0].net > 0 ? `${you(ranked[0].memberId)} won ${money(ranked[0].net)}` : "everyone broke even"}
            </p>
          </>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <p>
            <span className="block text-xs text-fg/55">Taken from the pot</span>
            <span className="font-semibold tabular-nums" data-pot-taken>
              {money(totals.taken)}
            </span>
          </p>
          <p>
            <span className="block text-xs text-fg/55">Put back</span>
            <span className="font-semibold tabular-nums" data-pot-returned>
              {money(totals.returned)}
            </span>
          </p>
        </div>
        <span aria-hidden className="pointer-events-none absolute -right-2 -top-3 select-none text-[70px] opacity-[0.12]">
          {game.game === "poker" ? "♠️" : "🃏"}
        </span>
      </section>

      {/* Who pays whom: first thing you see once it's finished */}
      {!open && whoPays}

      {/* Buy in / top up */}
      {open && (
        <section aria-label="Buy in" className="mt-6 rounded-2xl border border-line p-4">
          <PotBuyIn
            key={live.length}
            gameId={game.id}
            players={players.map((p) => {
              const l = lineOf(p);
              return { id: p, name: you(p), note: l && l.taken ? (playing.includes(p) ? `in ${money(l.taken - l.returned)}` : "out") : "" };
            })}
            allTicked={totals.taken === 0}
            quick={quick}
            currency={group.currency}
          />
        </section>
      )}

      {/* Players */}
      <section aria-label="Players" className="mt-8">
        <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">{open ? "At the table" : "Results"}</h2>
        <ul className="divide-y divide-line">
          {(open ? lines : ranked).map((l) => {
            const still = open && playing.includes(l.memberId);
            const showNet = !open || (l.taken > 0 && !still);
            return (
              <li key={l.memberId} className="py-3" data-player={nameOf(l.memberId)} data-net={l.net} data-playing={still ? "1" : "0"}>
                <div className="flex items-center gap-3">
                  <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fg/[0.08] font-display text-sm font-semibold">
                    {nameOf(l.memberId).charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <PotName
                      gameId={game.id}
                      memberId={l.memberId}
                      name={nameOf(l.memberId)}
                      shown={you(l.memberId)}
                      editable={(() => {
                        const m = group.members.find((x) => x.id === l.memberId);
                        return Boolean(m && !m.leftAt && (m.id === myId || (!m.accountId && !m.claimedAt)));
                      })()}
                    />
                    <span className="block text-xs text-gray-500 tabular-nums">
                      {l.taken === 0
                        ? "not in yet"
                        : `took ${money(l.taken)}${l.takes > 1 ? ` (${l.takes}×)` : ""} · ${still ? (l.returned ? `back ${money(l.returned)} · playing` : "playing") : `back ${money(l.returned)}`}`}
                      {l.adjust ? ` · fix ${l.adjust > 0 ? "+" : "−"}${money(Math.abs(l.adjust))}` : ""}
                    </span>
                  </span>
                  {showNet && (
                    <span className={`shrink-0 text-right font-semibold tabular-nums ${l.net > 0 ? "text-owed" : l.net < 0 ? "text-owe" : "text-gray-500"}`}>
                      {l.net > 0 ? `+${money(l.net)}` : l.net < 0 ? `−${money(-l.net)}` : money(0)}
                      <span className="block text-[11px] font-normal text-gray-500">{l.net > 0 ? "won" : l.net < 0 ? "lost" : "even"}</span>
                    </span>
                  )}
                </div>
                {/* Cash out (leaving early), and maybe someone new takes the seat. Works before the page has loaded. */}
                {still && (
                  <details className="group mt-2 pl-12">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full border border-line px-3 py-1 text-xs font-semibold active:bg-mist [&::-webkit-details-marker]:hidden">
                      Cash out<span aria-hidden className="transition-transform group-open:rotate-180">▾</span>
                    </summary>
                    <form action={cashOutAction} className="mt-3 space-y-2.5 rounded-2xl bg-mist p-3" aria-label={`Cash out ${nameOf(l.memberId)}`}>
                      <input type="hidden" name="gameId" value={game.id} />
                      <input type="hidden" name="memberId" value={l.memberId} />
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-600">{l.memberId === myId ? "You leave" : `${nameOf(l.memberId)} leaves`} with (0 if nothing)</span>
                        <input name="amount" required inputMode="decimal" placeholder="0" autoComplete="off" aria-label="Leaves with" className={inputClass} />
                      </label>
                      <p className="pt-1 text-xs font-medium text-gray-600">Someone taking the seat? (optional)</p>
                      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                        <input name="newName" maxLength={80} placeholder="Their name" autoComplete="off" aria-label="New player in the seat" className={`${inputClass} min-w-0`} />
                        <input name="newAmount" inputMode="decimal" placeholder="Buy-in" autoComplete="off" aria-label="New player's buy-in" className={`${inputClass} min-w-0`} />
                      </div>
                      <button type="submit" className="block w-full rounded-xl bg-fg px-4 py-2.5 text-sm font-semibold text-canvas">
                        Cash out
                      </button>
                    </form>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {open && (
        <form action={addPlayerAction} className="mt-3 flex gap-2" aria-label="Add a player">
          <input type="hidden" name="gameId" value={game.id} />
          <input name="name" maxLength={200} placeholder="Add a player: just a name" aria-label="New player's name" autoComplete="off" className={`${inputClass} flex-1`} />
          <button type="submit" className="shrink-0 rounded-xl border border-line px-4 text-sm font-semibold active:bg-mist">
            Add
          </button>
        </form>
      )}

      {/* End of the game: count everyone still playing in one go */}
      {open && playing.length > 0 && (
        <section aria-label="Count" className="mt-8 rounded-2xl border border-line p-4">
          <PotCount
            key={live.length}
            gameId={game.id}
            rows={playing.map((p) => {
              const l = lineOf(p);
              const took = l?.taken ?? 0;
              const back = l?.returned ?? 0;
              return { id: p, name: you(p), tookText: `took ${money(took)}${back ? `, back ${money(back)}` : ""}`, base: back + (l?.adjust ?? 0) - took };
            })}
            inPlay={totals.out}
            host={host}
            hostName={you(game.hostId)}
            currency={group.currency}
          />
        </section>
      )}

      {/* Everyone's counted: does it add up? */}
      {open && totals.taken > 0 && playing.length === 0 && (
        <section aria-label="Finish" className="mt-6 space-y-3">
          {!totals.balanced && (
            <div className="rounded-2xl border border-owe/40 bg-owe/[0.08] px-4 py-3.5" role="status" data-pot-gap={totals.gap}>
              <p className="text-sm font-semibold text-owe">
                {totals.gap < 0 ? `${gapText} is missing from the pot` : `${gapText} more came back than was taken`}
              </p>
              <p className="mt-0.5 text-xs text-fg/60">
                Taken {money(totals.taken)}, back {money(totals.returned + totals.adjust)}. A wrong count? Tap ✕ on it in the history and count again. {host ? "Or fix the difference:" : "The host can fix the difference."}
              </p>
              {host && (
                <div className="mt-3 space-y-2">
                  <form action={adjustAction} className="flex gap-2">
                    <input type="hidden" name="gameId" value={game.id} />
                    <input type="hidden" name="mode" value="spread" />
                    <input name="note" maxLength={80} placeholder="Why? (optional)" className={`${inputClass} flex-1`} />
                    <button type="submit" className="shrink-0 rounded-xl border border-line px-3 text-sm font-semibold active:bg-mist">
                      Spread it
                    </button>
                  </form>
                  <form action={adjustAction} className="flex gap-2">
                    <input type="hidden" name="gameId" value={game.id} />
                    <input type="hidden" name="mode" value="one" />
                    <select name="memberId" aria-label="Put it on" className={`${inputClass} flex-1`}>
                      {players.map((p) => (
                        <option key={p} value={p}>
                          Put it on {nameOf(p)}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="shrink-0 rounded-xl border border-line px-3 text-sm font-semibold active:bg-mist">
                      Fix
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}
          {host ? (
            form(
              finishGameAction,
              totals.balanced ? "Settle: who pays whom 🏁" : "Settle (when it adds up)",
              `pop block w-full bg-fg px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63] ${totals.balanced ? "" : "opacity-50"}`,
            )
          ) : (
            <p className="text-center text-xs text-gray-500">{you(game.hostId)} (the host) settles the game once it adds up.</p>
          )}
        </section>
      )}

      {/* Everything that happened */}
      {game.moves.length > 0 && (
        <section aria-label="History" className="mt-10">
          <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">History</h2>
          <ul className="divide-y divide-line">
            {[...game.moves].reverse().map((m) => (
              <li key={m.id} className={`flex items-center gap-3 py-2.5 text-sm ${m.deletedAt ? "opacity-50" : ""}`}>
                <span className="w-14 shrink-0 text-xs text-gray-400 tabular-nums">{time(m.createdAt)}</span>
                <span className={`min-w-0 flex-1 ${m.deletedAt ? "line-through" : ""}`}>
                  {you(m.memberId)} {m.kind === "take" ? "took" : m.kind === "return" ? (m.note === CASHED ? "cashed out with" : m.note === COUNTED ? "ended with" : "put back") : "fix"} {m.kind === "adjust" ? `${m.amount > 0 ? "+" : "−"}${money(Math.abs(m.amount))}` : money(m.amount)}
                  <span className="block text-xs text-gray-400">
                    {m.note && m.note !== CASHED && m.note !== COUNTED ? `${m.note} · ` : ""}
                    {m.createdById === m.memberId ? "" : `added by ${youLow(m.createdById)}`}
                  </span>
                </span>
                {open && !m.deletedAt && (m.createdById === myId || host) && (
                  <form action={removeMoveAction}>
                    <input type="hidden" name="gameId" value={game.id} />
                    <input type="hidden" name="moveId" value={m.id} />
                    <ConfirmButton message="Take this off the list?" className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 active:bg-mist">
                      <span aria-label="Take it off">✕</span>
                    </ConfirmButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {host && (
        <section aria-label="Host" className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          {open
            ? form(deleteGameAction, "Delete game", "text-xs text-red-500 underline", "Delete this game? Everything recorded in it goes too.")
            : form(reopenGameAction, "Reopen game", "rounded-full border border-line px-3 py-1.5 text-xs font-semibold active:bg-mist", "Reopen it? Its result comes out of the balances until you finish it again.")}
          <p className="text-xs text-gray-400">You’re the host.</p>
        </section>
      )}
      {showUndo && justDid && (
        <UndoBar key={justDid.id} text={sp.undone ? "Undone." : `${you(justDid.actorId)} ${justDid.text}`} groupId={group.id} eventId={justDid.id} back={`pot:${game.id}`} redo={sp.undone === "1"} />
      )}
    </>
  );
}
