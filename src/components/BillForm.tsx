"use client";

import { useState } from "react";
import { saveBill } from "@/app/bill-actions";
import { BILL_TEMPLATES } from "@/lib/home/bills";
import { inputClass, primaryButtonClass } from "./ui";

type Member = { id: string; name: string };
export type BillFormInitial = {
  billId: string;
  template: string;
  name: string;
  nature: "fixed" | "varies" | "daily";
  amount: string;
  day: number;
  payer: string; // memberId or "turns"
  split: "group" | "equal" | "some" | "percent" | "amounts";
  ids: string[];
  pct?: Record<string, string>; // "50" per person
  amt?: Record<string, string>; // "18000" per person
};

// Simple line icons for the bill tiles.
const ICON: Record<string, React.ReactNode> = {
  rent: <path d="M3 11l9-7 9 7M5 10v10h14V10" />,
  groceries: <path d="M3 4h2l2.4 11h10.2L20 7H6.3M9 20h.01M17 20h.01" />,
  society: <path d="M4 3h16v18H4zM9 7h6M9 11h6M9 15h4" />,
  electricity: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  wifi: <path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01" />,
  help: <path d="M5 21l3-12h8l3 12M9 9V5a3 3 0 0 1 6 0v4" />,
  cook: <path d="M6 13.9A4 4 0 0 1 7.6 6.2 5 5 0 0 1 16.4 6.2 4 4 0 0 1 18 13.9V20H6zM6 17h12" />,
  milk: <path d="M8 3h8l-1 5v12H9V8z" />,
  water: <path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z" />,
  gas: <path d="M7 9h10l-1 11H8zM9 9a3 3 0 0 1 6 0" />,
  streaming: <path d="M3 5h18v12H3zM8 21h8M12 17v4" />,
  mobile: <path d="M7 2h10v20H7zM11 18h2" />,
  other: <path d="M12 5v14M5 12h14" />,
};

const DAYS: [number, string][] = [
  [1, "1st"],
  [5, "5th"],
  [10, "10th"],
  [15, "15th"],
  [31, "Last day"],
];

