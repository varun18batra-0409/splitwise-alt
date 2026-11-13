"use client";

import { useState } from "react";
import { recordCustomPayment } from "@/app/actions";
import { currencySign, groupDigits } from "@/lib/add-expense-sentence";
import { recordButtonLabel } from "@/lib/pay-words";

// Record a payment, drawn as a ticket being filled in: From (avatar, name) ┄ ✈ To, the amount, a perforation, then what Smart Settle suggests.
// Tapping From or To opens the same list of people as before (radio buttons named fromId / toId, in the DOM even when folded away).
// The form sends exactly the fields it always did: groupId, back (from Settle up), rid, fromId, toId, amount and over. Nothing here changes what is saved.
type Person = { id: string; name: string; me: boolean; gets: string };

const CARD = "rounded-[20px] border border-[#26262c] bg-[#16161a]";
const chip = "min-h-11 items-center gap-2 rounded-full border border-fg/15 px-4 py-2 text-sm font-medium text-fg/55 has-[:checked]:border-[1.5px] has-[:checked]:border-fg has-[:checked]:text-fg";

export function RecordPaymentForm({
  groupId,
  currency,
  people,
  defaultFrom,
  defaultTo,
  defaultAmount,
  fromSettle,
  keyField,
  mark,
  overLine,
  cancel,
  note,
  children,
}: {
  groupId: string;
  currency: string;
  people: Person[];
  defaultFrom: string;
  defaultTo: string;
  defaultAmount: string;
  fromSettle: boolean;
  keyField: React.ReactNode; // the server's <FreshKey name="rid" />
  mark: React.ReactNode; // the drawn mark on the route line
  overLine: string | null;
  cancel: React.ReactNode; // the existing Cancel link (focused first when the amount is more than what is owed)
  note: string;
  children?: React.ReactNode; // Smart Settle's suggestions, drawn by the page (links that fill this form)
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [amount, setAmount] = useState(defaultAmount);
  const [focused, setFocused] = useState(false);
  // Folded away until tapped; From and To open independently. With nobody picked to be paid yet, the To list starts open.
  // (A refused submit with To empty opens it, below, since a folded-away required choice can't be focused.)
  const [open, setOpen] = useState<"from" | "to" | null>(defaultTo ? null : "to");

  const who = (id: string) => people.find((p) => p.id === id);
  const label = (id: string) => (who(id)?.me ? "You" : who(id)?.name ?? "");
  const payer = who(from);
  const button = recordButtonLabel(amount, currency, payer ? { name: payer.name, me: payer.me } : null);
  const shown = focused ? amount : groupDigits(amount, currency);

  const side = (which: "from" | "to", id: string, caption: string) => {
    const p = who(id);
    return (
      <button
        type="button"
        onClick={() => setOpen(open === which ? null : which)}
        aria-expanded={open === which}
        data-pick={which}
        className="flex min-h-11 min-w-0 flex-col items-center gap-1 px-1 active:opacity-70"
      >
        <span className="text-[12.5px] text-fg/55">{caption}</span>
        <span aria-hidden className="grid h-12 w-12 place-items-center rounded-full bg-mist text-[17px] font-bold text-fg/80">
          {p ? p.name.trim().charAt(0).toUpperCase() : "?"}
        </span>
        <span className="max-w-[7rem] truncate text-[14px] font-semibold">
          {p ? label(id) : "Choose"} <span aria-hidden className="text-fg/55">▾</span>
        </span>
      </button>
    );
  };

  return (
    <form action={recordCustomPayment}>
      <input type="hidden" name="groupId" value={groupId} />
      {fromSettle && <input type="hidden" name="back" value="settle" />}
      {keyField}

      <div className={`${CARD} px-4 pb-0 pt-4`}>
        <div className="flex items-start justify-between gap-2">
          {side("from", from, "From")}
          <span aria-hidden className="mt-[38px] flex min-w-0 flex-1 items-center gap-2">
            <i className="h-px min-w-3 flex-1 [background:repeating-linear-gradient(90deg,#4a4a52_0_4px,transparent_4px_8px)]" />
            {mark}
          </span>
          {side("to", to, "To")}
        </div>

        {/* The existing people lists. They stay in the page (so what is chosen is always sent), folded away until From or To is tapped. */}
        <fieldset hidden={open !== "from"} className="mt-3">
          <legend className="mb-2 text-sm font-medium text-fg/60">Who paid?</legend>
          <div className="flex flex-wrap gap-2">
            {people.map((m) => (
              <label key={m.id} className={`${chip} flex`}>
                <input
                  type="radio"
                  name="fromId"
                  value={m.id}
                  checked={from === m.id}
                  onChange={() => {
                    setFrom(m.id);
                    if (to === m.id) setTo("");
                    setOpen(to && to !== m.id ? null : "to");
                  }}
                  onInvalid={() => setOpen("from")}
                  className="sr-only"
                  required
                />
                {m.me ? "You" : m.name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset hidden={open !== "to"} className="mt-3">
          <legend className="mb-2 text-sm font-medium text-fg/60">Paid to</legend>
          <div className="flex flex-wrap gap-2">
            {people.map((m) => (
              // The payer can't also be the one paid, so their chip is hidden here.
              <label key={m.id} className={`${chip} ${m.id === from ? "hidden" : "flex"}`} data-to={m.id}>
                <input
                  type="radio"
                  name="toId"
                  value={m.id}
                  checked={to === m.id}
                  onChange={() => {
                    setTo(m.id);
                    setOpen(null);
                  }}
                  onInvalid={() => setOpen("to")}
                  className="sr-only"
                  required
                />
                {m.me ? "You" : m.name}
                {m.gets && <span className="text-xs opacity-80">{m.me ? "get" : "gets"} {m.gets}</span>}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col items-center pb-5 pt-5 text-center">
          <div className="flex w-full items-baseline justify-center gap-1.5 text-[clamp(34px,10vw,40px)] leading-[1.05]">
            <span aria-hidden className="font-display text-[0.55em] font-semibold text-fg/55">
              {currencySign(currency)}
            </span>
            <input
              name="amount"
              required
              inputMode="decimal"
              placeholder="0"
              autoComplete="off"
              aria-label={`Amount (${currency})`}
              value={shown}
              onChange={(e) => setAmount(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              size={Math.max(2, shown.length + 1)}
              className="min-w-0 max-w-full bg-transparent text-center font-display font-semibold tracking-[-0.02em] text-fg caret-fg outline-none placeholder:text-fg/25 focus-visible:shadow-[inset_0_-1px_0_0_rgb(244_242_236/0.22)]"
            />
          </div>
          <p className="mt-2 text-xs text-fg/55">Full or part. You can record the rest later.</p>
        </div>

        {/* The tear-off part: a perforation with a bite at each side, then Smart Settle's suggestions. */}
        {children && (
          <div className="relative -mx-4 border-t-2 border-dashed border-[#34343b] px-4 pb-2 pt-3">
            <span aria-hidden className="absolute -left-[11px] -top-[11px] h-5 w-5 rounded-full bg-canvas shadow-[inset_0_0_0_1px_#26262c]" />
            <span aria-hidden className="absolute -right-[11px] -top-[11px] h-5 w-5 rounded-full bg-canvas shadow-[inset_0_0_0_1px_#26262c]" />
            {children}
          </div>
        )}
      </div>

      <div className="mt-5">
        {/* Asked once when the amount is more than the payer owes. Cancel is first and has the focus; nothing is saved. */}
        {overLine ? (
          <>
            {/* Pressing Enter after changing the amount checks it again (it never counts as "Record anyway"). */}
            <button type="submit" tabIndex={-1} aria-hidden className="sr-only">
              Check and record
            </button>
            <div role="alert" className={`${CARD} px-4 py-3 text-sm`} data-over-warning>
              <p>{overLine}</p>
              <div className="mt-3 flex gap-2">
                {cancel}
                <button type="submit" name="over" value="1" className="inline-flex min-h-11 items-center rounded-full border border-fg/25 px-4 text-sm font-semibold" data-over-record>
                  Record anyway
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <button type="submit" className="pop block w-full bg-fg px-5 py-3.5 text-center text-base font-semibold text-canvas disabled:opacity-50">
              {button}
            </button>
            {/* Said aloud as the amount or the payer changes (the button's own label is read only when it is reached). */}
            <p className="sr-only" aria-live="polite" data-record-live>
              {button === "Record payment" ? "" : button.replace(/^Record /, "Will record ")}
            </p>
          </>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-fg/55">{note}</p>
    </form>
  );
}
