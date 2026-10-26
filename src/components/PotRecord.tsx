"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { recordMoveAction } from "@/app/pot-actions";
import { inputClass } from "./ui";

// "Take from the pot" / "Put back": who, how much (with quick amounts), and an optional note.
function Submit({ kind }: { kind: "take" | "return" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="pop block w-full bg-fg px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63] disabled:opacity-60">
      {pending ? "Saving…" : kind === "take" ? "Take from the pot" : "Put back"}
    </button>
  );
}

export function PotRecord({
  gameId,
  players,
  me,
  who,
  kind: startKind = "take",
  quick,
  currency,
}: {
  gameId: string;
  players: { id: string; name: string }[];
  me: string;
  who?: string;
  kind?: "take" | "return";
  quick: { value: string; label: string }[];
  currency: string;
}) {
  const [kind, setKind] = useState<"take" | "return">(startKind);
  const [amount, setAmount] = useState("");
  const [person, setPerson] = useState(players.some((p) => p.id === who) ? who! : players.some((p) => p.id === me) ? me : (players[0]?.id ?? ""));
  const tab = (on: boolean) => `flex-1 rounded-lg py-2.5 text-center text-sm ${on ? "bg-fg font-semibold text-canvas" : "text-gray-500"}`;
  return (
    <form action={recordMoveAction} className="space-y-3.5" data-allow-repeat="1" aria-label="Record money">
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-mist p-1" role="radiogroup" aria-label="Take or put back">
        <button type="button" role="radio" aria-checked={kind === "take"} onClick={() => setKind("take")} className={tab(kind === "take")}>
          Take from the pot
        </button>
        <button type="button" role="radio" aria-checked={kind === "return"} onClick={() => setKind("return")} className={tab(kind === "return")}>
          Put back
        </button>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-gray-600">Who</span>
        <select name="memberId" value={person} onChange={(e) => setPerson(e.target.value)} className={inputClass}>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === me ? `${p.name} (you)` : p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-gray-600">{kind === "take" ? "How much they took" : "How much they put back (0 if nothing)"}</span>
        <span className="flex items-center gap-2 rounded-xl border border-line bg-mist px-4 focus-within:border-accent">
          <span className="text-sm text-gray-400">{currency}</span>
          <input
            name="amount"
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={kind === "take" ? quick[1]?.value ?? "1000" : "0"}
            autoComplete="off"
            aria-label="Amount"
            className="w-full bg-transparent py-3 font-display text-xl tabular-nums outline-none"
          />
        </span>
      </label>
      {kind === "take" && (
        <div className="flex flex-wrap gap-2" aria-label="Quick amounts">
          {quick.map((q) => (
            <button key={q.value} type="button" onClick={() => setAmount(q.value)} className="rounded-full border border-line px-3.5 py-1.5 text-sm font-semibold tabular-nums active:bg-mist">
              {q.label}
            </button>
          ))}
        </div>
      )}
      <input name="note" maxLength={80} placeholder="Note (optional): “second buy-in”" autoComplete="off" className={inputClass} />
      <Submit kind={kind} />
    </form>
  );
}
