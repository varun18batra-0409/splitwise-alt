"use client";

import { ExpenseGlyph } from "./ExpenseGlyph";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addExpense, lookupRate } from "@/app/actions";
import { CATEGORIES, analyzeName, applySuggestion, getCategory } from "@/lib/categories";
import { computeTotals, PAYMENT_METHODS, type PaymentMethod } from "@/lib/conversion";
import { buildExpense, chosenMarkupBp, type ExpenseDraft } from "@/lib/expense";
import { currencyInfo, formatMoney, formatPercent, isSupportedCurrency, parseAmount, parsePercent, toInputAmount } from "@/lib/money";
import { ItemSplit } from "./ItemSplit";
import { QuickLine } from "./QuickLine";
import { CurrencyPicker } from "./CurrencyPicker";
import { expensePairs, payersJson } from "@/lib/payers";
import { participantsFor, type ForMode, type SplitType } from "@/lib/split";
import { niceDate, rateText } from "@/lib/format";
import { dayKey, todayKey } from "@/lib/dates";
import { inputClass, primaryButtonClass } from "./ui";

type Member = { id: string; name: string };
type RateState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ok"; rate: string; date: string; stale: boolean }
  | { status: "missing"; message: string };

const labelClass = "mb-2 block text-sm font-medium text-gray-600";

