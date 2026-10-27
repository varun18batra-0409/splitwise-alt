"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { buyInAction } from "@/app/pot-actions";
import { formatMoney, parseAmount } from "@/lib/money";

// Buy-in: tick who's taking money (everyone, at the start), one amount, one
// tap. What's on screen is what's saved; if the save comes back with a
// problem (a typo in the amount), the ticks and the amount stay as they were.
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="pop block w-full bg-fg px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63] disabled:opacity-60">
      {pending ? "Saving…" : label}
    </button>
  );
}

export function PotBuyIn({
  gameId,
  players,
  allTicked,
  quick,
  currency,
}: {
  gameId: string;
  players: { id: string; name: string; note: string }[];
  allTicked: boolean;
  quick: { value: string; label: string }[];
  currency: string;
}) {
  // Who's ticked and the amount: kept on screen if the save comes back with a problem.
  const [ticked, setTicked] = useState<string[]>(allTicked ? players.map((p) => p.id) : []);
  const [typed, setTyped] = useState("");
  const count = ticked.length;
  const each = typed.trim() ? parseAmount(typed, currency) : null;
  const tickAll = (on: boolean) => setTicked(on ? players.map((p) => p.id) : []);
  const setAmount = (v: string) => setTyped(v);
  const label =
    count === 0
      ? "Tick who’s buying in"
      : each
        ? `Give ${formatMoney(each, currency)} to ${count === 1 ? "1 player" : `${count} players`}${count > 1 ? ` · ${formatMoney(each * count, currency)}` : ""}`
        : `Buy in for ${count === 1 ? "1 player" : `${count} players`}`;

  return (
    <form action={buyInAction} className="space-y-3.5" data-allow-repeat="1" aria-label="Buy in">
      <input type="hidden" name="gameId" value={gameId} />
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">{allTicked ? "Buy in" : "Buy in / top up"}</h2>
        <span className="flex gap-3 text-xs font-semibold text-accent">
          <button type="button" onClick={() => tickAll(true)}>
            Everyone
          </button>
          <button type="button" onClick={() => tickAll(false)}>
            Clear
          </button>
        </span>
      </div>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Who’s taking money</legend>
        {players.map((p) => (
          <label
            key={p.id}
            className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm has-[:checked]:border-fg has-[:checked]:bg-fg has-[:checked]:text-canvas has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent"
          >
            <input type="checkbox" name="memberIds" value={p.id} checked={ticked.includes(p.id)} onChange={(e) => setTicked((t) => (e.target.checked ? [...t, p.id] : t.filter((x) => x !== p.id)))} className="sr-only" />
            <span className="font-semibold">{p.name}</span>
            {p.note && <span className="text-xs opacity-60">{p.note}</span>}
          </label>
        ))}
      </fieldset>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-gray-600">How much each</span>
        <span className="flex items-center gap-2 rounded-xl border border-line bg-mist px-4 focus-within:border-accent">
          <span className="text-sm text-gray-400">{currency}</span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="w-full bg-transparent py-3 font-display text-xl tabular-nums outline-none"
          />
        </span>
      </label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick amounts">
        {quick.map((q) => (
          <button key={q.value} type="button" onClick={() => setAmount(q.value)} className="rounded-full border border-line px-3.5 py-1.5 text-sm font-semibold tabular-nums active:bg-mist">
            {q.label}
          </button>
        ))}
      </div>
      <Submit label={label} />
    </form>
  );
}
