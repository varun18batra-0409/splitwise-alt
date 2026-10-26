"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { buyInAction } from "@/app/pot-actions";
import { formatMoney, parseAmount } from "@/lib/money";

// Buy-in: tick who's taking money (everyone, at the start), one amount, one
// tap. The ticks and the amount live in the form's own fields, so what's on
// screen is exactly what's saved, even if tapped before the page has loaded.
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
  const form = useRef<HTMLFormElement>(null);
  const amount = useRef<HTMLInputElement>(null);
  // Only for the words on the button; what's saved comes from the fields.
  const [count, setCount] = useState(allTicked ? players.length : 0);
  const [each, setEach] = useState<number | null>(null);
  const recount = () => setCount(form.current ? form.current.querySelectorAll('input[name="memberIds"]:checked').length : 0);
  const tickAll = (on: boolean) => {
    form.current?.querySelectorAll<HTMLInputElement>('input[name="memberIds"]').forEach((b) => (b.checked = on));
    recount();
  };
  const setAmount = (v: string) => {
    if (amount.current) amount.current.value = v;
    setEach(parseAmount(v, currency));
  };
  const label =
    count === 0
      ? "Tick who’s buying in"
      : each
        ? `Give ${formatMoney(each, currency)} to ${count === 1 ? "1 player" : `${count} players`}${count > 1 ? ` · ${formatMoney(each * count, currency)}` : ""}`
        : `Buy in for ${count === 1 ? "1 player" : `${count} players`}`;

  return (
    <form ref={form} action={buyInAction} className="space-y-3.5" data-allow-repeat="1" aria-label="Buy in">
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
            <input type="checkbox" name="memberIds" value={p.id} defaultChecked={allTicked} onChange={recount} className="sr-only" />
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
            ref={amount}
            name="amount"
            required
            inputMode="decimal"
            defaultValue=""
            placeholder={quick[1]?.value ?? "1000"}
            autoComplete="off"
            aria-label="Amount each"
            onInput={(e) => setEach(parseAmount(e.currentTarget.value, currency))}
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
