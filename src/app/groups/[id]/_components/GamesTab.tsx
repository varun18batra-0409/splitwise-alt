import Link from "@/components/Link";
import type { GroupView } from "./view";
import { parsePlayers, potGameLabel, potSummary, POT_GAMES } from "@/lib/pot";
import type { loadGames } from "@/lib/pot-db";

type Game = Awaited<ReturnType<typeof loadGames>>[number];

// A Pot group's games: the one being played first, then the finished ones
// with how each went for you.
export function GamesTab({ v, games, toSettle = {} }: { v: GroupView; games: Game[]; toSettle?: Record<string, number> }) {
  const { group, myId, money, nameOf } = v;
  const open = games.filter((g) => g.status === "open");
  const done = games.filter((g) => g.status === "done");
  const closed = group.closed;
  return (
    <section aria-label="Games">
      <p className="mb-4 text-sm text-gray-500">
        Take money from the pot to play, put back what’s left. Loopin works out who won and who pays whom. It never holds or moves money.
      </p>
      {!closed && (
        <Link href={`/groups/${group.id}/pot/new`} className="pop mb-6 flex items-center justify-center gap-2 bg-fg px-4 py-3.5 text-base font-semibold text-canvas [--pop-edge:#6e6b63]">
          <span aria-hidden>🃏</span> Start a game
        </Link>
      )}
      {games.length === 0 && (
        <p className="rounded-2xl bg-mist px-4 py-8 text-center text-sm text-gray-500">
          No games yet. Start one when you sit down to play: {POT_GAMES.map((g) => g.label).join(" or ")}.
        </p>
      )}
      {[
        { title: "Playing now", list: open },
        { title: "Finished", list: done },
      ]
        .filter((s) => s.list.length)
        .map((s) => (
          <div key={s.title} className="mb-7">
            <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">{s.title}</h2>
            <ul className="space-y-2.5">
              {s.list.map((g) => {
                const players = parsePlayers(g.players);
                const { lines, totals } = potSummary(players, g.moves);
                const mine = lines.find((l) => l.memberId === myId);
                const top = [...lines].sort((a, b) => b.net - a.net)[0];
                return (
                  <li key={g.id}>
                    <Link href={`/groups/${group.id}/pot/${g.id}`} className="flex items-center gap-3.5 rounded-2xl border border-line px-4 py-3.5 active:bg-mist" data-game={g.status}>
                      <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#1f6b4a]/25 text-xl ring-1 ring-inset ring-[#2f8a62]/40">
                        {g.game === "poker" ? "♠️" : "🃏"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{g.name}</span>
                        <span className="block truncate text-xs text-gray-500">
                          {potGameLabel(g.game)} · {g.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: v.tz })} · {players.length} players
                          {g.status === "open" ? ` · ${money(totals.taken)} taken` : top && top.net > 0 ? ` · ${nameOf(top.memberId)} won ${money(top.net)}` : ""}
                        </span>
                        {/* Which nights still need sorting out. */}
                        {g.status === "done" && g.id in toSettle && (
                          toSettle[g.id] > 0 ? (
                            <span className="mt-1 inline-block rounded-full bg-owe/[0.14] px-2 py-0.5 text-[11px] font-semibold text-owe" data-to-settle={toSettle[g.id]}>
                              {money(toSettle[g.id])} to settle
                            </span>
                          ) : (
                            <span className="mt-1 inline-block rounded-full bg-owed/[0.14] px-2 py-0.5 text-[11px] font-semibold text-owed" data-to-settle="0">
                              Settled ✓
                            </span>
                          )
                        )}
                      </span>
                      {g.status === "done" && mine ? (
                        <span className={`shrink-0 text-right text-sm font-semibold tabular-nums ${mine.net > 0 ? "text-owed" : mine.net < 0 ? "text-owe" : "text-gray-500"}`}>
                          {mine.net > 0 ? `+${money(mine.net)}` : mine.net < 0 ? `−${money(-mine.net)}` : "even"}
                          <span className="block text-[11px] font-normal text-gray-500">{mine.net > 0 ? "you won" : mine.net < 0 ? "you lost" : "for you"}</span>
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-owed/[0.14] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-owed">Live</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
    </section>
  );
}
