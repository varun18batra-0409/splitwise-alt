"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createCollectionAction, type CreateState } from "@/app/collect-actions";
import { CurrencySelect } from "./CurrencySelect";
import { inputClass, primaryButtonClass } from "./ui";

// New collection: what it's for, how much each, where the money goes (UPI for
// rupees, a PayPal/Venmo/Revolut link otherwise, or neither for cash), by
// when, and who's expected (optional: people can add themselves).
const IDEAS = ["Teacher’s Day gift", "Farewell for Priya", "Saturday turf booking", "Society Diwali fund", "Office birthday cake"];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={primaryButtonClass}>
      {pending ? "Making your link…" : "Make the link"}
    </button>
  );
}

export function NewCollectionForm({ defaultCurrency, yourName }: { defaultCurrency: string; yourName: string }) {
  const [state, action] = useActionState<CreateState, FormData>(createCollectionAction, {});
  const [currency, setCurrency] = useState(defaultCurrency);
  const [idea] = useState(() => IDEAS[Math.floor(Date.now() / 86_400_000) % IDEAS.length]);
  const label = "mb-2 block text-sm font-medium text-gray-600";
  const hint = "font-normal text-gray-400";

  return (
    <form
      action={action}
      className="space-y-6"
      onChange={(e) => {
        const t = e.target as HTMLSelectElement;
        if (t.name === "currency") setCurrency(t.value);
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
          <input name="yourName" required maxLength={40} placeholder="Your name" autoComplete="given-name" className={inputClass} />
        </label>
      )}

      <label className="block">
        <span className={label}>What are you collecting for?</span>
        <input name="title" required maxLength={60} placeholder={idea} autoComplete="off" className={inputClass} />
      </label>

      <div className="grid grid-cols-[1fr_1.25fr] gap-3">
        <label className="block">
          <span className={label}>
            Each pays <span className={hint}>(optional)</span>
          </span>
          <input name="amount" inputMode="decimal" placeholder="Any amount" autoComplete="off" className={`${inputClass} tabular-nums`} />
        </label>
        <label className="block min-w-0">
          <span className={label}>Currency</span>
          <CurrencySelect name="currency" defaultValue={defaultCurrency} />
        </label>
      </div>

      {currency === "INR" ? (
        <label className="block">
          <span className={label}>
            Your UPI ID <span className={hint}>(so people can pay you in one tap)</span>
          </span>
          <input name="upiId" placeholder="name@okicici or 98xxxxxx@ybl" autoComplete="off" autoCapitalize="none" spellCheck={false} className={inputClass} />
          <span className="mt-1.5 block text-xs text-gray-400">Find it in Google Pay, PhonePe or Paytm under your profile. Leave it empty for cash.</span>
        </label>
      ) : (
        <label className="block">
          <span className={label}>
            Your pay link <span className={hint}>(optional)</span>
          </span>
          <input name="payLink" inputMode="url" placeholder="paypal.me/yourname" autoComplete="off" autoCapitalize="none" spellCheck={false} className={inputClass} />
          <span className="mt-1.5 block text-xs text-gray-400">PayPal.me, Venmo, Cash App, Revolut or Monzo. Leave it empty for cash or bank transfer.</span>
        </label>
      )}

      <label className="block">
        <span className={label}>
          Pay by <span className={hint}>(optional)</span>
        </span>
        <input name="dueDate" type="date" className={inputClass} />
      </label>

      <label className="block">
        <span className={label}>
          Who’s chipping in? <span className={hint}>(optional)</span>
        </span>
        <textarea name="names" rows={4} placeholder={"One name per line, or paste them with commas.\nPeople not on the list can add themselves."} className={`${inputClass} resize-y`} />
      </label>

      <label className="block">
        <span className={label}>
          A note for everyone <span className={hint}>(optional)</span>
        </span>
        <input name="note" maxLength={300} placeholder="E.g. we’re getting her a plant and a card" autoComplete="off" className={inputClass} />
      </label>

      <p className="rounded-xl bg-mist px-4 py-3 text-sm text-gray-500">
        You’ll get a link to drop in your WhatsApp group. People pay you directly, then tick their name. Loopin never touches the money.
        Anyone with the link can see the names on the list.
      </p>
      <Submit />
    </form>
  );
}
