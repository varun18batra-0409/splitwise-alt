"use client";

import { avatarTone } from "@/components/ui";
import { ExpenseGlyph } from "./ExpenseGlyph";
import { revealSelected } from "@/lib/reveal-selected";
import { useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { markupBox, markupBoxStart, markupBoxValue } from "@/lib/markup-box";
import { addExpense, lookupRate } from "@/app/actions";
import { CATEGORIES, analyzeName, applySuggestion, getCategory } from "@/lib/categories";
import { computeTotals, fxLine, PAYMENT_METHODS, rateDateLabel, type PaymentMethod } from "@/lib/conversion";
import { buildExpense, chosenMarkupBp, type ExpenseDraft } from "@/lib/expense";
import { currencyInfo, formatMoney, formatPercent, isSupportedCurrency, parseAmount, parsePercent } from "@/lib/money";
import { amountEchoFor, amountSizeClass, regroupAmount } from "@/lib/amount-input";
import { AmountInput } from "./AmountInput";
import { QuickLine } from "./QuickLine";
import { BillScan, type ScannedBill } from "./BillScan";
import { useRequestKey } from "./FreshKeyInput";
import { SpinWheel } from "./SpinWheel";
import { CurrencyPicker } from "./CurrencyPicker";
import { expensePairs, payersJson } from "@/lib/payers";
import { participantsFor, type ForMode, type SplitType } from "@/lib/split";
import { MAX_ITEM_LINES, splitByItems } from "@/lib/item-split";
import { chooseSplit, splitFields, type SplitAction } from "@/lib/split-draft";
import { compactName, niceDate, rateText } from "@/lib/format";
import { dayKey, todayKey } from "@/lib/dates";
import { addDays } from "@/lib/local-time";
import { inputClass, primaryButtonClass } from "./ui";
import { errorNeedsMore, fasterEntryColumns, shouldOpenMore } from "@/lib/add-expense-more";
import { resultSentence } from "@/lib/add-expense-sentence";
import { pairLine } from "@/lib/direct";
import { newDraftKey } from "@/lib/offline/client";
import { askToKeep, openStore } from "@/lib/offline/idb";
import { addDraft } from "@/lib/offline/store";
import type { DraftInput } from "@/lib/offline/types";
import { fixNeedsOwnRate } from "@/lib/offline/fix-rate";
import { W } from "@/lib/offline/words";

type Member = { id: string; name: string };
type RateState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ok"; rate: string; date: string; stale: boolean }
  | { status: "missing"; message: string };

const labelClass = "mb-2 block text-[13px] font-semibold text-fg/55";

export type { ExpenseInitial } from "@/lib/expense-initial";
import type { ExpenseInitial } from "@/lib/expense-initial";
import { DateField } from "@/components/DateField";

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
  spin = true,
  billRun,
  ai = false,
  existingReceiptId,
  initialItems,
  pair,
  offline,
  fixed,
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
  splitName?: string; // "Our split" (couple), "Home split" (home)…
  spin?: boolean; // Spin for it (every group but card nights)
  billRun?: { billId: string; period: string }; // "Enter amount" for a waiting bill
  ai?: boolean; // bill reading and spoken lines are switched on (an Anthropic key is set)
  existingReceiptId?: string; // editing: the bill photo already kept with this expense
  initialItems?: { name: string; amount: string; people: string[] }[]; // editing an expense split by item
  // Add expenses offline (version 1). `offline`: this is the offline screen: nothing is sent, "Save on this phone" keeps what was typed.
  // Scan a bill, Speak, Type a line, bill photo, Items and Save & add another are left out. `fixed`: an expense kept on this phone that the
  // server refused, opened to fix: an ordinary online save that keeps its own one-time key (a refusal never used it) and its typed rate.
  // Nothing else about the online form differs from before: its key, its "couldn't confirm" message, no "Save on this phone".
  offline?: { groupName: string; snapshotAt: string; onSaved: () => void };
  fixed?: { key: string; manualRate?: string };
  pair?: { otherId: string; otherName: string }; // an expense with one person, no group: "For" reads Both of you / Just them / Just you, and a line says who owes whom
}) {
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";
  const payerRow = useRef<HTMLDivElement>(null);
  const who = (id: string) => (id === myId ? "You" : compactName(nameOf(id), members.map((m) => m.name)));

  // 1–4: what, how much, category, currency
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(regroupAmount(initial?.amount ?? "", initial?.currency ?? baseCurrency));
  // The amount box shows grouped digits as you type (1,23,456.50 for rupees): the founder chose this on 16 Nov, reversing the earlier
  // "plain digits only" rule. AmountInput keeps the caret after the same digit, so the number never jumps under the finger.
  // The text sent to the server is this same text; parseAmount ignores the commas.
  const today = todayKey(new Date(), tz);
  const yesterday = addDays(today, -1);
  const [date, setDate] = useState(initial?.date ?? today);
  const [pickingDate, setPickingDate] = useState(Boolean(initial && initial.date !== today && initial.date !== yesterday));
  const [showDate, setShowDate] = useState(false);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // "More" (notes, several payers, spin) is closed unless editing something that already uses it, so nothing is hidden.
  const [showMore, setShowMore] = useState(shouldOpenMore(initial));
  const openBill = useRef<(() => void) | null>(null); // "Scan a bill" opens the photo picker inside BillScan
  const openQuick = useRef<((speak: boolean) => void) | null>(null); // "Speak" / "Type a line" open the quick line inside QuickLine, from the tap itself
  const quickOk = !expenseId && members.length > 1;
  const [scanBusy, setScanBusy] = useState(false); // a bill is being read: the Scan button waits
  const entryColumns = fasterEntryColumns({ billRun: Boolean(billRun), quickOk, editing: Boolean(expenseId), hasPhoto: Boolean(existingReceiptId) });
  const [pickedCategory, setPickedCategory] = useState<string | null>(initial?.category || null); // null (or "") = smart guess from the name
  const [currency, setCurrency] = useState(initial?.currency ?? baseCurrency);
  const [showCurrencies, setShowCurrencies] = useState(false);
  // A new currency can group differently (rupees: 1,23,456; others: 123,456), so the box is regrouped when it changes.
  useEffect(() => setAmount((a) => regroupAmount(a, currency)), [currency]);
  const [showCategories, setShowCategories] = useState(false);

  // Conversion (only when currency ≠ group currency)
  const [rateState, setRateState] = useState<RateState>({ status: "none" });
  const [rateMode, setRateMode] = useState<"auto" | "manual">(fixed?.manualRate ? "manual" : "auto");
  const [manualRate, setManualRate] = useState(fixed?.manualRate ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initial?.paymentMethod ?? "card");
  const [markup, markupDo] = useReducer(markupBox, markupBoxStart(initial?.markupChoice ?? "group", initial?.markupCustom ?? ""));
  const markupChoice: ExpenseDraft["markupChoice"] = markup.choice;
  const markupCustom = markup.custom;
  const [showMarkup, setShowMarkup] = useState(false);
  // Editing: keep the rate saved with the expense unless the person asks for today's.
  const [keepSavedRate, setKeepSavedRate] = useState(Boolean(initial && initial.currency !== baseCurrency && initial.rate));

  // 5–7: who paid, who it was for, how to split
  const [showPeople, setShowPeople] = useState(Boolean(initialItems?.length)); // editing a split by item: open on the items
  const [paidById, setPaidById] = useState(initial?.paidById ?? myId);
  useEffect(() => revealSelected(payerRow.current), [paidById]); // the chosen payer is always fully in view
  const [multiPay, setMultiPay] = useState(Boolean(initial?.multiPay));
  const [kind, setKind] = useState<"expense" | "refund">(initial?.kind ?? "expense");
  const multiLabel = kind === "refund" ? "More than one person got it" : "More than one person paid";
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
  // Split by item: each line on the bill to the people who had it; tax and tip shared by what each had.
  const [byItem, setByItem] = useState(Boolean(initialItems?.length));
  const [receiptId, setReceiptId] = useState(""); // a bill photo to keep with this expense
  const [scannedItems, setScannedItems] = useState(0); // lines read off a scanned bill
  const [items, setItems] = useState<{ k: number; name: string; amount: string; people: string[] }[]>(
    initialItems?.length ? initialItems.map((x, i) => ({ k: i + 1, ...x })) : [{ k: 1, name: "", amount: "", people: [] }],
  );

  const [showFx, setShowFx] = useState(false); // currency details (rate, card fee, calculation)
  const [usingLast, setUsingLast] = useState(false); // the last split in this group was filled in
  // "Same as last time" goes away as soon as anything changes the split from what was filled in.
  const splitSig = JSON.stringify([byItem, forMode, selected, onePersonId, splitType, percent]);
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (!usingLast) {
      lastSig.current = null;
      return;
    }
    if (lastSig.current === null) lastSig.current = splitSig;
    else if (lastSig.current !== splitSig) setUsingLast(false);
  }, [usingLast, splitSig]);

  const [error, setError] = useState("");
  const [saving, startSaving] = useTransition();
  // One key per opened form: if the save is sent twice, it's saved once.
  const generatedKey = useRequestKey();
  const requestKey = fixed?.key ?? generatedKey;

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

  // Every split choice goes through chooseSplit, so picking anything but "Items" leaves item mode.
  function pickSplit(a: SplitAction) {
    const n = chooseSplit({ byItem, forMode, splitType }, a);
    setByItem(n.byItem);
    setForMode(n.forMode);
    setSplitType(n.splitType);
  }

  function resetSplit() {
    pickSplit({ kind: "everyone-equally" });
    setSelected(memberIds);
    setShowPeople(false);
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
  // Open and fix, another currency, a day before today: no live rate, the person enters the rate for that day (always false on the normal form).
  const ownRateOnly = fixNeedsOwnRate({ isFix: Boolean(fixed), foreign, day: date, today });
  useEffect(() => {
    if (!foreign) {
      setRateState({ status: "none" });
      return;
    }
    if (ownRateOnly) {
      setRateState({ status: "missing", message: W.fixRateNote(niceDate(date)) });
      return;
    }
    // Offline there is no rate to fetch: the one for the expense's own day is added when it is added online (or typed here by hand).
    if (offline) {
      setRateState({ status: "missing", message: W.foreignNote(niceDate(date)) });
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
  }, [currency, baseCurrency, foreign, keepSavedRate, initial, offline, ownRateOnly]);

  // remember = also the group's starting currency next time (a pick by hand, not a scanned bill).
  function chooseCurrency(code: string, remember = true) {
    setCurrency(code);
    setKeepSavedRate(false);
    setShowCurrencies(false);
    setRateMode("auto");
    setManualRate("");
    if (!remember) return;
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
  const digits = currencyInfo(currency).decimals;
  const itemSplit = byItem
    ? splitByItems(
        items.map((x) => ({ name: x.name, amount: parseAmount(x.amount, currency) ?? (x.amount.trim() ? -1 : 0), people: x.people })),
        parseAmount(amount, currency) ?? 0,
      )
    : null;
  const itemExact = itemSplit?.ok ? Object.fromEntries(Object.entries(itemSplit.amounts).map(([id, m]) => [id, (m / 10 ** digits).toFixed(digits)])) : {};
  const draft: ExpenseDraft = {
    amount, currency, paidById, ...splitFields({ byItem, forMode, splitType, exact, itemExact }), selected, onePersonId, percent, shares,
    kind, multiPay, payers, paymentMethod, markupChoice, markupCustom,
  };
  const ctx = { memberIds, baseCurrency, groupMarkupBp, rate: effectiveRate };
  const markupBp = chosenMarkupBp(draft, groupMarkupBp);
  const totals = computeTotals({ amount, currency, baseCurrency, rate: effectiveRate, paymentMethod, markupBp: markupBp ?? 0 });
  const preview = buildExpense(draft, ctx);
  const participants = participantsFor({ ...draft, memberIds });
  // Who owes whom for this expense (exactly what will be saved), and what that means for you.
  const pairs = preview.ok ? expensePairs({ ...preview.expense, payers: payersJson(preview.expense.payers) }) : [];

  const base = (minor: number) => formatMoney(minor, baseCurrency);
  const orig = (minor: number) => formatMoney(minor, currency);
  const cur = currencyInfo(currency);
  const echo = amountEchoFor(amount, currency);
  const fxMaths = foreign && totals.ok
    ? fxLine({ originalAmount: totals.originalAmount, originalCurrency: currency, baseCurrency, exchangeRate: totals.exchangeRate, convertedAmount: totals.convertedAmount, markupBp: totals.markupBp, markupAmount: totals.markupAmount, amount: totals.total })
    : null;
  const fxSource = usingManualRate
    ? "Rate entered by hand"
    : rateState.status === "ok"
      ? rateDateLabel({ rateDate: rateState.date, expenseDay: date, saved: keepSavedRate, stale: rateState.stale }, niceDate)
      : null;

  // Running total for the payers' amounts.
  const payersLeft = (() => {
    if (!multiPay || !totals.originalAmount) return null;
    const typed = memberIds.reduce((s, id) => s + (parseAmount(payers[id] ?? "", currency) ?? 0), 0);
    const left = totals.originalAmount - typed;
    return { text: left === 0 ? `✓ Adds up to ${orig(totals.originalAmount)}` : left > 0 ? `${orig(left)} still to assign` : `${orig(-left)} too much`, state: left === 0 ? "done" : left > 0 ? "left" : "over" };
  })();

  // Running total for custom amounts / percentages.
  const remaining = (() => {
    if (byItem || participants.length < 2 || splitType === "equal" || splitType === "shares" || !totals.originalAmount) return null;
    if (splitType === "exact") {
      const typed = participants.reduce((s, id) => s + (parseAmount(exact[id] ?? "", currency) ?? 0), 0);
      const left = totals.originalAmount - typed;
      return { text: left === 0 ? "✓ Adds up" : left > 0 ? `${orig(left)} left to assign` : `${orig(-left)} too much`, state: left === 0 ? "done" : left > 0 ? "left" : "over" };
    }
    const typed = participants.reduce((s, id) => s + (parsePercent(percent[id] ?? "") ?? 0), 0);
    const left = 10000 - typed;
    return { text: left === 0 ? "✓ Adds up to 100%" : left > 0 ? `${formatPercent(left)} left to assign` : `${formatPercent(-left)} too much`, state: left === 0 ? "done" : left > 0 ? "left" : "over" };
  })();

  // "Our split" is on: everyone, by the group's own shares, unchanged.
  const groupSplitOn =
    Boolean(groupShares) && forMode === "everyone" && splitType === "shares" && memberIds.every((id) => (shares[id] ?? "1") === groupShares?.[id]);
  // The one row of choices. Amounts, %, Shares and Items keep whoever was picked under "Only some" (an expense saved as
  // "selected" with amounts, percentages or shares opens on that choice, for those people, and saves the same data).
  const choice: "everyone" | "only" | "exact" | "percent" | "shares" | "items" = byItem
    ? "items"
    : splitType !== "equal"
      ? splitType
      : forMode === "everyone"
        ? "everyone"
        : "only";
  // The people list is open under Amounts / % / Shares / Items. The group's own split stays closed until Shares is tapped.
  const peopleOpen = byItem || (splitType !== "equal" && (showPeople || !groupSplitOn));
  function chooseOnly() {
    if (choice === "only") return;
    const keep = forMode === "selected" && !byItem ? selected : forMode === "one" && !byItem && onePersonId ? [onePersonId] : [];
    pickSplit({ kind: "only-some" });
    setShowPeople(false);
    setSelected(keep);
  }
  function chooseHow(id: "exact" | "percent" | "shares" | "items") {
    // Fewer than two people picked can't be split by amounts, percentages or shares: start from everyone.
    const picked = forMode === "selected" ? selected.length : forMode === "one" ? 1 : memberIds.length;
    pickSplit({ kind: "how", id });
    if (id !== "items" && forMode !== "everyone" && picked < 2) setForMode("everyone"); // after pickSplit, which keeps the old forMode
    setShowPeople(true);
  }
  function toggleOnly(id: string) {
    const cur = forMode === "one" ? (onePersonId ? [onePersonId] : []) : selected;
    setByItem(false);
    setForMode("selected");
    setSelected(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }
  const shareOf = (id: string) => (preview.ok ? preview.expense.shares.find((s) => s.memberId === id)?.amount ?? 0 : null);
  function stepShare(id: string, delta: number) {
    setShares((prev) => {
      const now = Number((prev[id] ?? "1").replace(",", ".")) || 0;
      const next = Math.min(20, Math.max(0, Math.round((now + delta) * 100) / 100));
      return { ...prev, [id]: String(next) };
    });
  }

  const [again, setAgain] = useState(false); // "Save & add another" was tapped (for the label)
  // One key for this opened offline form: two quick taps on "Save on this phone" store one draft (a draft is stored by its key).
  const offlineKey = useRef<string | null>(null);
  const againRef = useRef(false); // read when saving (state isn't updated yet inside the same tap)
  // "Looks like a duplicate": what it matched, and whether the person said it's a different one.
  const [dup, setDup] = useState<{ id: string; description: string; amount: number; by: string; when: string } | null>(null);
  const allowDupRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  // What a scanned bill says: the shop, the total, the day and its lines (for split by item).
  function fillFromBill(b: ScannedBill): string | void {
    if (b.merchant && !name.trim()) setName(b.merchant);
    const code = b.currency && isSupportedCurrency(b.currency) ? b.currency : currency;
    // A bill in another currency switches this expense only, and says so: a misread
    // currency would otherwise change the amount a lot without anyone noticing.
    const switched = code !== currency ? `The bill looks like it's in ${code}, so the currency changed from ${currency}. Change it back if that's wrong.` : "";
    if (switched) chooseCurrency(code, false);
    if (b.total) setAmount(regroupAmount(String(b.total), code));
    if (b.date && b.date <= today && b.date >= `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`) {
      setDate(b.date); // the "Today" pill then shows that day; the three date buttons open only when it is tapped
    }
    if (b.items.length) {
      setItems(b.items.slice(0, MAX_ITEM_LINES).map((x, i) => ({ k: i + 1, name: x.name, amount: String(x.price), people: [] })));
      setScannedItems(b.items.length);
    }
    return switched;
  }
  // The bill's items go in the notes, so everyone can see how it was split.
  function withItems(text: string) {
    if (!itemSplit?.ok) return text;
    const list = items
      .filter((x) => x.name.trim() || x.amount.trim())
      .map((x) => `${x.name.trim() || "Item"} ${orig(parseAmount(x.amount, currency) ?? 0)} (${x.people.length === memberIds.length && memberIds.length > 2 ? "everyone" : x.people.map((id) => nameOf(id)).join(", ")})`)
      .join("; ");
    const extra = itemSplit.extra ? ` Tax, service and tip ${orig(itemSplit.extra)}, shared by what each had.` : "";
    // An earlier "By item" line (when editing) is replaced, not repeated.
    const own = text.split("\n").filter((l) => !l.startsWith("By item: ")).join("\n").trim();
    return [own, `By item: ${list}.${extra}`].filter(Boolean).join("\n").slice(0, 500);
  }
  // Add expenses offline: keep exactly what was typed on this phone (nothing is worked out here; the server does it when it is added).
  async function keepOnPhone(key: string, then: () => void) {
    const input: DraftInput = {
      key,
      groupId,
      memberId: myId,
      day: date,
      typedAt: Date.now(),
      name: name.trim(),
      amount,
      currency,
      category: category.id,
      paidById,
      multiPay,
      payers,
      forMode: draft.forMode,
      selected,
      onePersonId,
      splitType: draft.splitType,
      exact: draft.exact,
      percent,
      shares,
      kind,
      paymentMethod,
      markupChoice,
      markupCustom,
      notes: notes.trim(),
      rateMode: foreign && usingManualRate && manualRate.trim() ? "manual" : "auto",
      manualRate: foreign && usingManualRate ? manualRate.trim() : "",
      seen: { baseCurrency, cardMarkupBp: groupMarkupBp, activeMemberIds: memberIds, snapshotAt: offline?.snapshotAt ?? new Date().toISOString() },
    };
    try {
      const res = await addDraft(openStore(), input);
      if (!res.ok) {
        setError(res.reason === "full" ? W.tooMany : W.noPrivate);
        return;
      }
      askToKeep();
      then();
    } catch {
      setError(W.noPrivate);
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDup(null);
    // The Enter key can still send the form while the bill photo is going up; saving now would lose the photo.
    if (scanBusy) {
      setError("Wait a moment: the bill photo is still being added.");
      return;
    }
    if (itemSplit && !itemSplit.ok) {
      setError(itemSplit.error);
      setShowPeople(true);
      return;
    }
    // Offline, with another currency and no rate typed, the sums can't be shown; the split is still checked (against a rate of 1, for the
    // checks only: nothing from it is kept).
    const checked = offline && foreign && !(usingManualRate && manualRate.trim()) ? buildExpense(draft, { ...ctx, rate: "1" }) : preview;
    if (!checked.ok) {
      setError(checked.error);
      if (/person|amounts|percent|shares/i.test(checked.error)) {
        setShowPeople(true);
      }
      // A bad card fee opens the currency details, where the fee is.
      if (/card markup/i.test(checked.error)) setShowFx(true);
      if (errorNeedsMore(checked.error, multiPay)) setShowMore(true);
      return;
    }
    if (!expenseId) rememberSplit();
    if (offline) {
      startSaving(async () => {
        await keepOnPhone((offlineKey.current ??= newDraftKey()), offline.onSaved);
      });
      return;
    }
    startSaving(async () => {
      try {
        const res = await addExpense({ ...draft, billRun, again: againRef.current, allowDuplicate: allowDupRef.current, requestKey, groupId, name, notes: withItems(notes), receiptId: receiptId || undefined, items: byItem && itemSplit?.ok ? items.filter((x) => x.name.trim() || x.amount.trim()).map((x) => ({ name: x.name.trim() || "Item", amount: parseAmount(x.amount, currency) ?? 0, people: x.people })) : [], baseVersion: initial?.version, category: category.id, expenseId, date, rateMode: usingManualRate ? "manual" : keepSavedRate ? "keep" : "auto", manualRate });
        if (res?.duplicateOf) setDup(res.duplicateOf);
        else if (res?.error) setError(res.error);
      } catch (err) {
        // Going to the group afterwards is Next.js's own signal: let it through.
        if (String((err as { digest?: string })?.digest ?? "").startsWith("NEXT_")) throw err;
        // No signal, or the server hiccuped. Saving again is safe (this form's key means it's only ever added once).
        setError("We couldn’t confirm this saved. What you typed is still here: tap Save again when you’re back online. It won’t be added twice.");
      }
    });
  }

  // The result line under the form (display only; what is saved is unchanged).
  const money = (m: number) => `${foreign ? "≈ " : ""}${base(m)}`;
  const payersNow = preview.ok ? (preview.expense.payers.length > 1 ? preview.expense.payers : [{ memberId: preview.expense.paidById, amount: preview.expense.amount }]) : [];
  const resultParts = preview.ok
    ? resultSentence({
        payers: payersNow,
        total: preview.expense.amount,
        pairs,
        myId,
        myShare: preview.expense.shares.find((s) => s.memberId === myId)?.amount ?? 0,
        inShares: participants.includes(myId),
        justMe: participants.length === 1 && participants[0] === myId,
        refund: kind === "refund",
        name: who,
        money,
        showPaid: !foreign,
      })
    : [];
  // The amount is the hero: big for short amounts, stepping down so a lakh-sized amount still fits a 320px phone.
  // Commas count, so the size steps down with the length of what is shown and a huge amount still fits on one line.
  const heroSize = amountSizeClass(amount, "hero");
  return (
    // Saving is already safe to repeat (one request key per form, and the
    // buttons are off while saving), so the page-wide double-tap lock isn't needed here.
    <form ref={formRef} onSubmit={save} data-allow-repeat="1" className="space-y-7">
      {/* Money back (a refund, a deposit returned) is a choice under "Notes, money back…" below (founder, 15 Nov: no switch on top).
          While it is on, one line here says so, with a way straight back. */}
      {kind === "refund" && (
        <div className="flex items-start justify-between gap-3 rounded-[14px] border border-line px-4 py-3 text-sm" data-money-back-note>
          <p className="text-fg/75">
            <span className="font-semibold text-fg">Money back.</span> A refund, a returned item or a deposit coming back. Whoever got it owes the people it’s shared with.
          </p>
          <button type="button" onClick={() => setKind("expense")} className="-my-2 min-h-11 shrink-0 text-[13px] font-semibold text-fg underline underline-offset-4">
            Undo
          </button>
        </div>
      )}

      {/* 2 + 4. Amount and currency: the currency pill above, the amount big in the middle, the day under it */}
      <div className="flex flex-col items-center pt-1 text-center" data-amount-hero>
        <button
          type="button"
          onClick={() => setShowCurrencies((s) => !s)}
          aria-label={`Currency: ${cur.name}. Tap to change`}
          aria-expanded={showCurrencies}
          className="flex items-center gap-1.5 rounded-full bg-mist px-3 py-1.5 text-sm font-semibold active:scale-95"
        >
          {currency}
          <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="text-fg/50">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {/* The input is exactly as wide as its text: a hidden copy of the text sets the width of the grid cell.
            The box shows grouped digits as you type; AmountInput keeps the caret after the same digit. */}
        <div className={`mt-2 flex w-full justify-center leading-[1.05] ${heroSize}`}>
          <span className="inline-grid min-w-0 max-w-full">
            <span aria-hidden className="money invisible col-start-1 row-start-1 whitespace-pre px-0.5 text-center">
              {amount || "0"}
            </span>
            <AmountInput
              currency={currency}
              value={amount}
              onValueChange={setAmount}
              placeholder="0"
              autoComplete="off"
              aria-label="Amount"
              autoFocus={!initial?.name}
              className="money col-start-1 row-start-1 w-full min-w-0 bg-transparent px-0.5 text-center text-fg caret-fg outline-none placeholder:text-fg/25 focus-visible:shadow-[inset_0_-1px_0_0_rgb(244_242_236/0.22)]"
            />
          </span>
        </div>
        {/* How the typed amount was read ("12,50" → ₹12.50); nothing for plain digits. */}
        {echo && (
          <span role="status" aria-live="polite" className="mt-1 text-xs text-fg/60" data-amount-echo={echo}>
            Read as {echo}
          </span>
        )}
        {showCurrencies && (
          <div className="w-full text-left">
            <CurrencyPicker value={currency} recent={[baseCurrency, currency]} onPick={chooseCurrency} />
          </div>
        )}

        {/* When it was spent: optional, today unless changed. */}
        {!showDate ? (
          <button type="button" onClick={() => setShowDate(true)} className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-sm font-medium text-fg/80 active:scale-95">
            <CalIcon /> {date === today ? "Today" : date === yesterday ? "Yesterday" : niceDate(date)}
            <span className="sr-only">. Change</span>
          </button>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2" role="group" aria-label="When">
            <Chip on={!pickingDate && date === today} onClick={() => { setPickingDate(false); setDate(today); }}>
              Today
            </Chip>
            <Chip on={!pickingDate && date === yesterday} onClick={() => { setPickingDate(false); setDate(yesterday); }}>
              Yesterday
            </Chip>
            {pickingDate ? (
              <DateField
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value || today)}
                aria-label="Date of the expense"
                size="sm"
                inline
                required
              />
            ) : (
              <Chip on={false} onClick={() => setPickingDate(true)}>
                <CalIcon /> Pick date
              </Chip>
            )}
          </div>
        )}
      </div>

      {/* Foreign currency: ONE quiet line with what it comes to, and "Details" for the rate, card fee and the maths. */}
      {foreign && !fxOpen && (
        <section aria-label="Conversion" data-fx-card className="-mt-3 flex flex-wrap items-center justify-center gap-x-2 text-center">
          {rateState.status === "loading" ? (
            <p className="text-[13px] text-fg/55">Getting today’s rate…</p>
          ) : totals.ok ? (
            <p className="text-[13px] tabular-nums text-fg/55" data-fx-line>
              ≈ {base(totals.total)}
              {paymentMethod === "card"
                ? markupBp === null ? ", card fee needs fixing" : markupBp ? ` with your card’s ${formatPercent(markupBp)} fee` : ", no card fee"
                : `, ${PAYMENT_METHODS.find((p) => p.id === paymentMethod)?.label ?? "Cash"}, no card fee`}
            </p>
          ) : rateState.status === "ok" ? (
            <p className="text-[13px] text-fg/55">
              1 {currency} = {rateText(rateState.rate, baseCurrency)}
            </p>
          ) : (
            <p className="text-[13px] text-fg/55">Set the exchange rate</p>
          )}
          {/* The rate note shows here too when it is not simply today's live rate. */}
          {rateState.status === "ok" && !usingManualRate && (keepSavedRate || rateState.stale) && fxSource && (
            <p className="basis-full text-xs text-fg/55" data-fx-note>
              {fxSource}
              {rateState.stale && !keepSavedRate ? " — live rates unavailable right now" : ""}
            </p>
          )}
          {rateState.status !== "loading" && (
            <button type="button" onClick={() => setShowFx(true)} className="min-h-11 px-1 text-[13px] font-medium text-fg underline underline-offset-4">
              Details
            </button>
          )}
        </section>
      )}
      {foreign && fxOpen && (
        <section className="-mt-3 space-y-4 rounded-[20px] border border-line bg-white p-4">
          <div className="flex justify-end">
            <button type="button" onClick={() => setShowFx(false)} className="min-h-9 text-sm font-medium text-fg">
              Hide details
            </button>
          </div>
          {totals.ok && (
            <p className="text-[13px] leading-snug tabular-nums text-fg/75" data-fx-maths>
              {fxMaths ?? `${orig(totals.originalAmount)} ≈ ${base(totals.total)}`}
              {fxSource ? ` · ${fxSource}` : ""}. Balances stay in {baseCurrency}.
            </p>
          )}
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
                  {fxSource}
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
                    <span className="nobreak shrink-0 text-gray-400">{baseCurrency === "INR" ? "₹" : baseCurrency}</span>
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
                {rateState.status === "ok" && !ownRateOnly && (
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
                  <Chip on={markupChoice === "group"} onClick={() => markupDo({ type: "group" })}>
                    Default ({formatPercent(groupMarkupBp)})
                  </Chip>
                  <Chip on={markupChoice === "none"} onClick={() => markupDo({ type: "none" })}>
                    None
                  </Chip>
                  {["2", "3", "4"].map((p) => (
                    <Chip
                      key={p}
                      on={markupChoice === "custom" && markupCustom === p}
                      onClick={() => markupDo({ type: "chip", percent: p })}
                    >
                      {p}%
                    </Chip>
                  ))}
                  <span className="flex items-center rounded-full border border-gray-200 bg-white px-3">
                    <input
                      value={markupBoxValue(markup)}
                      onChange={(e) => markupDo({ type: "type", text: e.target.value })}
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

      {/* Faster entry: scan a bill, say it, or type it in one line. Each fills the form below; nothing saves until Save. */}
      {!offline && (!billRun || quickOk) && (
        <div data-faster-entry>
          {entryColumns > 0 && <span className={labelClass}>Faster entry</span>}
          {entryColumns > 0 && (
          <div role="group" aria-label="Faster entry" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${entryColumns}, minmax(0, 1fr))` }}>
            {!billRun && (
              <EntryButton disabled={scanBusy} onClick={() => openBill.current?.()} label={existingReceiptId ? "Bill photo" : "Scan a bill"}>
                <path d="M4 3h16v18l-3-2-2 2-3-2-3 2-2-2-3 2zM8 8h8M8 12h8M8 16h5" />
              </EntryButton>
            )}
            {quickOk && (
              <EntryButton onClick={() => openQuick.current?.(true)} label="Speak">
                <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />
              </EntryButton>
            )}
            {quickOk && (
              <EntryButton onClick={() => openQuick.current?.(false)} label="Type a line">
                <path d="M4 7h16M4 12h10M4 17h7" />
              </EntryButton>
            )}
          </div>
          )}
          {!billRun && (
            <div className="mt-1">
              <BillScan groupId={groupId} read={ai && !expenseId} onAttach={setReceiptId} onRead={fillFromBill} existingId={existingReceiptId} openRef={openBill} onBusy={setScanBusy} />
              {scannedItems > 1 && !byItem && members.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setByItem(true);
                    setShowPeople(true);
                  }}
                  className="mt-1 flex min-h-11 items-center gap-2 text-sm font-medium text-fg/80"
                  data-split-by-item
                >
                  {scannedItems} items on the bill · split by item ›
                </button>
              )}
            </div>
          )}
          {/* Quick line: "Dinner 2400 Ravi paid split with Asha Meera" fills the form below. */}
          {quickOk && (
            <div className="mt-2">
              <QuickLine
                groupId={groupId}
                ai={ai}
                members={members.map((m) => ({ id: m.id, name: m.name }))}
                myId={myId}
                who={who}
                currency={currency}
                openRef={openQuick}
                onFill={(q, extra) => {
                  if (saving) return; // a late Speak / AI answer must not change what is being saved
                  if (extra?.currency && extra.currency !== currency && isSupportedCurrency(extra.currency)) chooseCurrency(extra.currency);
                  if (q.name) setName(q.name);
                  if (q.amount) setAmount(regroupAmount(q.amount, extra?.currency && isSupportedCurrency(extra.currency) ? extra.currency : currency));
                  if (q.paidById) {
                    setMultiPay(false);
                    setPaidById(q.paidById);
                  }
                  if (q.forIds) {
                    setByItem(false);
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
            </div>
          )}
        </div>
      )}

      {/* 1. Expense name, with its category as a small tag (used for group reports) */}
      <div>
        <label htmlFor="expense-name" className={labelClass}>
          What was it?
        </label>
        <div className="flex gap-2">
          <input
            id="expense-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Beach dinner"
            autoComplete="off"
            maxLength={80}
            autoFocus={Boolean(initial?.name)}
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
              className="shrink-0 border border-line px-2.5 py-1 text-xs font-semibold text-fg active:bg-mist rounded-full"
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

      {/* Who paid: right under the name, one tap to change. Several payers and Spin for it are under More. */}
      {members.length > 1 && (
        <div>
          <span id="who-paid-label" className={labelClass}>{kind === "refund" ? "Who got the money?" : "Who paid?"}</span>
          {/* One scrolling row, with a fade at the right edge so a cut-off name reads as "more this way". With several payers the single choice is off. */}
          <div className={`relative -mx-5 ${multiPay ? "opacity-40" : ""}`} data-payer-row aria-disabled={multiPay || undefined}>
            <div ref={payerRow} role="group" aria-labelledby="who-paid-label" className={`flex gap-2 overflow-x-auto px-5 pb-1 pr-12 [scrollbar-width:none] ${multiPay ? "pointer-events-none" : ""}`}>
              {[...members].sort((a, b) => (a.id === myId ? -1 : b.id === myId ? 1 : 0)).map((m) => (
                <Chip
                  key={m.id}
                  on={!multiPay && m.id === paidById}
                  face={m.name}
                  onClick={() => {
                    setMultiPay(false);
                    setPaidById(m.id);
                  }}
                >
                  {who(m.id)}
                </Chip>
              ))}
            </div>
            <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent" />
          </div>
          {multiPay && (
            <button type="button" onClick={() => setShowMore(true)} className="mt-1 min-h-11 text-left text-sm text-gray-500" data-multi-pay-note>
              More than one person {kind === "refund" ? "got it" : "paid"}. Set the amounts under <span className="font-medium text-fg underline underline-offset-4">More</span>.
            </button>
          )}
        </div>
      )}

      {/* How to split: one row of choices (founder, 16 Nov). "Only some" is an equal split among the people you tap (one person too);
          Amounts, %, Shares and Items open the people list right under the row. The row wraps; it never scrolls sideways. */}
      <section>
        <span id="how-split-label" className={labelClass}>How to split?</span>
        <div role="group" aria-labelledby="how-split-label" className="flex flex-wrap gap-2" data-split-row>
          {groupShares && (
            <Chip
              on={!byItem && !showPeople && groupSplitOn}
              onClick={() => {
                pickSplit({ kind: "group-split" });
                setShowPeople(false);
                setShares(groupShares);
              }}
            >
              {splitName} <span className="opacity-60">{groupSplitLabel}</span>
            </Chip>
          )}
          <Chip on={choice === "everyone"} onClick={resetSplit}>
            {pair ? "Both equally" : "Everyone equally"}
          </Chip>
          {members.length > 1 && (
            <Chip on={choice === "only"} onClick={chooseOnly}>
              {pair ? "Just one" : "Only some"}
            </Chip>
          )}
          <Chip on={choice === "exact"} onClick={() => chooseHow("exact")}>
            Amounts
          </Chip>
          <Chip on={choice === "percent"} onClick={() => chooseHow("percent")}>
            %
          </Chip>
          <Chip on={choice === "shares" && !(groupSplitOn && !showPeople)} onClick={() => chooseHow("shares")}>
            Shares
          </Chip>
          {!offline && (
            <Chip on={choice === "items"} onClick={() => chooseHow("items")}>
              Items
            </Chip>
          )}
        </div>
        {usingLast && (
          <p className="mt-2 text-sm text-gray-500">
            <span className="text-gray-400">Same as last time</span>{" "}
            <button type="button" onClick={resetSplit} className="font-medium text-fg underline underline-offset-4">
              Reset
            </button>
          </p>
        )}
        {choice === "only" && (
          <div className="mt-3">
            <p className="mb-2 text-sm text-gray-500">Tap who it was for · split equally</p>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const on = forMode === "one" ? onePersonId === m.id : selected.includes(m.id);
                return (
                  <Chip key={m.id} on={on} onClick={() => toggleOnly(m.id)}>
                    {on && "✓ "}
                    {who(m.id)}
                  </Chip>
                );
              })}
            </div>
          </div>
        )}
        {peopleOpen && (
          <div className="mt-3 space-y-6 rounded-2xl border border-line px-4 pb-4 pt-4">
            {byItem ? (
              <p className="text-sm text-gray-500" data-item-note>Split by item: each line says who it’s for.</p>
            ) : (
              forMode !== "everyone" && (
                // An expense saved for only some people with amounts, percentages or shares keeps exactly those people.
                <p className="text-sm text-gray-500" data-only-note>
                  Only for <strong className="text-fg">{participants.map((id) => who(id)).join(", ")}</strong>.{" "}
                  <button type="button" onClick={() => setForMode("everyone")} className="font-medium text-fg underline underline-offset-4">
                    Include everyone
                  </button>
                </p>
              )
            )}

            {participants.length > 1 ? (
              <div>
                {byItem && (
                  <div className="mt-3 space-y-2.5" data-item-split>
                    {items.map((it, i) => {
                      const set = (patch: Partial<typeof it>) => setItems((list) => list.map((x) => (x.k === it.k ? { ...x, ...patch } : x)));
                      const all = memberIds.every((id) => it.people.includes(id));
                      return (
                        <div key={it.k} className="rounded-2xl border border-line px-3 pb-3 pt-1.5">
                          <div className="flex items-center gap-2">
                            <input
                              value={it.name}
                              onChange={(e) => set({ name: e.target.value })}
                              placeholder={i === 0 ? "e.g. Pizza" : "Item"}
                              aria-label={`Item ${i + 1}`}
                              maxLength={40}
                              className="min-w-0 flex-1 bg-transparent py-2 outline-none"
                            />
                            <span className="flex w-28 shrink-0 items-center rounded-xl border border-line px-2.5 focus-within:border-accent">
                              <span className="nobreak shrink-0 text-xs text-gray-400">{currency}</span>
                              <input
                                inputMode="decimal"
                                placeholder="0"
                                value={it.amount}
                                onChange={(e) => set({ amount: e.target.value })}
                                aria-label={`Item ${i + 1} price`}
                                className="w-full bg-transparent py-2 text-right tabular-nums outline-none"
                              />
                            </span>
                            {items.length > 1 && (
                              <button
                                type="button"
                                aria-label={`Remove item ${i + 1}`}
                                onClick={() => setItems((list) => list.filter((x) => x.k !== it.k))}
                                className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl leading-none text-gray-400 active:bg-mist"
                              >
                                ×
                              </button>
                            )}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={`Who had item ${i + 1}`}>
                            {members.length > 2 && (
                              <button
                                type="button"
                                aria-pressed={all}
                                onClick={() => set({ people: all ? [] : [...memberIds] })}
                                className={`min-h-9 rounded-full border px-3.5 text-[13px] font-medium ${all ? "border-fg bg-fg text-canvas" : "border-line text-fg/75"}`}
                              >
                                Everyone
                              </button>
                            )}
                            {members.map((m) => {
                              const on = it.people.includes(m.id);
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  aria-pressed={on}
                                  onClick={() => set({ people: on ? it.people.filter((x) => x !== m.id) : [...it.people, m.id] })}
                                  className={`min-h-9 rounded-full border px-3.5 text-[13px] font-medium ${on ? "border-fg bg-fg text-canvas" : "border-line text-fg/75"}`}
                                >
                                  {who(m.id)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {items.length < MAX_ITEM_LINES ? (
                      <button
                        type="button"
                        onClick={() => setItems((list) => (list.length >= MAX_ITEM_LINES ? list : [...list, { k: Math.max(0, ...list.map((x) => x.k)) + 1, name: "", amount: "", people: [] }]))}
                        className="flex min-h-11 items-center gap-2 text-sm font-medium text-fg"
                      >
                        <span className="text-lg leading-none">＋</span> Add item
                      </button>
                    ) : (
                      <p className="text-xs text-gray-500" data-item-limit>That&apos;s the most a bill can have ({MAX_ITEM_LINES} items). Put small things together as one line.</p>
                    )}
                    {itemSplit && (itemSplit.ok ? (
                      <div className="rounded-2xl bg-mist px-4 py-3 text-sm" data-item-result>
                        <p className="text-gray-500">
                          Items {orig(itemSplit.itemsTotal)}
                          {itemSplit.extra > 0 && ` · tax, service & tip ${orig(itemSplit.extra)}, shared by what each had`}
                        </p>
                        <ul className="mt-2 space-y-1">
                          {memberIds.filter((id) => itemSplit.amounts[id]).map((id) => (
                            <li key={id} className="flex justify-between">
                              <span>{who(id)}</span>
                              <span className="money tabular-nums font-semibold">{orig(itemSplit.amounts[id])}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      (items.some((x) => x.amount.trim()) || amount.trim()) && <p className="text-sm text-gray-500" data-item-hint>{itemSplit.error}</p>
                    ))}
                  </div>
                )}
                {!byItem && splitType === "shares" && (
                  <ul className="mt-3 divide-y divide-line">
                    {participants.map((id) => {
                      const amt = shareOf(id);
                      return (
                        <li key={id} className="flex items-center gap-2 py-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{who(id)}</span>
                            {amt !== null && <span className="block text-xs text-gray-400">{money(amt)}</span>}
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
                {!byItem && (splitType === "exact" || splitType === "percent") && (
                  <ul className="mt-3 divide-y divide-gray-100">
                    {participants.map((id) => (
                      <li key={id} className="flex items-center gap-3 py-2">
                        <span className="flex-1">{who(id)}</span>
                        <span className="flex w-36 items-center rounded-xl border border-gray-200 px-3 focus-within:border-accent">
                          {splitType === "exact" && <span className="nobreak shrink-0 text-xs text-gray-400">{currency}</span>}
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

      {/* More: the less common options, closed to keep the form short. */}
      <section aria-label="More" data-more>
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 text-left text-sm font-semibold active:bg-mist"
        >
          <span>
            {showMore ? "Hide notes and more" : "More"}
            {!showMore && (
              <span className="block text-xs font-normal text-fg/55">
                {`Notes, money back${members.length > 1 ? ", several payers" : ""}${members.length > 1 && kind === "expense" && spin ? ", spin for it" : ""}`}
              </span>
            )}
          </span>
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-fg/50 transition-transform ${showMore ? "rotate-180" : ""}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {showMore && (
          <div className="mt-4 space-y-6">
            {/* Money back: a refund, a returned item or a deposit coming back (it used to be a switch at the top). */}
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3" data-money-back-row>
              <span>
                <span className="block text-sm font-medium text-fg/85">Money back</span>
                <span className="block text-xs text-fg/55">A refund or a deposit coming back</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={kind === "refund"}
                aria-label="Money back"
                onClick={() => setKind(kind === "refund" ? "expense" : "refund")}
                className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${kind === "refund" ? "border-fg bg-fg" : "border-line bg-mist"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${kind === "refund" ? "left-6 bg-canvas" : "left-0.5 bg-fg/60"}`} />
              </button>
            </label>
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

            {members.length > 1 && (
              <div>
                {/* A real label: the whole row (44px tall) is the tap target, words included. */}
                <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3" data-multi-pay-row>
                  <span className="text-sm font-medium text-fg/85">{multiLabel}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={multiPay}
                    aria-label={multiLabel}
                    onClick={() => {
                      if (multiPay) {
                        setMultiPay(false);
                        return;
                      }
                      setMultiPay(true);
                      // Start from the current payer paying everything, so it already adds up.
                      if (!Object.values(payers).some((v) => v.trim())) setPayers({ [paidById]: amount });
                    }}
                    className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${multiPay ? "border-fg bg-fg" : "border-line bg-mist"}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${multiPay ? "left-6 bg-canvas" : "left-0.5 bg-fg/60"}`} />
                  </button>
                </label>
                {multiPay && (
                  <div className="mt-2 rounded-2xl border border-line px-4 py-1">
                    <ul className="divide-y divide-line">
                      {members.map((m) => (
                        <li key={m.id} className="flex items-center gap-3 py-2">
                          <span className="flex-1">{who(m.id)}</span>
                          <span className="flex w-36 items-center rounded-xl border border-line px-3 focus-within:border-accent">
                            <span className="nobreak shrink-0 text-xs text-gray-400">{currency}</span>
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

            {members.length > 1 && kind === "expense" && spin && (
              <div className="flex min-h-11 items-center justify-between gap-3">
                <span className="text-sm font-medium text-fg/85">Can’t decide who pays?</span>
                <SpinWheel
                  roomy
                  people={members.map((m) => ({ id: m.id, label: who(m.id) }))}
                  onPick={(id) => {
                    setMultiPay(false);
                    setPaidById(id);
                  }}
                />
              </div>
            )}
          </div>
        )}
      </section>

      {/* ONE quiet line: what happened and what it means for you, in money colour. */}
      <div role="status" aria-live="polite" className="text-center text-sm leading-snug" data-expense-result>
        {preview.ok && pair ? (
          // With one person: one plain sentence from the same shares that will be saved ("Rohan owes you ₹600 for this expense.").
          <p className="text-fg/85" data-pair-line>
            {pairLine({ ...preview.expense, payers: payersJson(preview.expense.payers) }, myId, pair.otherId, pair.otherName, baseCurrency)}
          </p>
        ) : preview.ok ? (
          <p className="text-fg/75">
            {resultParts.map((p, i) => (
              <span key={i}>
                {i > 0 && " "}
                <span className={p.tone === "owe" ? "text-owe" : p.tone === "owed" ? "text-owed" : ""}>{p.text}</span>
                {p.amount && <span className={`font-display text-[17px] font-semibold tabular-nums ${p.tone === "owe" ? "text-owe" : "text-owed"}`}> {p.amount}</span>}
              </span>
            ))}
          </p>
        ) : (
          <p className="text-fg/55">The result shows once it adds up</p>
        )}
      </div>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {dup && (
        <div role="status" className="rounded-[20px] border border-line bg-white px-4 py-3 text-sm">
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

      {offline && <p className="-mt-2 text-center text-[13px] leading-snug text-fg/60" data-offline-people-note>{W.peopleNote(offline.groupName)}</p>}

      {/* Always in reach: the save buttons ride along at the bottom while you scroll the form. */}
      <div className="sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-10 -mx-2 mt-6">
      <div className="rounded-[28px] bg-[#0d0d0f] px-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_18px_40px_-14px_rgba(0,0,0,0.85)]">
      <div>
        <button
          type="submit"
          data-haptic="tap"
          onClick={() => {
            againRef.current = false;
            setAgain(false);
          }}
          disabled={saving || scanBusy || rateState.status === "loading"}
          className={primaryButtonClass}
        >
          {saving && !again ? "Saving…" : offline ? W.saveOnPhone : expenseId ? "Save changes" : kind === "refund" ? "Save money back" : "Save expense"}
        </button>
      </div>
      {offline && <p className="px-3 pb-1 pt-2 text-center text-[13px] text-fg/60" data-offline-save-note>{W.saveNote}</p>}
      {!expenseId && !offline && (
        <button
          type="submit"
          onClick={() => {
            againRef.current = true;
            setAgain(true);
          }}
          disabled={saving || scanBusy || rateState.status === "loading"}
          className="mx-auto mt-0.5 block whitespace-nowrap px-3 py-2 text-center text-sm font-medium text-fg/75 underline underline-offset-4 active:text-fg disabled:opacity-50"
        >
          {saving && again ? "Saving…" : "Save & add another"}
        </button>
      )}
      </div>
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
    <div className="grid gap-1 rounded-full bg-mist p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(max-content, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={o.id === value}
          className={`nobreak rounded-full py-2 font-semibold ${options.length > 4 ? "px-0.5 text-[13px]" : "text-sm"} ${o.id === value ? "bg-fg text-canvas" : "text-fg/55"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Chip({ on, onClick, children, face }: { on: boolean; onClick: () => void; children: React.ReactNode; face?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border text-sm transition-transform active:scale-95 ${face ? "py-1.5 pl-1.5 pr-4" : "px-4 py-2"} ${
        on ? "border-fg bg-fg font-semibold text-canvas" : "border-line bg-mist font-medium text-fg/85"
      }`}
    >
      {face && (
        <span aria-hidden className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${avatarTone(face)}`}>
          {face.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 max-w-[11rem] truncate">{children}</span>
    </button>
  );
}

// One of the three equal buttons in the Faster entry row.
// The icon sits above the label (two lines at most), so "Scan a bill" and "Type a line" fit a 320px phone.
function EntryButton({ onClick, label, children, disabled }: { onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-line bg-mist px-1.5 py-2 text-center text-xs font-semibold leading-tight text-fg/90 transition-transform active:scale-95 disabled:opacity-60"
    >
      <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        {children}
      </svg>
      <span className="line-clamp-2 max-w-full break-words">{label}</span>
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
