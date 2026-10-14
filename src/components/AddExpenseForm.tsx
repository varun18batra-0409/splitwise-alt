"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addExpense, lookupRate } from "@/app/actions";
import { CATEGORIES, analyzeName, applySuggestion, getCategory } from "@/lib/categories";
import { computeTotals, PAYMENT_METHODS, type PaymentMethod } from "@/lib/conversion";
import { buildExpense, chosenMarkupBp, type ExpenseDraft } from "@/lib/expense";
import { currencyInfo, formatMoney, formatPercent, isSupportedCurrency, parseAmount, parsePercent } from "@/lib/money";
import { CurrencyPicker } from "./CurrencyPicker";
import { participantsFor, type ForMode, type SplitType } from "@/lib/split";
import { niceDate, rateText } from "@/lib/format";
import { inputClass, primaryButtonClass } from "./ui";

type Member = { id: string; name: string };
type RateState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ok"; rate: string; date: string; stale: boolean }
  | { status: "missing"; message: string };

const labelClass = "mb-2 block text-sm font-medium text-gray-600";

// Values to start from when editing an existing expense.
export type ExpenseInitial = {
  name: string;
  amount: string;
  currency: string;
  category: string;
  paidById: string;
  forMode: ForMode;
  selected: string[];
  onePersonId: string;
  splitType: SplitType;
  exact: Record<string, string>;
  percent: Record<string, string>;
  paymentMethod: PaymentMethod;
  markupChoice: ExpenseDraft["markupChoice"];
  markupCustom: string;
  rate: string; // the rate saved with the expense
  rateDate: string;
};