// Add (or change) a regular bill: pick a tile, then amount, day, who pays and
// how it's shared. Nothing to type except the amount.
export function BillForm({
  groupId,
  members,
  myId,
  splitName,
  splitLabel,
  currency,
  initial,
  error,
}: {
  groupId: string;
  members: Member[];
  myId: string;
  splitName: string; // "Flat split" / "Our split" / "Group split"
  splitLabel: string; // "1.2 / 1 / 1", "" when equal
  currency: string;
  initial?: BillFormInitial;
  error?: string;
}) {
  const [template, setTemplate] = useState(initial?.template ?? "rent");
  const tpl = BILL_TEMPLATES.find((t) => t.id === template) ?? BILL_TEMPLATES[0];
  const [name, setName] = useState(initial?.name ?? tpl.name);
  const [nature, setNature] = useState<"fixed" | "varies" | "daily">(initial?.nature ?? tpl.nature);
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [day, setDay] = useState<number>(initial?.day ?? tpl.day);
  const [payer, setPayer] = useState(initial?.payer ?? myId);
  const [split, setSplit] = useState<"group" | "equal" | "some" | "percent" | "amounts">(initial?.split ?? (splitLabel ? "group" : "equal"));
  // Unequal shares: equal percentages to start with (the last person takes the rounding).
  const evenPct = () => {
    const each = Math.floor(10000 / Math.max(1, members.length));
    return Object.fromEntries(members.map((m, i) => [m.id, String((i === members.length - 1 ? 10000 - each * (members.length - 1) : each) / 100)]));
  };
  const [pct, setPct] = useState<Record<string, string>>(initial?.pct && Object.keys(initial.pct).length ? initial.pct : evenPct);
  const [amt, setAmt] = useState<Record<string, string>>(initial?.amt ?? {});
  const num = (v: string | undefined) => Number((v ?? "").replace(/[^\d.]/g, "")) || 0;
  const pctTotal = Math.round(members.reduce((t, m) => t + num(pct[m.id]) * 100, 0)) / 100;
  const amtTotal = members.reduce((t, m) => t + num(amt[m.id]), 0);
  const [ids, setIds] = useState<string[]>(initial?.ids ?? members.map((m) => m.id));
  const who = (id: string) => (id === myId ? "you" : members.find((m) => m.id === id)?.name ?? "someone");
  const editing = Boolean(initial?.billId);

  function pick(id: string) {
    const t = BILL_TEMPLATES.find((x) => x.id === id)!;
    setTemplate(id);
    setName(t.name);
    setNature(t.nature);
    setDay(t.day);
    if (t.nature !== "fixed" && split === "amounts") setSplit("percent");
  }

  const chip = (on: boolean) =>
    `rounded-full border px-3.5 py-2 text-sm ${on ? "border-fg bg-accent-soft font-semibold text-fg" : "border-line text-fg"}`;
  const amountNum = Number(amount.replace(/[^\d.]/g, "")) || 0;
  const people = split === "some" ? ids.length : members.length;
  const dayText = day >= 31 ? "on the last day" : `on the ${DAYS.find((d) => d[0] === day)?.[1] ?? `${day}th`}`;
  const payerText = payer === "turns" ? "taking turns" : `paid by ${who(payer)}`;
  const summary =
    nature === "varies"
      ? `${payer === "turns" ? "Whoever’s turn it is gets" : payer === myId ? "You get" : `${who(payer)} gets`} a nudge to enter the amount ${dayText}.`
      : nature === "daily"
        ? `${amount ? `${currency} ${amount} a day` : "The price per day"} is added up at month end, ${payerText}.`
        : `${amount ? `${currency} ${amount}` : "The amount"} is added ${dayText}, ${payerText}${amountNum && (split === "equal" || split === "some") && people ? `, ${currency} ${(amountNum / people).toFixed(0)} each` : ""}.`;

  return (
    <form action={saveBill} className="space-y-7">
      <input type="hidden" name="groupId" value={groupId} />
      {initial?.billId && <input type="hidden" name="billId" value={initial.billId} />}
      <input type="hidden" name="template" value={template} />
      <input type="hidden" name="nature" value={nature} />
      <input type="hidden" name="day" value={day} />
      <input type="hidden" name="payer" value={payer} />
      <input type="hidden" name="split" value={split} />
      {split === "some" && ids.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {!editing && (
        <fieldset>
          <legend className="mb-3 text-sm text-gray-500">Pick one. You set it up once and Loopin adds it on repeat.</legend>
          <div className="grid grid-cols-4 gap-2">
            {BILL_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={template === t.id}
                onClick={() => pick(t.id)}
                className={`flex h-[76px] flex-col items-center justify-center gap-1.5 rounded-[14px] border text-xs ${
                  template === t.id ? "border-fg bg-accent-soft font-semibold" : t.id === "other" ? "border-dashed border-gray-300" : "border-line bg-white"
                }`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {ICON[t.id]}
                </svg>
                {t.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <label className="block">
        <span className="mb-2 block text-sm text-gray-500">Name</span>
        <input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={inputClass} />
      </label>

      <div>
        <span className="mb-2 block text-sm text-gray-500">The amount</span>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-mist p-1" role="radiogroup" aria-label="The amount">
          {(
            [
              ["fixed", "Fixed"],
              ["varies", "Changes"],
              ["daily", "Per day"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={nature === id}
              onClick={() => {
                setNature(id);
                if (id !== "fixed" && split === "amounts") setSplit("percent");
              }}
              className={`rounded-lg py-2.5 text-[13px] ${nature === id ? "bg-fg font-semibold text-canvas" : "text-gray-500"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="mb-2 block text-sm text-gray-500">
          {nature === "daily" ? "Price per day" : nature === "varies" ? "Usually (optional)" : "Amount"}
        </span>
        <span className="flex items-center gap-2 rounded-xl border border-line bg-mist px-4 focus-within:border-accent">
          <span className="text-sm text-gray-400">{currency}</span>
          <input
            name="amount"
            inputMode="decimal"
            aria-label="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={nature === "daily" ? "60" : "4,000"}
            className="w-full bg-transparent py-3.5 font-display text-xl outline-none"
          />
        </span>
      </label>

      {nature !== "daily" && (
        <div>
          <span className="mb-2 block text-sm text-gray-500">{nature === "varies" ? "Due every month on" : "Repeats every month on"}</span>
          <div className="flex flex-wrap gap-2">
            {DAYS.map(([d, label]) => (
              <button key={d} type="button" aria-pressed={day === d} onClick={() => setDay(d)} className={chip(day === d)}>
                {label}
              </button>
            ))}
            <select
              aria-label="Another day"
              value={DAYS.some((d) => d[0] === day) ? "" : String(day)}
              onChange={(e) => e.target.value && setDay(Number(e.target.value))}
              className={`${chip(!DAYS.some((d) => d[0] === day))} bg-transparent !text-base`}
            >
              <option value="">Other…</option>
              {Array.from({ length: 28 }, (_, i) => i + 1)
                .filter((d) => !DAYS.some((x) => x[0] === d))
                .map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}

      <div>
        <span className="mb-2 block text-sm text-gray-500">Who pays</span>
        <div className="flex flex-wrap gap-2">
          {members.map((m) => (
            <button key={m.id} type="button" aria-pressed={payer === m.id} onClick={() => setPayer(m.id)} className={chip(payer === m.id)}>
              {m.id === myId ? "You" : m.name}
            </button>
          ))}
          {members.length > 1 && (
            <button type="button" aria-pressed={payer === "turns"} onClick={() => setPayer("turns")} className={chip(payer === "turns")}>
              Take turns
            </button>
          )}
        </div>
      </div>

      <div>
        <span className="mb-2 block text-sm text-gray-500">Shared</span>
        <div className="flex flex-wrap gap-2">
          {splitLabel && (
            <button type="button" aria-pressed={split === "group"} onClick={() => setSplit("group")} className={chip(split === "group")}>
              {splitName} <span className="opacity-60">{splitLabel}</span>
            </button>
          )}
          <button type="button" aria-pressed={split === "equal"} onClick={() => setSplit("equal")} className={chip(split === "equal")}>
            Equally
          </button>
          {members.length > 1 && (
            <button type="button" aria-pressed={split === "percent"} onClick={() => setSplit("percent")} className={chip(split === "percent")}>
              By %
            </button>
          )}
          {members.length > 1 && nature === "fixed" && (
            <button type="button" aria-pressed={split === "amounts"} onClick={() => setSplit("amounts")} className={chip(split === "amounts")}>
              By amount
            </button>
          )}
          {members.length > 2 && (
            <button type="button" aria-pressed={split === "some"} onClick={() => setSplit("some")} className={chip(split === "some")}>
              Only some
            </button>
          )}
        </div>
        {(split === "percent" || split === "amounts") && (
          <div className="mt-3 rounded-2xl border border-line">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
                <span className="flex-1">{m.id === myId ? "You" : m.name}</span>
                <span className="flex w-32 items-center gap-1 rounded-xl border border-line bg-mist px-3 focus-within:border-accent">
                  {split === "amounts" && <span className="text-xs text-gray-400">{currency}</span>}
                  <input
                    name={split === "percent" ? `p_${m.id}` : `a_${m.id}`}
                    inputMode="decimal"
                    aria-label={`${m.id === myId ? "Your" : `${m.name}’s`} ${split === "percent" ? "percentage" : "amount"}`}
                    value={(split === "percent" ? pct : amt)[m.id] ?? ""}
                    onChange={(e) => (split === "percent" ? setPct : setAmt)((prev) => ({ ...prev, [m.id]: e.target.value }))}
                    placeholder="0"
                    className="w-full bg-transparent py-2 text-right outline-none"
                  />
                  {split === "percent" && <span className="text-xs text-gray-400">%</span>}
                </span>
              </label>
            ))}
            <p className={`px-4 py-2.5 text-xs ${(split === "percent" ? pctTotal === 100 : amtTotal === amountNum && amountNum > 0) ? "text-owed" : "text-gray-500"}`}>
              {split === "percent"
                ? pctTotal === 100
                  ? "Adds up to 100% ✓"
                  : `Adds up to ${pctTotal}%, needs to be 100%`
                : amtTotal === amountNum && amountNum > 0
                  ? `Adds up to ${currency} ${amount} ✓`
                  : `Adds up to ${currency} ${amtTotal.toLocaleString("en-IN")}, needs to be ${currency} ${amountNum ? amountNum.toLocaleString("en-IN") : "the amount above"}`}
            </p>
          </div>
        )}
        {split === "some" && (
          <div className="mt-3 flex flex-wrap gap-2">
            {members.map((m) => {
              const on = ids.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setIds((prev) => (on ? prev.filter((x) => x !== m.id) : [...prev, m.id]))}
                  className={chip(on)}
                >
                  {on && "✓ "}
                  {m.id === myId ? "You" : m.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <button type="submit" className={primaryButtonClass}>
          {editing ? "Save bill" : "Add bill"}
        </button>
        <p className="mt-3 text-center text-xs leading-relaxed text-gray-500">
          {summary}
          <br />
          Everyone is told when it’s added, and anyone can undo it.
        </p>
      </div>
    </form>
  );
}