export type { ExpenseInitial } from "@/lib/expense-initial";
import type { ExpenseInitial } from "@/lib/expense-initial";

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
  tz,
  weights,
  splitName = "Group split",
  billRun,
}: {
  groupId: string;
  baseCurrency: string;
  groupMarkupBp: number;
  members: Member[];
  myId: string;
  expenseId?: string; // editing this expense
  initial?: ExpenseInitial;
  tz?: string; // the person's time zone, for "today"
  weights?: Record<string, number>; // the group's own split (hundredths of a share); all equal = none
  splitName?: string; // "Our split" (couple), "Flat split" (home)…
  billRun?: { billId: string; period: string }; // "Enter amount" for a waiting bill
}) {
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";
  const who = (id: string) => (id === myId ? "You" : nameOf(id));

  // 1–4: what, how much, category, currency
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const today = todayKey(new Date(), tz);
  const yesterday = dayKey(new Date(Date.now() - 86_400_000), tz);
  const [date, setDate] = useState(initial?.date ?? today);
  const [pickingDate, setPickingDate] = useState(Boolean(initial && initial.date !== today && initial.date !== yesterday));
  const [showDate, setShowDate] = useState(false);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [showNotes, setShowNotes] = useState(Boolean(initial?.notes));
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
  const [multiPay, setMultiPay] = useState(Boolean(initial?.multiPay));
  const [kind, setKind] = useState<"expense" | "refund">(initial?.kind ?? "expense");
  const [payers, setPayers] = useState<Record<string, string>>(initial?.payers ?? {});
  const [forMode, setForMode] = useState<ForMode>(initial?.forMode ?? "everyone");
  const [selected, setSelected] = useState<string[]>(initial?.selected ?? memberIds);
  const [onePersonId, setOnePersonId] = useState(initial?.onePersonId || (memberIds.find((id) => id !== myId) ?? myId));
  // The group's own split (e.g. 1.2 / 1 / 1, or a couple's 55 / 45), if it isn't equal.
  const groupShares = useMemo(() => {
    const w = memberIds.map((id) => weights?.[id] ?? 100);
    if (w.every((x) => x === w[0])) return null;
    return Object.fromEntries(memberIds.map((id, i) => [id, String(Number((w[i] / 100).toFixed(2)))]));
  }, [memberIds, weights]);
  const groupSplitLabel = groupShares
    ? (() => {
        const w = memberIds.map((id) => weights?.[id] ?? 100);
        const pct = w.length === 2 && w[0] + w[1] === 100;
        return w.map((x) => (pct ? String(x) : String(Number((x / 100).toFixed(2))))).join(" / ");
      })()
    : "";
  const [splitType, setSplitType] = useState<SplitType>(initial?.splitType ?? (groupShares ? "shares" : "equal"));
  const [shares, setShares] = useState<Record<string, string>>(initial?.shares ?? groupShares ?? {});
  const [exact, setExact] = useState<Record<string, string>>(initial?.exact ?? {});
  const [percent, setPercent] = useState<Record<string, string>>(initial?.percent ?? {});

  const [showOnly, setShowOnly] = useState(false);
  const [showItems, setShowItems] = useState(false); // split by item
  const [showFx, setShowFx] = useState(false); // currency details (rate, card fee, calculation)
  const [usingLast, setUsingLast] = useState(false); // the last split in this group was filled in

  const [error, setError] = useState("");
  const [saving, startSaving] = useTransition();
  // One key per opened form: if the save is sent twice, it's saved once.
  const [requestKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`));

  // Remember how the last expense in this group was split (who it was for,
  // how, and how it was paid) and start the next one the same way.
  const splitKey = `split-defaults-${groupId}`;
  useEffect(() => {
    if (initial) return; // editing: keep the expense's own split
    try {
      const raw = localStorage.getItem(splitKey);
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<{ forMode: ForMode; selected: string[]; onePersonId: string; splitType: SplitType; percent: Record<string, string>; paymentMethod: PaymentMethod }>;
      const known = (id: unknown) => typeof id === "string" && memberIds.includes(id);
      if (d.paymentMethod && PAYMENT_METHODS.some((p) => p.id === d.paymentMethod)) setPaymentMethod(d.paymentMethod);
      if (d.forMode === "selected" && Array.isArray(d.selected) && d.selected.filter(known).length > 0) {
        setForMode("selected");
        setSelected(d.selected.filter(known));
      } else if (d.forMode === "one" && known(d.onePersonId)) {
        setForMode("one");
        setOnePersonId(d.onePersonId as string);
      }
      if (d.splitType === "percent" && d.percent && typeof d.percent === "object") {
        setSplitType("percent");
        setPercent(d.percent);
      }
      if (d.forMode === "selected" || d.forMode === "one" || d.splitType === "percent") setUsingLast(true);
    } catch {
      /* storage unavailable or old data: keep the defaults */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitKey]);

  function rememberSplit() {
    try {
      localStorage.setItem(
        splitKey,
        JSON.stringify({ forMode, selected, onePersonId, splitType: splitType === "exact" ? "equal" : splitType, percent, paymentMethod }),
      );
    } catch {
      /* ignore */
    }
  }

  function resetSplit() {
    setForMode("everyone");
    setSplitType("equal");
    setSelected(memberIds);
    setShowPeople(false);
    setShowOnly(false);
    setUsingLast(false);
  }

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
  // Currency details open by themselves only when there's no rate yet to work with.
  const fxOpen = showFx || (rateState.status === "missing" && !manualRate);
  const effectiveRate = !foreign ? "1" : usingManualRate ? manualRate : rateState.status === "ok" ? rateState.rate : "";

  const nameCheck = analyzeName(name);
  const category = getCategory(pickedCategory ?? nameCheck.category);
  const [dismissedTypo, setDismissedTypo] = useState("");
  const typo = nameCheck.suggestion && nameCheck.suggestion.wrong !== dismissedTypo ? nameCheck.suggestion : null;
  const draft: ExpenseDraft = {
    amount, currency, paidById, forMode, selected, onePersonId, splitType, exact, percent, shares,
    kind, multiPay, payers, paymentMethod, markupChoice, markupCustom,
  };
  const ctx = { memberIds, baseCurrency, groupMarkupBp, rate: effectiveRate };
  const markupBp = chosenMarkupBp(draft, groupMarkupBp);
  const totals = computeTotals({ amount, currency, baseCurrency, rate: effectiveRate, paymentMethod, markupBp: markupBp ?? 0 });
  const preview = buildExpense(draft, ctx);
  const participants = participantsFor({ ...draft, memberIds });

  const base = (minor: number) => formatMoney(minor, baseCurrency);
  const orig = (minor: number) => formatMoney(minor, currency);
  const cur = currencyInfo(currency);

  // Running total for the payers' amounts.
  const payersLeft = (() => {
    if (!multiPay || !totals.originalAmount) return null;
    const typed = memberIds.reduce((s, id) => s + (parseAmount(payers[id] ?? "", currency) ?? 0), 0);
    const left = totals.originalAmount - typed;
    return { text: left === 0 ? `✓ Adds up to ${orig(totals.originalAmount)}` : left > 0 ? `${orig(left)} still to assign` : `${orig(-left)} too much`, state: left === 0 ? "done" : left > 0 ? "left" : "over" };
  })();

  // Running total for custom amounts / percentages.
  const remaining = (() => {
    if (participants.length < 2 || splitType === "equal" || splitType === "shares" || !totals.originalAmount) return null;
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
    participants.length <= 1
      ? "100% to them"
      : splitType === "equal"
        ? "split equally"
        : splitType === "exact"
          ? "custom amounts"
          : splitType === "shares"
            ? "by shares"
            : "by percentage";
  // "Our split" is on: everyone, by the group's own shares, unchanged.
  const groupSplitOn =
    Boolean(groupShares) && forMode === "everyone" && splitType === "shares" && memberIds.every((id) => (shares[id] ?? "1") === groupShares?.[id]);
  const shareOf = (id: string) => (preview.ok ? preview.expense.shares.find((s) => s.memberId === id)?.amount ?? 0 : null);
  function stepShare(id: string, delta: number) {
    setShares((prev) => {
      const now = Number((prev[id] ?? "1").replace(",", ".")) || 0;
      const next = Math.min(20, Math.max(0, Math.round((now + delta) * 100) / 100));
      return { ...prev, [id]: String(next) };
    });
  }

  const [again, setAgain] = useState(false); // "Save & add another" was tapped (for the label)
  const againRef = useRef(false); // read when saving (state isn't updated yet inside the same tap)
  // "Looks like a duplicate": what it matched, and whether the person said it's a different one.
  const [dup, setDup] = useState<{ id: string; description: string; amount: number; by: string; when: string } | null>(null);
  const allowDupRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDup(null);
    if (!preview.ok) {
      setError(preview.error);
      if (/person|amounts|percent/i.test(preview.error)) setShowPeople(true);
      return;
    }
    if (!expenseId) rememberSplit();
    startSaving(async () => {
      try {
        const res = await addExpense({ ...draft, billRun, again: againRef.current, allowDuplicate: allowDupRef.current, requestKey, groupId, name, notes, baseVersion: initial?.version, category: category.id, expenseId, date, rateMode: usingManualRate ? "manual" : keepSavedRate ? "keep" : "auto", manualRate });
        if (res?.duplicateOf) setDup(res.duplicateOf);
        else if (res?.error) setError(res.error);
      } catch (err) {
        // Going to the group afterwards is Next.js's own signal: let it through.
        if (String((err as { digest?: string })?.digest ?? "").startsWith("NEXT_")) throw err;
        // No signal, or the server hiccuped. Saving again is safe (this form's key means it's only ever added once).
        setError("Couldn’t reach Loopin. Check your connection and tap Save again.");
      }
    });
  }

  return (
    // Saving is already safe to repeat (one request key per form, and the
    // buttons are off while saving), so the page-wide double-tap lock isn't needed here.
    <form ref={formRef} onSubmit={save} data-allow-repeat="1" className="space-y-7">
      {/* Money spent (normal) or money back (a refund, a deposit returned) */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-mist p-1" role="radiogroup" aria-label="Money spent or money back">
        {(
          [
            ["expense", "Money spent"],
            ["refund", "Money back"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={kind === id}
            onClick={() => setKind(id)}
            className={`rounded-lg py-2.5 text-sm ${kind === id ? "bg-fg font-semibold text-canvas" : "text-gray-500"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {kind === "refund" && (
        <p className="-mt-4 text-sm text-gray-500">A refund, a returned item or a deposit coming back. Whoever got it owes the people it’s shared with.</p>
      )}

      {/* Quick line: "Dinner 2400 Ravi paid split with Asha Meera" fills the form below. */}
      {!expenseId && members.length > 1 && (
        <QuickLine
          members={members.map((m) => ({ id: m.id, name: m.name }))}
          myId={myId}
          who={who}
          currency={currency}
          onFill={(q) => {
            if (q.name) setName(q.name);
            if (q.amount) setAmount(q.amount);
            if (q.paidById) {
              setMultiPay(false);
              setPaidById(q.paidById);
            }
            if (q.forIds) {
              setShowOnly(false);
              setShowItems(false);
              setSplitType("equal");
              if (q.forIds.length === memberIds.length) setForMode("everyone");
              else if (q.forIds.length === 1) {
                setForMode("one");
                setOnePersonId(q.forIds[0]);
              } else {
                setForMode("selected");
                setSelected(q.forIds);
              }
            }
          }}
        />
      )}

      {/* Who paid — visible at the top, one tap to change */}
      {members.length > 1 && (
        <div>
          <span className={labelClass}>{kind === "refund" ? "Who got the money?" : "Who paid?"}</span>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
            {[...members].sort((a, b) => (a.id === myId ? -1 : b.id === myId ? 1 : 0)).map((m) => (
              <Chip
                key={m.id}
                on={!multiPay && m.id === paidById}
                onClick={() => {
                  setMultiPay(false);
                  setPaidById(m.id);
                }}
              >
                {!multiPay && m.id === paidById && "✓ "}
                {who(m.id)}
              </Chip>
            ))}
            <Chip
              on={multiPay}
              onClick={() => {
                setMultiPay(true);
                // Start from the current payer paying everything, so it already adds up.
                if (!Object.values(payers).some((v) => v.trim())) setPayers({ [paidById]: amount });
              }}
            >
              More than one
            </Chip>
          </div>
          {multiPay && (
            <div className="mt-3 rounded-2xl border border-line px-4 py-1">
              <ul className="divide-y divide-line">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-2">
                    <span className="flex-1">{who(m.id)}</span>
                    <span className="flex w-36 items-center rounded-xl border border-line px-3 focus-within:border-accent">
                      <span className="text-xs text-gray-400">{currency}</span>
                      <input
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`${who(m.id)} paid`}
                        value={payers[m.id] ?? ""}
                        onChange={(e) => setPayers((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        className="w-full bg-transparent py-2 text-right outline-none"
                      />
                    </span>
                  </li>
                ))}
              </ul>
              {payersLeft && (
                <p className={`pb-2 text-sm ${payersLeft.state === "done" ? "text-accent-dark" : payersLeft.state === "over" ? "text-red-600" : "text-gray-500"}`}>
                  {payersLeft.text}
                </p>
              )}
            </div>
          )}
        </div>
      )}

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
            <ExpenseGlyph title={name} category={category.id} size={26} className="rounded-[8px]!" />
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
                <span className="inline-flex items-center gap-1.5">
                  <ExpenseGlyph title="" category={c.id} size={18} className="rounded-[6px]!" />
                  {c.label}
                </span>
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

        {/* When it was spent — optional: today unless changed. */}
        {!showDate ? (
          <button type="button" onClick={() => setShowDate(true)} className="mt-2 py-1 text-sm text-gray-500">
            <CalIcon /> {date === today ? "Today" : date === yesterday ? "Yesterday" : niceDate(date)} · <span className="font-medium text-fg">Change</span>
          </button>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="When">
            <Chip on={!pickingDate && date === today} onClick={() => { setPickingDate(false); setDate(today); }}>
              Today
            </Chip>
            <Chip on={!pickingDate && date === yesterday} onClick={() => { setPickingDate(false); setDate(yesterday); }}>
              Yesterday
            </Chip>
            {pickingDate ? (
              <input
                type="date"
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value || today)}
                aria-label="Date of the expense"
                className="rounded-full border border-fg bg-transparent px-3 py-1.5 text-sm text-fg outline-none [color-scheme:dark]"
              />
            ) : (
              <Chip on={false} onClick={() => setPickingDate(true)}>
                <CalIcon /> Pick date
              </Chip>
            )}
          </div>
        )}
      </div>

      {/* Foreign currency: one summary line; details (rate, card fee, how it adds up) on tap */}
      {foreign && !fxOpen && (
        <button
          type="button"
          onClick={() => setShowFx(true)}
          className="-mt-4 flex w-full items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 text-left text-sm active:bg-mist"
        >
          <span className="min-w-0 text-gray-600">
            {rateState.status === "loading" ? (
              "Getting today’s rate…"
            ) : totals.ok ? (
              <>
                {PAYMENT_METHODS.find((p) => p.id === paymentMethod)?.label} · {orig(totals.originalAmount)} ≈{" "}
                <strong className="font-medium text-fg">{base(totals.total)}</strong>
                {totals.markupAmount > 0 && ` incl. ${base(totals.markupAmount)} card fee`}
              </>
            ) : rateState.status === "ok" ? (
              <>1 {currency} = {rateText(rateState.rate, baseCurrency)} · {PAYMENT_METHODS.find((p) => p.id === paymentMethod)?.label}</>
            ) : (
              "Set the exchange rate"
            )}
          </span>
          <span className="shrink-0 font-medium text-fg">Details</span>
        </button>
      )}
      {foreign && fxOpen && (
        <section className="space-y-4 rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
          <div className="-mb-2 flex justify-end">
            <button type="button" onClick={() => setShowFx(false)} className="text-sm font-medium text-fg">
              Hide details
            </button>
          </div>
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
                      className="w-16 bg-transparent py-1.5 text-base outline-none"
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

      {/* How to split: equal for everyone (default), or differently */}
      <section>
        <span className={labelClass}>How to split?</span>
        <div className="flex flex-wrap gap-2">
          {groupShares && (
            <Chip
              on={!showPeople && !showOnly && groupSplitOn}
              onClick={() => {
                setShowPeople(false);
                setShowOnly(false);
                setForMode("everyone");
                setSplitType("shares");
                setShares(groupShares);
              }}
            >
              {splitName} <span className="opacity-60">{groupSplitLabel}</span>
            </Chip>
          )}
          <Chip
            on={!showPeople && !showOnly && forMode === "everyone" && splitType === "equal"}
            onClick={resetSplit}
          >
            Everyone equally
          </Chip>
          {members.length > 2 && (
            <Chip
              on={showOnly || (!showPeople && forMode === "selected" && splitType === "equal")}
              onClick={() => {
                setShowPeople(false);
                setShowOnly(true);
                setSplitType("equal");
                if (forMode !== "selected") {
                  setForMode("selected");
                  setSelected([]);
                }
              }}
            >
              Only some
            </Chip>
          )}
          <Chip
            on={showPeople || (!showOnly && !groupSplitOn && (forMode === "one" || splitType !== "equal"))}
            onClick={() => {
              setShowOnly(false);
              setShowItems(false);
              setShowPeople(true);
            }}
          >
            Custom ⚙
          </Chip>
          {kind === "expense" && members.length > 1 && (
            <Chip
              on={showItems}
              onClick={() => {
                setShowOnly(false);
                setShowPeople(false);
                setShowItems((v) => !v);
              }}
            >
              By item 🧾
            </Chip>
          )}
        </div>
        {showItems && (
          <ItemSplit
            people={[...members].sort((a, b) => (a.id === myId ? -1 : b.id === myId ? 1 : 0)).map((m) => ({ id: m.id, label: who(m.id) }))}
            currency={currency}
            onClose={() => setShowItems(false)}
            onApply={({ total, perPerson, note }) => {
              const ids = memberIds.filter((id) => (perPerson[id] ?? 0) > 0);
              setAmount(toInputAmount(total, currency));
              setForMode(ids.length === memberIds.length ? "everyone" : "selected");
              setSelected(ids);
              setSplitType("exact");
              setExact(Object.fromEntries(ids.map((id) => [id, toInputAmount(perPerson[id], currency)])));
              setNotes((n) => (n.trim() ? `${n.trim()}\n${note}` : note).slice(0, 500));
              setShowNotes(true);
              setShowItems(false);
              setShowOnly(false);
              setShowPeople(true);
            }}
          />
        )}
        {showOnly && !showPeople && (
          <div className="mt-3">
            <p className="mb-2 text-sm text-gray-500">Tap who it was for · split equally</p>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const on = forMode === "selected" && selected.includes(m.id);
                return (
                  <Chip
                    key={m.id}
                    on={on}
                    onClick={() => {
                      setForMode("selected");
                      setSelected((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]));
                    }}
                  >
                    {on && "✓ "}
                    {who(m.id)}
                  </Chip>
                );
              })}
            </div>
          </div>
        )}
        {!showPeople && !showOnly && !groupSplitOn && (forMode !== "everyone" || splitType !== "equal") && (
          <p className="mt-2 text-sm text-gray-500">
            For <strong className="text-fg">{forSummary}</strong> · {splitSummary}
            {usingLast && (
              <>
                {" "}
                · <span className="text-gray-400">same as last time</span>{" "}
                <button type="button" onClick={resetSplit} className="font-medium text-fg underline underline-offset-4">
                  Reset
                </button>
              </>
            )}
          </p>
        )}
        {showPeople && (
          <div className="mt-3 space-y-6 rounded-2xl border border-line px-4 pb-4 pt-4">
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
                    { id: "shares", label: "Shares" },
                  ]}
                  value={splitType}
                  onChange={(v) => setSplitType(v as SplitType)}
                />
                {splitType === "shares" && (
                  <ul className="mt-3 divide-y divide-line">
                    {participants.map((id) => {
                      const amt = shareOf(id);
                      return (
                        <li key={id} className="flex items-center gap-2 py-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{who(id)}</span>
                            {amt !== null && <span className="block text-xs text-gray-400">{base(amt)}</span>}
                          </span>
                          <button type="button" aria-label={`Fewer shares for ${who(id)}`} onClick={() => stepShare(id, -0.5)} className="h-10 w-10 border border-line text-lg active:bg-mist">
                            −
                          </button>
                          <input
                            inputMode="decimal"
                            aria-label={`${who(id)} shares`}
                            value={shares[id] ?? "1"}
                            onChange={(e) => setShares((prev) => ({ ...prev, [id]: e.target.value }))}
                            className="w-14 bg-transparent py-2 text-center font-display text-lg outline-none"
                          />
                          <button type="button" aria-label={`More shares for ${who(id)}`} onClick={() => stepShare(id, 0.5)} className="h-10 w-10 border border-line text-lg active:bg-mist">
                            +
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {(splitType === "exact" || splitType === "percent") && (
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

      {/* Notes (optional) */}
      <div>
        {showNotes ? (
          <label className="block">
            <span className={labelClass}>Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="e.g. Rahul paid the tip separately"
              className={`${inputClass} resize-none`}
            />
          </label>
        ) : (
          <button type="button" onClick={() => setShowNotes(true)} className="flex items-center gap-2 py-1 text-sm font-medium text-fg">
            <span className="text-lg leading-none">＋</span> Add notes
          </button>
        )}
      </div>

      {/* Result: who owes whom for this expense (exactly what will be saved) */}
      {preview.ok && (() => {
        const x = preview.expense;
        const paid = x.payers.length ? x.payers : [{ memberId: x.paidById, amount: x.amount }];
        const pairs = expensePairs({ ...x, payers: payersJson(x.payers) });
        const refund = x.kind === "refund";
        return (
          <section className="border border-line bg-white p-4 text-sm">
            <p className="mb-2 font-medium text-accent-dark">
              {paid.map((p, i) => (
                <span key={p.memberId}>
                  {i > 0 && " + "}
                  {who(p.memberId)}
                  {paid.length > 1 && ` ${base(p.amount)}`}
                </span>
              ))}{" "}
              {refund ? "got back" : "paid"} {paid.length > 1 ? `(${base(x.amount)})` : base(x.amount)}
              {foreign && <span className="font-normal text-gray-500"> ({orig(x.originalAmount)})</span>}
            </p>
            <ul className="space-y-1 text-gray-700">
              {pairs.map((p) => (
                <li key={`${p.from}-${p.to}`}>
                  <strong>{who(p.from)}</strong> {p.from === myId ? "owe" : "owes"} {p.to === myId ? "you" : nameOf(p.to)} <strong>{base(p.amount)}</strong>
                </li>
              ))}
              {pairs.length === 0 && <li>Nobody owes anyone for this one.</li>}
            </ul>
          </section>
        );
      })()}

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {dup && (
        <div role="status" className="rounded-2xl border border-[#5a3a20] bg-owe-soft px-4 py-3 text-sm">
          <p>
            Looks like “{dup.description} {base(dup.amount)}”, added {niceDate(dayKey(new Date(dup.when), tz))} by {dup.by}.
          </p>
          <div className="mt-2 flex gap-5">
            <a href={`/groups/${groupId}?tab=activity&q=${encodeURIComponent(dup.description)}`} className="font-semibold text-fg underline underline-offset-4">
              See it
            </a>
            <button
              type="button"
              onClick={() => {
                allowDupRef.current = true;
                setDup(null);
                formRef.current?.requestSubmit();
              }}
              className="font-medium text-gray-500 underline underline-offset-4"
            >
              It’s a different one
            </button>
          </div>
        </div>
      )}

      <div className={expenseId ? "" : "flex gap-2.5"}>
        <button
          type="submit"
          onClick={() => {
            againRef.current = false;
            setAgain(false);
          }}
          disabled={saving || rateState.status === "loading"}
          className={`${primaryButtonClass} ${expenseId ? "" : "flex-1"}`}
        >
          {saving && !again ? "Saving…" : expenseId ? "Save changes" : kind === "refund" ? "Save money back" : "Save expense"}
        </button>
        {!expenseId && (
          <button
            type="submit"
            onClick={() => {
              againRef.current = true;
              setAgain(true);
            }}
            disabled={saving || rateState.status === "loading"}
            className="flex-1 border border-gray-300 px-3 py-3.5 text-center text-sm font-semibold text-fg active:bg-mist disabled:opacity-50"
          >
            {saving && again ? "Saving…" : "Save & add another"}
          </button>
        )}
      </div>
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
      className={`shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm ${
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

// A plain calendar outline (the calendar emoji shows "July 17" on many phones, which reads like a wrong date).
function CalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden className="mr-1 inline-block align-[-2px]">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}