// Fast path (3 taps): + Add expense → type name & amount → Save.
// Defaults: paid by you, for everyone, split equally, in the last currency used.
export function AddExpenseForm({
  groupId,
  baseCurrency,
  groupMarkupBp,
  members,
  myId,
  expenseId,
  initial,
}: {
  groupId: string;
  baseCurrency: string;
  groupMarkupBp: number;
  members: Member[];
  myId: string;
  expenseId?: string; // editing this expense
  initial?: ExpenseInitial;
}) {
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";
  const who = (id: string) => (id === myId ? "You" : nameOf(id));

  // 1–4: what, how much, category, currency
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [pickedCategory, setPickedCategory] = useState<string | null>(initial?.category ?? null); // null = smart guess
  const [currency, setCurrency] = useState(initial?.currency ?? baseCurrency);
  const [showCurrencies, setShowCurrencies] = useState(false);
  const [showCategories, setShowCategories] = useState(false);

  // Conversion (only when currency ≠ group currency)
  const [rateState, setRateState] = useState<RateState>({ status: "none" });
  const [rateMode, setRateMode] = useState<"auto" | "manual">("auto");
  const [manualRate, setManualRate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initial?.paymentMethod ?? "card");
  const [markupChoice, setMarkupChoice] = useState<ExpenseDraft["markupChoice"]>(initial?.markupChoice ?? "group");
  const [markupCustom, setMarkupCustom] = useState(initial?.markupCustom ?? "");
  const [showMarkup, setShowMarkup] = useState(false);
  // Editing: keep the rate saved with the expense unless the person asks for today's.
  const [keepSavedRate, setKeepSavedRate] = useState(Boolean(initial && initial.currency !== baseCurrency && initial.rate));

  // 5–7: who paid, who it was for, how to split
  const [showPeople, setShowPeople] = useState(false);
  const [paidById, setPaidById] = useState(initial?.paidById ?? myId);
  const [forMode, setForMode] = useState<ForMode>(initial?.forMode ?? "everyone");
  const [selected, setSelected] = useState<string[]>(initial?.selected ?? memberIds);
  const [onePersonId, setOnePersonId] = useState(initial?.onePersonId || (memberIds.find((id) => id !== myId) ?? myId));
  const [splitType, setSplitType] = useState<SplitType>(initial?.splitType ?? "equal");
  const [exact, setExact] = useState<Record<string, string>>(initial?.exact ?? {});
  const [percent, setPercent] = useState<Record<string, string>>(initial?.percent ?? {});

  const [error, setError] = useState("");
  const [saving, startSaving] = useTransition();

  // Remember the last currency used in this group (handy on a trip).
  const storageKey = `split-currency-${groupId}`;
  useEffect(() => {
    if (initial) return; // editing: start from the expense's own currency
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && isSupportedCurrency(saved)) setCurrency(saved);
    } catch {
      /* storage unavailable — keep the default */
    }
  }, [storageKey, initial]);

  // Fetch a rate only when the currency changes — never on each keystroke.
  const rateCache = useRef(new Map<string, RateState>());
  const foreign = currency !== baseCurrency;
  useEffect(() => {
    if (!foreign) {
      setRateState({ status: "none" });
      return;
    }
    if (keepSavedRate && initial && currency === initial.currency) {
      setRateState({ status: "ok", rate: initial.rate, date: initial.rateDate, stale: false });
      return;
    }
    const key = `${currency}-${baseCurrency}`;
    const cached = rateCache.current.get(key);
    if (cached) {
      setRateState(cached);
      return;
    }
    let cancelled = false;
    setRateState({ status: "loading" });
    lookupRate(currency, baseCurrency)
      .then((r) => {
        const next: RateState = r.ok
          ? { status: "ok", rate: r.rate, date: r.date, stale: Boolean("stale" in r && r.stale) }
          : { status: "missing", message: r.message };
        rateCache.current.set(key, next);
        if (!cancelled) setRateState(next);
      })
      .catch(() => {
        if (!cancelled) setRateState({ status: "missing", message: "Couldn't reach the rate service. Enter the rate yourself." });
      });
    return () => {
      cancelled = true;
    };
  }, [currency, baseCurrency, foreign, keepSavedRate, initial]);

  function chooseCurrency(code: string) {
    setCurrency(code);
    setKeepSavedRate(false);
    setShowCurrencies(false);
    setRateMode("auto");
    setManualRate("");
    try {
      localStorage.setItem(storageKey, code);
    } catch {
      /* ignore */
    }
  }

  const usingManualRate = foreign && (rateMode === "manual" || rateState.status === "missing");
  const effectiveRate = !foreign ? "1" : usingManualRate ? manualRate : rateState.status === "ok" ? rateState.rate : "";

  const nameCheck = analyzeName(name);
  const category = getCategory(pickedCategory ?? nameCheck.category);
  const [dismissedTypo, setDismissedTypo] = useState("");
  const typo = nameCheck.suggestion && nameCheck.suggestion.wrong !== dismissedTypo ? nameCheck.suggestion : null;
  const draft: ExpenseDraft = {
    amount, currency, paidById, forMode, selected, onePersonId, splitType, exact, percent,
    paymentMethod, markupChoice, markupCustom,
  };
  const ctx = { memberIds, baseCurrency, groupMarkupBp, rate: effectiveRate };
  const markupBp = chosenMarkupBp(draft, groupMarkupBp);
  const totals = computeTotals({ amount, currency, baseCurrency, rate: effectiveRate, paymentMethod, markupBp: markupBp ?? 0 });
  const preview = buildExpense(draft, ctx);
  const participants = participantsFor({ ...draft, memberIds });

  const base = (minor: number) => formatMoney(minor, baseCurrency);
  const orig = (minor: number) => formatMoney(minor, currency);
  const cur = currencyInfo(currency);

  // Running total for custom amounts / percentages.
  const remaining = (() => {
    if (participants.length < 2 || splitType === "equal" || !totals.originalAmount) return null;
    if (splitType === "exact") {
      const typed = participants.reduce((s, id) => s + (parseAmount(exact[id] ?? "", currency) ?? 0), 0);
      const left = totals.originalAmount - typed;
      return { text: left === 0 ? "✓ Adds up" : left > 0 ? `${orig(left)} left to assign` : `${orig(-left)} too much`, state: left === 0 ? "done" : left > 0 ? "left" : "over" };
    }
    const typed = participants.reduce((s, id) => s + (parsePercent(percent[id] ?? "") ?? 0), 0);
    const left = 10000 - typed;
    return { text: left === 0 ? "✓ Adds up to 100%" : left > 0 ? `${formatPercent(left)} left to assign` : `${formatPercent(-left)} too much`, state: left === 0 ? "done" : left > 0 ? "left" : "over" };
  })();

  const forSummary =
    forMode === "everyone" ? "everyone" : forMode === "one" ? who(onePersonId) : `${participants.length} ${participants.length === 1 ? "person" : "people"}`;
  const splitSummary =
    participants.length <= 1 ? "100% to them" : splitType === "equal" ? "split equally" : splitType === "exact" ? "custom amounts" : "by percentage";

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!preview.ok) {
      setError(preview.error);
      if (/person|amounts|percent/i.test(preview.error)) setShowPeople(true);
      return;
    }
    startSaving(async () => {
      const res = await addExpense({ ...draft, groupId, name, category: category.id, expenseId, rateMode: usingManualRate ? "manual" : keepSavedRate ? "keep" : "auto", manualRate });
      if (res?.error) setError(res.error);
    });
  }

  return (
    <form onSubmit={save} className="space-y-7">
      {/* 1. Expense name, with its category as a small tag (used for group reports) */}
      <div>
        <label htmlFor="expense-name" className={labelClass}>
          Expense name
        </label>
        <div className="flex gap-2">
          <input
            id="expense-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Dinner at the night market"
            autoComplete="off"
            maxLength={80}
            autoFocus
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => setShowCategories((v) => !v)}
            aria-label={`Category: ${category.label}${pickedCategory ? "" : " (picked automatically)"}. Tap to change`}
            title={category.label}
            className="flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-line px-2.5 active:bg-mist"
          >
            <span className="text-lg leading-none">{category.emoji}</span>
            <span className="text-[11px] leading-none text-gray-500">
              {category.short}
              {!pickedCategory && name.trim() && <span className="text-gray-400"> · auto</span>}
            </span>
          </button>
        </div>
        {typo && (
          <p className="mt-2 flex items-center gap-2 text-sm text-gray-500">
            <span className="min-w-0 truncate">
              Did you mean <span className="font-medium text-fg">“{typo.right}”</span>?
            </span>
            <button
              type="button"
              onClick={() => setName((n) => applySuggestion(n, typo))}
              className="shrink-0 border border-line px-2.5 py-1 text-xs font-semibold text-fg active:bg-mist"
            >
              Fix
            </button>
            <button type="button" onClick={() => setDismissedTypo(typo.wrong)} className="shrink-0 px-1 text-xs text-gray-400">
              Keep
            </button>
          </p>
        )}
        {showCategories && (
          <div className="mt-2 flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <Chip
                key={c.id}
                on={c.id === category.id}
                onClick={() => {
                  setPickedCategory(c.id);
                  setShowCategories(false);
                }}
              >
                {c.emoji} {c.label}
              </Chip>
            ))}
            {pickedCategory && (
              <Chip
                on={false}
                onClick={() => {
                  setPickedCategory(null);
                  setShowCategories(false);
                }}
              >
                ✨ Auto
              </Chip>
            )}
          </div>
        )}
      </div>

      {/* 2 + 4. Amount and currency */}
      <div>
        <span className={labelClass}>Amount</span>
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => setShowCurrencies((s) => !s)}
            aria-label={`Currency: ${cur.name}. Tap to change`}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-base font-medium active:bg-gray-50"
          >
            <span className="text-lg">{cur.flag}</span>
            {currency}
            <span className="text-gray-400">▾</span>
          </button>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            autoComplete="off"
            aria-label="Amount"
            className={`${inputClass} text-2xl font-semibold`}
          />
        </div>
        {showCurrencies && <CurrencyPicker value={currency} recent={[baseCurrency, currency]} onPick={chooseCurrency} />}
      </div>

      {/* Currency conversion — only shown for foreign currencies */}
      {foreign && (
        <section className="space-y-4 rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
          <div>
            <span className={labelClass}>Paid with</span>
            <Segmented
              options={PAYMENT_METHODS.map((p) => ({ id: p.id, label: p.label }))}
              value={paymentMethod}
              onChange={(v) => setPaymentMethod(v as PaymentMethod)}
            />
          </div>

          {/* Exchange rate */}
          <div className="text-sm">
            {rateState.status === "loading" && <p className="text-gray-500">Getting today’s exchange rate…</p>}

            {rateState.status === "ok" && !usingManualRate && (
              <div className="flex items-start justify-between gap-3">
                <p className="text-gray-600">
                  <span className="font-medium text-gray-900">
                    1 {currency} = {rateText(rateState.rate, baseCurrency)}
                  </span>
                  <br />
                  {keepSavedRate ? "Rate saved with this expense" : rateState.stale ? "Last saved rate, from " : "Rate for "}
                  {keepSavedRate ? (rateState.date ? `, ${niceDate(rateState.date)}` : "") : niceDate(rateState.date)}
                  {rateState.stale && " — live rates unavailable right now"}
                  {keepSavedRate && (
                    <>
                      <br />
                      <button type="button" onClick={() => setKeepSavedRate(false)} className="py-1 font-medium text-accent">
                        Use today’s rate instead
                      </button>
                    </>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setRateMode("manual");
                    setManualRate(rateState.rate);
                  }}
                  className="shrink-0 py-1 font-medium text-accent"
                >
                  Edit rate
                </button>
              </div>
            )}

            {usingManualRate && (
              <div>
                {rateState.status === "missing" && <p className="mb-2 text-orange-700">{rateState.message}</p>}
                <label className="flex items-center gap-2">
                  <span className="shrink-0 text-gray-600">1 {currency} =</span>
                  <span className="flex flex-1 items-center rounded-xl border border-gray-200 bg-white px-3 focus-within:border-accent">
                    <span className="text-gray-400">{baseCurrency === "INR" ? "₹" : baseCurrency}</span>
                    <input
                      value={manualRate}
                      onChange={(e) => setManualRate(e.target.value)}
                      inputMode="decimal"
                      placeholder="rate"
                      aria-label="Exchange rate"
                      className="w-full bg-transparent px-2 py-2.5 outline-none"
                    />
                  </span>
                </label>
                {rateState.status === "ok" && (
                  <button type="button" onClick={() => setRateMode("auto")} className="mt-1 py-1 font-medium text-accent">
                    Use live rate ({rateText(rateState.rate, baseCurrency)})
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Card markup */}
          {paymentMethod === "card" && (
            <div className="text-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-gray-600">
                  Card markup:{" "}
                  <span className="font-medium text-gray-900">
                    {markupBp === null ? "—" : formatPercent(markupBp)}
                  </span>
                  {markupChoice === "group" && <span className="text-gray-400"> (group default)</span>}
                </p>
                <button type="button" onClick={() => setShowMarkup((s) => !s)} className="py-1 font-medium text-accent">
                  {showMarkup ? "Done" : "Change"}
                </button>
              </div>
              {showMarkup && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Chip on={markupChoice === "group"} onClick={() => setMarkupChoice("group")}>
                    Default ({formatPercent(groupMarkupBp)})
                  </Chip>
                  <Chip on={markupChoice === "none"} onClick={() => setMarkupChoice("none")}>
                    None
                  </Chip>
                  {["2", "3", "4"].map((p) => (
                    <Chip
                      key={p}
                      on={markupChoice === "custom" && markupCustom === p}
                      onClick={() => {
                        setMarkupChoice("custom");
                        setMarkupCustom(p);
                      }}
                    >
                      {p}%
                    </Chip>
                  ))}
                  <span className="flex items-center rounded-full border border-gray-200 bg-white px-3">
                    <input
                      value={markupChoice === "custom" && !["2", "3", "4"].includes(markupCustom) ? markupCustom : ""}
                      onChange={(e) => {
                        setMarkupChoice("custom");
                        setMarkupCustom(e.target.value);
                      }}
                      inputMode="decimal"
                      placeholder="Custom"
                      aria-label="Custom markup percentage"
                      className="w-16 bg-transparent py-1.5 text-sm outline-none"
                    />
                    %
                  </span>
                </div>
              )}
            </div>
          )}

          {/* The calculation, line by line */}
          {totals.ok && (
            <dl className="space-y-1.5 border-t border-gray-200 pt-3 text-sm">
              <Row label="Original expense" value={orig(totals.originalAmount)} />
              <Row label="Converted amount" value={base(totals.convertedAmount)} />
              {paymentMethod === "card" && (
                <Row
                  label={`Card markup (${formatPercent(totals.markupBp)})`}
                  value={totals.markupAmount > 0 ? `+ ${base(totals.markupAmount)}` : base(0)}
                />
              )}
              <Row label="Total group expense" value={base(totals.total)} strong />
            </dl>
          )}
          {paymentMethod === "card" && (
            <p className="text-xs text-gray-400">
              The card markup is an estimate of your bank’s foreign-currency fee. Actual bank charges can differ.
            </p>
          )}
        </section>
      )}

      {/* 5–7. Who paid, who it was for, how to split — summarised, tap to change */}
      <section className="rounded-2xl border border-gray-100">
        <button
          type="button"
          onClick={() => setShowPeople((s) => !s)}
          className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left text-sm"
        >
          <span className="text-gray-600">
            Paid by <strong className="text-gray-900">{who(paidById)}</strong> · for{" "}
            <strong className="text-gray-900">{forSummary}</strong> · <strong className="text-gray-900">{splitSummary}</strong>
          </span>
          <span className="shrink-0 font-medium text-accent">{showPeople ? "Done" : "Change"}</span>
        </button>

        {showPeople && (
          <div className="space-y-6 border-t border-gray-100 px-4 pb-4 pt-4">
            <div>
              <span className={labelClass}>Who paid?</span>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => (
                  <Chip key={m.id} on={m.id === paidById} onClick={() => setPaidById(m.id)}>
                    {who(m.id)}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <span className={labelClass}>Who was it for?</span>
              <Segmented
                options={[
                  { id: "everyone", label: "Everyone" },
                  { id: "selected", label: "Selected" },
                  { id: "one", label: "One person" },
                ]}
                value={forMode}
                onChange={(v) => setForMode(v as ForMode)}
              />
              {forMode === "selected" && (
                <ul className="mt-3 space-y-1">
                  {members.map((m) => (
                    <li key={m.id}>
                      <label className="flex items-center gap-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={selected.includes(m.id)}
                          onChange={() =>
                            setSelected((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]))
                          }
                          className="h-5 w-5 accent-[var(--color-accent)]"
                        />
                        {who(m.id)}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {forMode === "one" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {members.map((m) => (
                    <Chip key={m.id} on={m.id === onePersonId} onClick={() => setOnePersonId(m.id)}>
                      {who(m.id)}
                    </Chip>
                  ))}
                </div>
              )}
            </div>

            {participants.length > 1 ? (
              <div>
                <span className={labelClass}>How should it be split?</span>
                <Segmented
                  options={[
                    { id: "equal", label: "Equally" },
                    { id: "exact", label: "Amounts" },
                    { id: "percent", label: "%" },
                  ]}
                  value={splitType}
                  onChange={(v) => setSplitType(v as SplitType)}
                />
                {splitType !== "equal" && (
                  <ul className="mt-3 divide-y divide-gray-100">
                    {participants.map((id) => (
                      <li key={id} className="flex items-center gap-3 py-2">
                        <span className="flex-1">{who(id)}</span>
                        <span className="flex w-36 items-center rounded-xl border border-gray-200 px-3 focus-within:border-accent">
                          {splitType === "exact" && <span className="text-xs text-gray-400">{currency}</span>}
                          <input
                            inputMode="decimal"
                            placeholder="0"
                            aria-label={`${who(id)} ${splitType === "exact" ? "amount" : "percentage"}`}
                            value={(splitType === "exact" ? exact : percent)[id] ?? ""}
                            onChange={(e) =>
                              (splitType === "exact" ? setExact : setPercent)((prev) => ({ ...prev, [id]: e.target.value }))
                            }
                            className="w-full bg-transparent py-2 text-right outline-none"
                          />
                          {splitType === "percent" && <span className="text-gray-400">%</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {remaining && (
                  <p className={`mt-2 text-sm ${remaining.state === "done" ? "text-accent-dark" : remaining.state === "over" ? "text-red-600" : "text-gray-500"}`}>
                    {remaining.text}
                  </p>
                )}
              </div>
            ) : (
              participants.length === 1 && (
                <p className="text-sm text-gray-500">The whole expense goes to {who(participants[0])}.</p>
              )
            )}
          </div>
        )}
      </section>

      {/* Result: who owes whom for this expense */}
      {preview.ok && (
        <section className="border border-line bg-white p-4 text-sm">
          <p className="mb-2 font-medium text-accent-dark">
            {who(paidById)} paid {base(preview.expense.amount)}
            {foreign && <span className="font-normal text-gray-500"> ({orig(preview.expense.originalAmount)})</span>}
          </p>
          <ul className="space-y-1 text-gray-700">
            {preview.expense.shares.map((s) =>
              s.memberId === paidById ? (
                <li key={s.memberId}>
                  {s.memberId === myId ? "Your" : `${nameOf(s.memberId)}’s`} own share: {base(s.amount)}
                </li>
              ) : (
                <li key={s.memberId}>
                  {s.memberId === myId ? (
                    <>
                      <strong>You</strong> owe {who(paidById)} <strong>{base(s.amount)}</strong>
                    </>
                  ) : (
                    <>
                      <strong>{nameOf(s.memberId)}</strong> owes {paidById === myId ? "you" : nameOf(paidById)}{" "}
                      <strong>{base(s.amount)}</strong>
                    </>
                  )}
                </li>
              ),
            )}
          </ul>
        </section>
      )}

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <button type="submit" disabled={saving || rateState.status === "loading"} className={primaryButtonClass}>
        {saving ? "Saving…" : expenseId ? "Save changes" : "Save expense"}
      </button>
    </form>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid gap-1 rounded-xl bg-gray-100 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={o.id === value}
          className={`rounded-lg py-2 text-sm ${o.id === value ? "bg-fg font-semibold text-canvas" : "text-gray-500"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-4 py-2 text-sm ${
        on ? "border-fg bg-fg font-medium text-canvas" : "border-line bg-white text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "pt-1 font-semibold text-gray-900" : "text-gray-600"}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
