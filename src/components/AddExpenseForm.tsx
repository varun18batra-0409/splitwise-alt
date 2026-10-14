"use client";

import { useMemo, useState, useTransition } from "react";
import { addExpense } from "@/app/actions";
import { CATEGORIES, getCategory, guessCategory } from "@/lib/categories";
import { computeSplit, type SplitType } from "@/lib/split";
import { formatMoney } from "@/lib/money";
import { inputClass, primaryButtonClass } from "./ui";

type Member = { id: string; name: string };

const SPLIT_LABELS: Record<SplitType, string> = { equal: "Equally", exact: "Exact amounts", percent: "Percentages" };

// Fast path (3 taps): + Add expense → type amount & what it was for → Save.
// "Paid by you, split equally among everyone" unless you change it.
export function AddExpenseForm({
  groupId,
  currency,
  members,
  myId,
}: {
  groupId: string;
  currency: string;
  members: Member[];
  myId: string;
}) {
  const memberIds = members.map((m) => m.id);
  const nameOf = (id: string) => (id === myId ? "you" : members.find((m) => m.id === id)?.name ?? "?");

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [pickedCategory, setPickedCategory] = useState<string | null>(null); // null = smart guess
  const [showCategories, setShowCategories] = useState(false);
  const [paidById, setPaidById] = useState(myId);
  const [splitType, setSplitType] = useState<SplitType>("equal");
  const [participants, setParticipants] = useState<string[]>(memberIds);
  const [exact, setExact] = useState<Record<string, string>>({});
  const [percent, setPercent] = useState<Record<string, string>>({});
  const [showOptions, setShowOptions] = useState(false);
  const [error, setError] = useState("");
  const [saving, startSaving] = useTransition();

  const category = getCategory(pickedCategory ?? guessCategory(description));

  const preview = useMemo(
    () => computeSplit({ amount, splitType, participants, memberIds, exact, percent, currency }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [amount, splitType, participants, exact, percent, currency],
  );
  const shareOf = (id: string) => (preview.ok ? preview.shares.find((s) => s.memberId === id)?.amount ?? 0 : null);

  // Running total for exact / percent so you can see what's left.
  const remaining = useMemo(() => {
    if (splitType === "equal" || preview.total === null) return null;
    if (splitType === "exact") {
      const typed = memberIds.reduce((s, id) => {
        const v = Number((exact[id] ?? "").replace(/,/g, ""));
        return s + (Number.isFinite(v) ? Math.round(v * 100) : 0);
      }, 0);
      return { label: formatMoney(Math.abs(preview.total - typed), currency), over: typed > preview.total, done: typed === preview.total };
    }
    const typed = memberIds.reduce((s, id) => {
      const v = Number(percent[id] ?? "");
      return s + (Number.isFinite(v) ? Math.round(v * 100) : 0);
    }, 0);
    const left = 10000 - typed;
    return { label: `${(Math.abs(left) / 100).toFixed(left % 100 === 0 ? 0 : 2)}%`, over: left < 0, done: left === 0 };
  }, [splitType, preview.total, exact, percent, memberIds, currency]);

  const splitSummary =
    splitType === "equal"
      ? participants.length === members.length
        ? `equally among all ${members.length}`
        : `equally among ${participants.length}`
      : `by ${SPLIT_LABELS[splitType].toLowerCase()}`;

  function toggleParticipant(id: string) {
    setParticipants((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!preview.ok) {
      setError(preview.error);
      if (splitType !== "equal" || participants.length === 0) setShowOptions(true);
      return;
    }
    startSaving(async () => {
      const res = await addExpense({
        groupId,
        amount,
        description,
        category: category.id,
        paidById,
        splitType,
        participants,
        exact,
        percent,
      });
      if (res?.error) setError(res.error);
    });
  }

  return (
    <form onSubmit={save} className="space-y-6">
      {/* Amount */}
      <label className="block">
        <span className="sr-only">Amount</span>
        <div className="flex items-baseline gap-2 border-b-2 border-gray-100 pb-2 focus-within:border-accent">
          <span className="text-3xl font-light text-gray-400">₹</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            autoFocus
            autoComplete="off"
            className="w-full bg-transparent text-5xl font-semibold tracking-tight outline-none placeholder:text-gray-200"
          />
        </div>
      </label>

      {/* What it was for + smart category */}
      <div className="flex gap-2">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What was it for? e.g. Dinner"
          autoComplete="off"
          maxLength={80}
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => setShowCategories((s) => !s)}
          aria-label={`Category: ${category.label}. Tap to change`}
          className="flex shrink-0 items-center gap-1 rounded-xl border border-gray-200 px-3 text-sm active:bg-gray-50"
        >
          <span className="text-lg">{category.emoji}</span>
          <span className="text-gray-600">{category.label}</span>
        </button>
      </div>

      {showCategories && (
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setPickedCategory(c.id);
                setShowCategories(false);
              }}
              className={`rounded-full border px-3 py-2 text-sm ${
                c.id === category.id ? "border-accent bg-accent-soft text-accent-dark" : "border-gray-200 text-gray-700"
              }`}
            >
              {c.emoji} {c.label}
            </button>
          ))}
          {pickedCategory && (
            <button
              type="button"
              onClick={() => {
                setPickedCategory(null);
                setShowCategories(false);
              }}
              className="rounded-full px-3 py-2 text-sm text-gray-400"
            >
              Auto
            </button>
          )}
        </div>
      )}

      {/* "Paid by you · split equally among all 3" — tap to change */}
      <button
        type="button"
        onClick={() => setShowOptions((s) => !s)}
        className="w-full rounded-xl bg-gray-50 px-4 py-3 text-left text-sm text-gray-600 active:bg-gray-100"
      >
        Paid by <strong className="text-gray-900">{nameOf(paidById)}</strong> · split{" "}
        <strong className="text-gray-900">{splitSummary}</strong>
        <span className="float-right text-gray-400">{showOptions ? "Done" : "Change"}</span>
      </button>

      {showOptions && (
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-sm font-medium text-gray-600">Who paid?</p>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaidById(m.id)}
                  className={`rounded-full border px-4 py-2 text-sm ${
                    m.id === paidById ? "border-accent bg-accent-soft font-medium text-accent-dark" : "border-gray-200 text-gray-700"
                  }`}
                >
                  {m.id === myId ? "You" : m.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-gray-600">How to split?</p>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1">
              {(Object.keys(SPLIT_LABELS) as SplitType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSplitType(t)}
                  className={`rounded-lg py-2 text-sm ${t === splitType ? "bg-white font-medium shadow-sm" : "text-gray-500"}`}
                >
                  {t === "equal" ? "Equal" : t === "exact" ? "₹ Exact" : "%"}
                </button>
              ))}
            </div>
          </div>

          <ul className="divide-y divide-gray-100">
            {members.map((m) => {
              const share = shareOf(m.id);
              return (
                <li key={m.id} className="flex items-center gap-3 py-3">
                  {splitType === "equal" ? (
                    <label className="flex flex-1 items-center gap-3">
                      <input
                        type="checkbox"
                        checked={participants.includes(m.id)}
                        onChange={() => toggleParticipant(m.id)}
                        className="h-5 w-5 accent-[var(--color-accent)]"
                      />
                      <span className="flex-1">{m.id === myId ? `${m.name} (you)` : m.name}</span>
                      <span className="text-sm text-gray-500">
                        {participants.includes(m.id) && share !== null ? formatMoney(share, currency) : "—"}
                      </span>
                    </label>
                  ) : (
                    <>
                      <span className="flex-1">{m.id === myId ? `${m.name} (you)` : m.name}</span>
                      <div className="flex w-32 items-center rounded-xl border border-gray-200 px-3 focus-within:border-accent">
                        {splitType === "exact" && <span className="text-gray-400">₹</span>}
                        <input
                          inputMode="decimal"
                          placeholder="0"
                          value={(splitType === "exact" ? exact : percent)[m.id] ?? ""}
                          onChange={(e) =>
                            (splitType === "exact" ? setExact : setPercent)((prev) => ({ ...prev, [m.id]: e.target.value }))
                          }
                          className="w-full bg-transparent py-2 text-right outline-none"
                        />
                        {splitType === "percent" && <span className="text-gray-400">%</span>}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {remaining && (
            <p className={`text-sm ${remaining.done ? "text-accent-dark" : remaining.over ? "text-red-600" : "text-gray-500"}`}>
              {remaining.done ? "✓ Adds up" : remaining.over ? `${remaining.label} too much` : `${remaining.label} left to assign`}
            </p>
          )}
        </div>
      )}

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <button type="submit" disabled={saving} className={primaryButtonClass}>
        {saving ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
