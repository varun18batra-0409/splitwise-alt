"use client";

import { useState } from "react";
import { createGroup } from "@/app/actions";
import { GROUP_TYPES, ratioFromIncomes, type GroupType } from "@/lib/group-types";
import { CurrencySelect } from "./CurrencySelect";
import { CoverPicker } from "./CoverPicker";
import { TripDates } from "./TripDates";
import { GroupCover } from "./GroupCover";
import { coverOf, isCoverChoice, type CoverChoice } from "@/lib/covers";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "./ui";
import Link from "./Link";

const ICONS: Record<GroupType, React.ReactNode> = {
  trip: <path d="M2 16l20-7-4-2-6 2-6-4-2 1 4 5-4 1-2-1-1 1zM3 21h18" />,
  home: <path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5" />,
  couple: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  pot: <path d="M8 3h9a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12.5 8 9.5 12l3 4 3-4zM3 7.5l3-1" />,
  other: <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={3} />,
};

// New group in two short steps: what it's for + name, then (couples only)
// how the two of you share costs. Incomes never leave the phone: only the
// resulting split is sent.
export function NewGroupForm({
  defaultCurrency,
  yourName,
  initialName,
  initialType = "trip",
  initialCover = "",
}: {
  defaultCurrency: string;
  yourName: string;
  initialName: string;
  initialType?: GroupType;
  initialCover?: string;
}) {
  const [type, setType] = useState<GroupType>(initialType);
  // The picture follows the type until you pick one yourself.
  const [picked, setPicked] = useState<CoverChoice | null>(isCoverChoice(initialCover) ? initialCover : null);
  const cover = picked ?? coverOf({ type });
  // Your own photo, picked before the group exists (shown here; saved with the group).
  const [ownSrc, setOwnSrc] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(initialName);
  const [mode, setMode] = useState<"equal" | "income" | "custom">("equal");
  const [mine, setMine] = useState("");
  const [theirs, setTheirs] = useState("");
  const [custom, setCustom] = useState("60");
  const num = (s: string) => Number(s.replace(/[^\d.]/g, "")) || 0;
  const ratio =
    mode === "equal" ? 50 : mode === "income" ? ratioFromIncomes(num(mine), num(theirs))[0] : Math.min(99, Math.max(1, Math.round(num(custom)) || 50));
  const placeholder = GROUP_TYPES.find((t) => t.id === type)?.namePlaceholder ?? "Group name";

  return (
    <form action={createGroup}>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="ratio" value={type === "couple" ? ratio : 50} />

      <div hidden={step !== 1} className="space-y-7">
        <fieldset>
          <legend className="mb-4 font-display text-[28px] font-semibold leading-tight">What’s it for?</legend>
          <div className="grid grid-cols-2 gap-2.5">
            {GROUP_TYPES.flatMap((t) => (t.id === "other" ? ["collect" as const, t] : [t])).map((t) =>
              t === "collect" ? (
                // Collect isn't a group: one link to gather money from many (it lives here so everything starts in one place).
                <Link
                  key="collect"
                  href="/collect/new"
                  className="relative flex h-[140px] flex-col justify-between overflow-hidden rounded-[18px] border border-line bg-white p-4 text-left active:bg-mist"
                >
                  <span aria-hidden className="absolute -right-1.5 top-3 flex h-[68px] w-[52px] rotate-[9deg] items-center justify-center rounded-[4px] border-[3px] border-fg bg-[#1d3b2f] text-[26px] shadow-lg shadow-black/50">
                    🫙
                  </span>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 3h6M10 3v3.5a5 5 0 0 0-4 4.9V19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7.6a5 5 0 0 0-4-4.9V3M9 14h6" />
                  </svg>
                  <span>
                    <span className="block text-[17px] font-semibold">Collect</span>
                    <span className="mt-0.5 block text-xs text-gray-500">One link: gifts, fees, bookings</span>
                  </span>
                </Link>
              ) : (
              <button
                key={t.id}
                type="button"
                aria-pressed={type === t.id}
                onClick={() => setType(t.id)}
                className={`relative flex h-[140px] flex-col justify-between overflow-hidden rounded-[18px] border p-4 text-left ${type === t.id ? "border-fg bg-accent-soft" : "border-line bg-white"}`}
              >
                <span aria-hidden className="absolute -right-1.5 top-3 h-[68px] w-[52px] rotate-[9deg] overflow-hidden rounded-[4px] border-[3px] border-fg shadow-lg shadow-black/50">
                  <GroupCover kind={coverOf({ type: t.id })} uid={`type-${t.id}`} />
                </span>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {ICONS[t.id]}
                </svg>
                <span>
                  <span className="block text-[17px] font-semibold">{t.label}</span>
                  <span className="mt-0.5 block text-xs text-gray-500">{t.hint}</span>
                </span>
              </button>
              ),
            )}
          </div>
          {type === "pot" && (
            <p className="mt-3 rounded-xl border border-owed/25 bg-owed/[0.08] px-3.5 py-2.5 text-[13px] leading-snug text-fg/80">
              <strong className="font-semibold text-owed">The Pot</strong> is for Poker and Teen Patti nights. Everyone takes money from the pot to play and puts back
              what’s left. Loopin works out who won, who lost and who pays whom. It never holds or moves money.
            </p>
          )}
        </fieldset>

        <CoverPicker
          value={cover}
          onChange={setPicked}
          letter={name || placeholder}
          uid="new"
          own={{ src: ownSrc || undefined }}
          onNewPhoto={(src) => {
            setOwnSrc(src);
            setPicked("own");
          }}
        />

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-600">Group name</span>
          <input name="groupName" required value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} autoComplete="off" maxLength={60} className={inputClass} />
        </label>
        {type === "trip" && <TripDates name={name} />}
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-600">Your name in this group</span>
          <input name="yourName" required defaultValue={yourName} placeholder="Your name" autoComplete="given-name" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-600">
            Group currency <span className="font-normal text-gray-400">(balances are shown in this)</span>
          </span>
          <CurrencySelect name="currency" defaultValue={defaultCurrency} />
        </label>

        {type === "couple" ? (
          <button type="button" disabled={!name.trim()} onClick={() => setStep(2)} className={primaryButtonClass}>
            Next
          </button>
        ) : (
          <>
            <p className="rounded-xl bg-mist px-4 py-3 text-sm text-gray-500">
              {type === "home"
                ? "Next: add your flatmates. You can set a split by room size in settings later."
                : type === "pot"
                  ? "Next: add the players. Pick friends on Loopin, or just type their names; they can join with the link any time."
                  : "Next: add people. Pick friends already on Loopin, choose from your contacts, or invite by email."}
            </p>
            <button type="submit" className={primaryButtonClass}>
              Create group &amp; add people
            </button>
          </>
        )}
      </div>

      {step === 2 && (
        <div className="space-y-6">
          <div>
            <h2 className="font-display text-[28px] font-semibold leading-tight">How do you two share costs?</h2>
            <p className="mt-2 text-sm text-gray-500">Used for every expense. You can still change any one of them.</p>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-mist p-1" role="radiogroup" aria-label="How you share">
            {(
              [
                ["equal", "50 / 50"],
                ["income", "By income"],
                ["custom", "Custom"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={mode === id}
                onClick={() => setMode(id)}
                className={`rounded-lg py-2.5 text-sm ${mode === id ? "bg-fg font-semibold text-canvas" : "text-gray-500"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "income" && (
            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="mb-2 block text-sm text-gray-500">You earn a month</span>
                <input inputMode="decimal" value={mine} onChange={(e) => setMine(e.target.value)} placeholder="1,10,000" className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-gray-500">Your partner earns</span>
                <input inputMode="decimal" value={theirs} onChange={(e) => setTheirs(e.target.value)} placeholder="90,000" className={inputClass} />
              </label>
            </div>
          )}
          {mode === "custom" && (
            <label className="block">
              <span className="mb-2 block text-sm text-gray-500">Your part, in %</span>
              <input inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value)} className={inputClass} />
            </label>
          )}

          <section className="vault rounded-[20px] px-5 py-5">
            <p className="text-sm text-gray-500">Your split</p>
            <p className="font-display text-[40px] font-semibold leading-tight tabular-nums">
              {ratio} / {100 - ratio}
            </p>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full" aria-hidden>
              <div className="bg-fg" style={{ width: `${ratio}%` }} />
              <div className="w-[3px] bg-canvas" />
              <div className="flex-1 bg-[#6e6b63]" />
            </div>
            <p className="mt-3 text-sm text-gray-500">
              A ₹1,000 dinner: you ₹{ratio * 10}, your partner ₹{(100 - ratio) * 10}.
            </p>
          </section>
          {mode === "income" && <p className="text-xs text-gray-400">Only the split is saved. Your incomes are never stored or shown to anyone.</p>}

          <button type="submit" className={primaryButtonClass}>
            Use {ratio} / {100 - ratio} &amp; add your partner
          </button>
          <button type="button" onClick={() => setStep(1)} className={secondaryButtonClass}>
            Back
          </button>
        </div>
      )}
    </form>
  );
}
