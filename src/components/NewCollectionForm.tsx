"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { createCollectionAction, type CreateState } from "@/app/collect-actions";
import { CurrencySelect } from "./CurrencySelect";
import { PickContacts } from "./PickContacts";
import { FriendPicker } from "./FriendPicker";
import { inputClass, primaryButtonClass } from "./ui";

// New collection: what it's for, how much each, where the money goes (UPI for
// rupees, a PayPal/Venmo/Revolut link otherwise, or neither for cash), by
// when, and who's expected (optional: people can add themselves).
const IDEAS = ["Teacher’s Day gift", "Farewell for Priya", "Saturday turf booking", "Society Diwali fund", "Office birthday cake"];
// One tap fills the name (then add who it's for).
const QUICK = ["Diwali fund", "Birthday gift", "Farewell", "Teacher’s Day", "Trip booking", "Office party", "Wedding gift", "Turf / match"];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={primaryButtonClass}>
      {pending ? "Making your link…" : "Make the link"}
    </button>
  );
}

export function NewCollectionForm({ defaultCurrency, yourName, friends = [] }: { defaultCurrency: string; yourName: string; friends?: { id: string; name: string }[] }) {
  const [state, action] = useActionState<CreateState, FormData>(createCollectionAction, {});
  const [currency, setCurrency] = useState(defaultCurrency);
  const v = state.values ?? {};
  // After an error, the currency follows what was sent (the form shows it again).
  useEffect(() => {
    if (state.values?.currency) setCurrency(state.values.currency);
  }, [state]);
  const shownCurrency = currency;
  const [idea] = useState(() => IDEAS[Math.floor(Date.now() / 86_400_000) % IDEAS.length]);
  const label = "mb-2 block text-sm font-medium text-gray-600";
  const hint = "font-normal text-gray-400";

  return (
    <form
      action={action}
      // Errors come back on this same screen, so the double-tap lock must not block the next try (the button locks itself while sending).
      data-allow-repeat="1"
      className="space-y-6"
      onChange={(e) => {
        const t = e.target;
        if (t instanceof HTMLSelectElement && t.name === "currency") setCurrency(t.value);
      }}
    >
      {state.error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </p>
      )}

      {!yourName && (
        <label className="block">
          <span className={label}>
            Your name <span className={hint}>(shown as who’s collecting)</span>
          </span>
          <input name="yourName" defaultValue={v.yourName} required maxLength={40} placeholder="Your name" autoComplete="given-name" className={inputClass} />
        </label>
      )}

      <label className="block">
        <span className={label}>What are you collecting for?</span>
        <input name="title" defaultValue={v.title} required maxLength={60} placeholder={idea} autoComplete="off" className={inputClass} />
      </label>
      <div className="-mt-3 flex flex-wrap gap-2" aria-label="Quick picks">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            onClick={(e) => {
              const t = e.currentTarget.form?.elements.namedItem("title") as HTMLInputElement | null;
              if (!t) return;
              t.value = q;
              t.focus();
              t.setSelectionRange(q.length, q.length);
            }}
            className="h-8 rounded-full border border-line px-3 text-[13px] text-fg/80 active:bg-mist"
          >
            {q}
          </button>
        ))}
      </div>

      <label className="block">
        <span className={label}>
          Each pays <span className={hint}>(leave empty for any amount)</span>
        </span>
        <input name="amount" defaultValue={v.amount} inputMode="decimal" placeholder={shownCurrency === "INR" ? "₹ 300" : `${shownCurrency} 20`} autoComplete="off" className={`${inputClass} tabular-nums`} />
      </label>

      {shownCurrency === "INR" ? (
        <label className="block">
          <span className={label}>
            Your UPI ID <span className={hint}>(so people pay you in one tap)</span>
          </span>
          <input name="upiId" defaultValue={v.upiId} placeholder="name@okicici or 98xxxxxx@ybl" autoComplete="off" autoCapitalize="none" spellCheck={false} className={inputClass} />
          <span className="mt-1.5 block text-xs text-gray-400">In Google Pay, PhonePe or Paytm, under your profile. Empty = cash.</span>
        </label>
      ) : (
        <label className="block">
          <span className={label}>
            Your pay link <span className={hint}>(optional)</span>
          </span>
          <input name="payLink" defaultValue={v.payLink} inputMode="url" placeholder="paypal.me/yourname" autoComplete="off" autoCapitalize="none" spellCheck={false} className={inputClass} />
          <span className="mt-1.5 block text-xs text-gray-400">PayPal.me, Venmo, Cash App, Revolut or Monzo. Empty = cash or bank transfer.</span>
        </label>
      )}

      {/* Everything else is optional, folded away so making a link takes seconds. */}
      <details className="group/more rounded-2xl border border-line px-4 py-3" open={Boolean(v.dueDate || v.names || v.note || (v.currency && v.currency !== defaultCurrency))}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span>
            More options <span className="font-normal text-gray-400">· who’s in, pay-by date, note, currency</span>
          </span>
          <span aria-hidden className="text-gray-400 transition-transform group-open/more:rotate-180">⌄</span>
        </summary>
        <div className="mt-4 space-y-6">
          <label className="block">
            <span className={label}>
              Who’s chipping in? <span className={hint}>(people can also add themselves)</span>
            </span>
            <textarea name="names" defaultValue={v.names} rows={3} placeholder="One name per line, or paste them with commas" className={`${inputClass} resize-y`} />
          </label>
          <PickContacts key={v.contacts ?? "start"} initial={v.contacts} className="-mt-3" />
          <FriendPicker friends={friends} />

          <label className="block">
            <span className={label}>Pay by</span>
            <input name="dueDate" defaultValue={v.dueDate} type="date" className={inputClass} />
          </label>

          <label className="block">
            <span className={label}>A note for everyone</span>
            <input name="note" defaultValue={v.note} maxLength={300} placeholder="E.g. a plant and a card for her" autoComplete="off" className={inputClass} />
          </label>

          <label className="block min-w-0">
            <span className={label}>Currency</span>
            <CurrencySelect key={v.currency ?? "start"} name="currency" defaultValue={v.currency || defaultCurrency} />
          </label>
        </div>
      </details>

      <Submit />
      <p className="-mt-3 text-center text-xs text-gray-400">People pay you directly and tick their name. Loopin never touches the money. Anyone with the link sees the names on it.</p>
    </form>
  );
}
