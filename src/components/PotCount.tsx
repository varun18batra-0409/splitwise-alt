"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { countOutAction } from "@/app/pot-actions";
import { formatMoney, parseAmount } from "@/lib/money";

// The end of the game: one line per player still at the table, type what each
// has in front of them, and the host taps "Calculate & settle". As you type it
// shows who's up or down and whether it all adds up.
function Submit({ host }: { host: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="settle"
      value={host ? "1" : "0"}
      disabled={pending}
      className="pop block w-full bg-fg px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63] disabled:opacity-60"
    >
      {pending ? "Working it out…" : host ? "Calculate & settle 🏁" : "Save the count"}
    </button>
  );
}

const zero = (s: string) => /^0+([.,]0*)?$/.test(s.trim());

export function PotCount({
  gameId,
  rows,
  inPlay,
  host,
  hostName,
  currency,
}: {
  gameId: string;
  // base = what they've put back so far minus what they've taken (so base + count = up or down)
  rows: { id: string; name: string; tookText: string; base: number }[];
  inPlay: number;
  host: boolean;
  hostName: string;
  currency: string;
}) {
  const money = (n: number) => formatMoney(n, currency);
  // Only for the preview; what's saved comes from the fields.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const value = (id: string) => {
    const t = typed[id] ?? "";
    if (!t.trim()) return null;
    return zero(t) ? 0 : parseAmount(t, currency);
  };
  const filled = rows.filter((r) => value(r.id) !== null);
  const counted = filled.reduce((s, r) => s + (value(r.id) ?? 0), 0);
  const all = filled.length === rows.length;
  const gap = counted - inPlay;

  return (
    <form action={countOutAction} className="space-y-3" data-allow-repeat="1" aria-label="Count the money">
      <input type="hidden" name="gameId" value={gameId} />
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight">Game over? Count the money</h2>
        <p className="mt-0.5 text-sm text-gray-500">What does each player have in front of them? 0 if they lost it all.</p>
      </div>
      <ul className="divide-y divide-line rounded-2xl border border-line">
        {rows.map((r) => {
          const v = value(r.id);
          const net = v === null ? null : r.base + v;
          return (
            <li key={r.id} className="flex items-center gap-3 px-3.5 py-2.5" data-count-row={r.name}>
              <input type="hidden" name="memberId" value={r.id} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.name}</span>
                <span className="block text-xs text-gray-500 tabular-nums">{r.tookText}</span>
              </span>
              <span className="w-[4.5rem] shrink-0 text-right text-xs font-semibold tabular-nums">
                {net === null ? "" : net > 0 ? <span className="text-owed">+{money(net)}</span> : net < 0 ? <span className="text-owe">−{money(-net)}</span> : <span className="text-gray-500">even</span>}
              </span>
              <span className="flex w-28 shrink-0 items-center gap-1 rounded-xl border border-line bg-mist px-2.5 focus-within:border-accent">
                <span className="text-xs text-gray-400">{currency}</span>
                <input
                  name={`count_${r.id}`}
                  inputMode="decimal"
                  defaultValue=""
                  placeholder="0"
                  autoComplete="off"
                  aria-label={r.name === "You" ? "You have" : `${r.name} has`}
                  onInput={(e) => {
                    const v2 = e.currentTarget.value;
                    setTyped((t) => ({ ...t, [r.id]: v2 }));
                  }}
                  className="w-full bg-transparent py-2.5 text-right font-display text-lg tabular-nums outline-none"
                />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-sm tabular-nums" role="status" data-count-check={all ? gap : ""}>
        {!filled.length ? (
          <span className="text-gray-500">{money(inPlay)} is on the table.</span>
        ) : !all ? (
          <span className="text-gray-500">
            Counted {money(counted)} of {money(inPlay)} · {rows.length - filled.length} to go
          </span>
        ) : gap === 0 ? (
          <span className="font-semibold text-owed">Adds up ✓ {money(inPlay)}</span>
        ) : (
          <span className="font-semibold text-owe">{gap < 0 ? `${money(-gap)} short. Check the counts (or fix it after).` : `${money(gap)} too much. Check the counts (or fix it after).`}</span>
        )}
      </p>
      <Submit host={host} />
      {!host && <p className="text-center text-xs text-gray-500">{hostName} (the host) taps Calculate & settle once everyone’s counted.</p>}
    </form>
  );
}
