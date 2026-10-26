import { notFound, redirect } from "next/navigation";
import Link from "@/components/Link";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { ErrorNote, PageHeader, inputClass, secondaryButtonClass } from "@/components/ui";
import { Notice } from "@/components/Notice";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PotRecord } from "@/components/PotRecord";
import { adjustAction, deleteGameAction, finishGameAction, removeMoveAction, reopenGameAction } from "@/app/pot-actions";
import { loadGame } from "@/lib/pot-db";
import { parsePlayers, potGameLabel, potSummary, potTransfers } from "@/lib/pot";
import { netBalances } from "@/lib/balances";
import { decimalsOf, formatMoney } from "@/lib/money";
import { getTimeZone } from "@/lib/tz";

// One game of The Pot: money taken and put back, live; then who won, who
// lost and who pays whom. Settling up happens in the group, as always.

type SP = { error?: string; started?: string; saved?: string; who?: string; kind?: string; removed?: string; adjusted?: string; finished?: string; reopened?: string };

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
  const players = parsePlayers(game.players);
  const live = game.moves.filter((m) => !m.deletedAt);
  const { lines, totals } = potSummary(players, live);
  const open = game.status === "open";
  const host = game.hostId === myId;
  const transfers = open || !totals.balanced ? [] : potTransfers(lines);
  const ranked = [...lines].sort((a, b) => b.net - a.net);
  const notBack = lines.filter((l) => l.taken > 0 && !l.returnedYet);
  const time = (d: Date) => d.toLocaleTimeString("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  // Quick amounts: ₹500 / 1,000 / 2,000 (or 10 / 20 / 50 in other currencies).
  const unit = 10 ** decimalsOf(group.currency);
  const quick = (group.currency === "INR" ? [500, 1000, 2000, 5000] : [10, 20, 50, 100]).map((n) => ({ value: String(n), label: formatMoney(n * unit, group.currency) }));
  const gapText = formatMoney(Math.abs(totals.gap), group.currency);

  // Once finished: what's still owed in the whole group (all games), and who has paid up since.
  let stillOwed = 0;
  let groupNet: Record<string, number> = {};
  if (!open) {
    const [expenses, payments] = await Promise.all([
      db.expense.findMany({ where: { groupId: group.id, deletedAt: null }, include: { shares: true } }),
      db.payment.findMany({ where: { groupId: group.id, deletedAt: null } }),
    ]);
    groupNet = netBalances(group.members.map((m) => m.id), expenses, payments);
    stillOwed = Object.values(groupNet).reduce((s, v) => s + (v > 0 ? v : 0), 0);
  }

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

  return (
    <>
      <PageHeader title={game.name} back={`/groups/${group.id}?tab=games`} />
      {sp.error && <ErrorNote>{sp.error.slice(0, 200)}</ErrorNote>}
      {sp.started && (
        <Notice tone="success" params={["started"]} className="mb-4">
          Game on! Record what each person takes from the pot. Everyone in the group can add to it.
        </Notice>
      )}
      {sp.saved && (
        <Notice tone="success" params={["saved", "who"]} className="mb-4">
          {sp.saved === "take" ? "Taken from the pot." : "Put back."} Saved.
        </Notice>
      )}
      {sp.removed && <Notice params={["removed"]} className="mb-4">Taken off the list.</Notice>}
      {sp.adjusted && <Notice params={["adjusted"]} className="mb-4">Difference fixed. It now adds up.</Notice>}
      {sp.finished && (
        <Notice tone="success" params={["finished"]} className="mb-4">
          Game over! The result is in the group’s balances. Settle up whenever you’re ready.
        </Notice>
      )}
      {sp.reopened && <Notice params={["reopened"]} className="mb-4">Reopened. Its result is out of the balances until you finish it again.</Notice>}

      {/* The pot */}
      <section aria-label="The pot" className="relative overflow-hidden rounded-[24px] px-5 pb-5 pt-5 text-fg [background:radial-gradient(90%_100%_at_100%_0%,#1f6b4a_0%,transparent_60%),linear-gradient(160deg,#123a2a_0%,#0b1612_80%)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg/55">
          {potGameLabel(game.game)} · host {you(game.hostId)} · {open ? "playing" : "finished"}
        </p>
        {open ? (
          <>
            <p className="mt-2 font-display text-[40px] font-semibold leading-none tabular-nums" data-pot-out>
              {money(totals.out)}
            </p>
            <p className="mt-1 font-hand text-[21px] font-bold leading-none text-[#ffd9a8]">out of the pot, in play</p>
          </>
        ) : (
          <>
            <p className="mt-2 font-display text-[34px] font-semibold leading-none">Game over 🏆</p>
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

      {/* Record money */}
      {open && (
        <section aria-label="Record" className="mt-6 rounded-2xl border border-line p-4">
          <PotRecord
            key={live.length}
            gameId={game.id}
            players={players.map((p) => ({ id: p, name: nameOf(p) }))}
            me={myId}
            who={sp.who}
            kind={sp.kind === "return" ? "return" : "take"}
            quick={quick}
            currency={group.currency}
          />
        </section>
      )}

      {/* Players */}
      <section aria-label="Players" className="mt-8">
        <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">{open ? "At the table" : "Results"}</h2>
        <ul className="divide-y divide-line">
          {(open ? lines : ranked).map((l) => (
            <li key={l.memberId} className="flex items-center gap-3 py-3" data-player={nameOf(l.memberId)} data-net={l.net}>
              <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fg/[0.08] font-display text-sm font-semibold">
                {nameOf(l.memberId).charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{you(l.memberId)}</span>
                <span className="block text-xs text-gray-500 tabular-nums">
                  took {money(l.taken)}
                  {l.takes > 1 ? ` (${l.takes}×)` : ""} · {l.returnedYet ? `back ${money(l.returned)}` : "not back yet"}
                  {l.adjust ? ` · fix ${l.adjust > 0 ? "+" : "−"}${money(Math.abs(l.adjust))}` : ""}
                </span>
              </span>
              {(l.returnedYet || !open) && (
                <span className={`shrink-0 text-right font-semibold tabular-nums ${l.net > 0 ? "text-owed" : l.net < 0 ? "text-owe" : "text-gray-500"}`}>
                  {l.net > 0 ? `+${money(l.net)}` : l.net < 0 ? `−${money(-l.net)}` : money(0)}
                  <span className="block text-[11px] font-normal text-gray-500">{l.net > 0 ? "won" : l.net < 0 ? "lost" : "even"}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Does it add up? */}
      {open && totals.taken > 0 && (
        <section aria-label="Finish" className="mt-6 space-y-3">
          {notBack.length > 0 && (
            <p className="rounded-xl bg-mist px-4 py-3 text-sm text-gray-500">
              Not put back yet: {notBack.map((l) => you(l.memberId)).join(", ")}. Put back 0 for anyone who lost it all.
            </p>
          )}
          {totals.returned > 0 && !totals.balanced && (
            <div className="rounded-2xl border border-owe/40 bg-owe/[0.08] px-4 py-3.5" role="status" data-pot-gap={totals.gap}>
              <p className="text-sm font-semibold text-owe">
                {totals.gap < 0 ? `${gapText} is missing from the pot` : `${gapText} more came back than was taken`}
              </p>
              <p className="mt-0.5 text-xs text-fg/60">
                Taken {money(totals.taken)}, back {money(totals.returned + totals.adjust)}. Check the amounts above. {host ? "Or fix the difference:" : "The host can fix the difference."}
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
              totals.balanced ? "Finish the game 🏁" : "Finish (when it adds up)",
              `pop block w-full bg-fg px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63] ${totals.balanced ? "" : "opacity-50"}`,
            )
          ) : (
            <p className="text-center text-xs text-gray-500">{you(game.hostId)} (the host) finishes the game once it adds up.</p>
          )}
        </section>
      )}

      {/* Who pays whom */}
      {!open && (
        <section aria-label="Who pays whom" className="mt-8">
          <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">Who pays whom</h2>
          {transfers.length === 0 ? (
            <p className="rounded-xl bg-mist px-4 py-3 text-sm text-gray-500">Nobody owes anybody for this game.</p>
          ) : (
            <ul className="space-y-2">
              {transfers.map((t) => {
                const done = (groupNet[t.from] ?? 0) >= 0;
                return (
                  <li key={`${t.from}-${t.to}`} className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3" data-transfer={done ? "paid" : "pending"}>
                    <span className="min-w-0 flex-1 text-sm">
                      <strong className="font-semibold">{you(t.from)}</strong> {t.from === myId ? "pay" : "pays"} <strong className="font-semibold">{you(t.to)}</strong>
                    </span>
                    <span className="font-semibold tabular-nums">{money(t.amount)}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${done ? "bg-owed/[0.14] text-owed" : "bg-fg/[0.08] text-fg/60"}`}>{done ? "paid ✓" : "pending"}</span>
                  </li>
                );
              })}
            </ul>
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
                  {you(m.memberId)} {m.kind === "take" ? (m.memberId === myId ? "took" : "took") : m.kind === "return" ? "put back" : "fix"} {m.kind === "adjust" ? `${m.amount > 0 ? "+" : "−"}${money(Math.abs(m.amount))}` : money(m.amount)}
                  <span className="block text-xs text-gray-400">
                    {m.note ? `${m.note} · ` : ""}
                    {m.createdById === m.memberId ? "" : `added by ${you(m.createdById)}`}
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
    </>
  );
}
