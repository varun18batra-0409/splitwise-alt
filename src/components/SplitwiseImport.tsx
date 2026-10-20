"use client";

import { useState } from "react";
import { importFromSplitwise } from "@/app/actions";
import { GROUP_TYPES, type GroupType } from "@/lib/group-types";
import { MAX_IMPORT_BYTES, balancesOf, parseSplitwiseCsv, planRow, previewText, type SwParsed } from "@/lib/splitwise-csv";
import { inputClass, primaryButtonClass } from "./ui";

// "Bring a group over from Splitwise": pick the exported file, check what was
// found, say which person is you, and import. The file is read on the phone
// first (so the preview is instant), then checked again on the server.
export function SplitwiseImport({ yourName }: { yourName: string }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<SwParsed | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<GroupType>("other");
  const [me, setMe] = useState(-1);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setParsed({ ok: false, error: "That file is too big. Export one group at a time." });
      return;
    }
    const t = await file.text();
    const p = parseSplitwiseCsv(t);
    setText(t);
    setParsed(p);
    // "goa-trip_2026-10-20_export.csv" → "Goa trip"
    const base = file.name.replace(/\.csv$/i, "").replace(/_\d{4}-\d{2}-\d{2}.*$/, "").replace(/[_-]+/g, " ").trim();
    setName(base ? base[0].toUpperCase() + base.slice(1, 60) : "");
    if (p.ok) {
      const mine = p.people.findIndex((x) => x.trim().toLowerCase() === yourName.trim().toLowerCase());
      const first = p.people.findIndex((x) => x.trim().toLowerCase().split(" ")[0] === yourName.trim().toLowerCase().split(" ")[0]);
      setMe(mine >= 0 ? mine : yourName ? first : -1);
    }
  }

  const ok = parsed?.ok ? parsed : null;
  const preview = ok ? previewText(ok) : null;
  const matches = ok?.expected ? ok.expected.every((x, i) => x === balancesOf(ok.rows.map(planRow), ok.people.length)[i]) : null;

  return (
    <form action={importFromSplitwise} onSubmit={() => setBusy(true)} className="space-y-6">
      <label className="block rounded-[18px] border border-dashed border-line bg-white px-5 py-6 text-center">
        <span className="block text-[17px] font-semibold">{parsed ? "Pick a different file" : "Pick the Splitwise file"}</span>
        <span className="mt-1 block text-sm text-gray-500">The .csv file you exported from Splitwise</span>
        <input
          type="file"
          accept=".csv,text/csv,text/comma-separated-values,application/vnd.ms-excel"
          aria-label="Splitwise export file"
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </label>

      {parsed && !parsed.ok && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {parsed.error}
        </p>
      )}

      {ok && preview && (
        <>
          <input type="hidden" name="csv" value={text} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="me" value={me} />

          <section className="rounded-[18px] bg-mist px-5 py-4 text-sm" aria-label="What was found">
            <p className="font-semibold">
              Found {preview.expenses} {preview.expenses === 1 ? "expense" : "expenses"} and {preview.payments}{" "}
              {preview.payments === 1 ? "payment" : "payments"} in {ok.currency}
            </p>
            <ul className="mt-2 space-y-1 text-gray-600">
              {preview.balances.map((b) => (
                <li key={b.name}>
                  {b.name}: {b.text}
                </li>
              ))}
            </ul>
            {matches === true && <p className="mt-2 text-emerald-700">✓ Matches Splitwise’s balances</p>}
            {matches === false && <p className="mt-2 text-amber-700">Balances differ slightly from Splitwise’s total (rounding). Check after importing.</p>}
            {ok.otherCurrencies.length > 0 && (
              <p className="mt-2 text-amber-700">
                Lines in {ok.otherCurrencies.join(", ")} are left out: Loopin brings over one currency per group. You can add them after, in their own currency.
              </p>
            )}
            {ok.skipped.filter((s) => !s.reason.startsWith("in ")).length > 0 && (
              <p className="mt-2 text-gray-500">
                {ok.skipped.filter((s) => !s.reason.startsWith("in ")).length} line(s) skipped (no effect on anyone, or unreadable).
              </p>
            )}
          </section>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-600">Which one is you?</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Which one is you?">
              {ok.people.map((p, i) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={me === i}
                  onClick={() => setMe(i)}
                  className={`rounded-full border px-4 py-2 text-sm ${me === i ? "border-fg bg-fg font-semibold text-canvas" : "border-line bg-white"}`}
                >
                  {p}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500">Everyone else is added by name. Invite them by email from People, and they take over their name.</p>
          </fieldset>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-600">Group name</span>
            <input name="groupName" required value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" className={inputClass} />
          </label>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-600">What’s it for?</legend>
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-mist p-1" role="radiogroup" aria-label="What’s it for?">
              {GROUP_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={type === t.id}
                  onClick={() => setType(t.id)}
                  className={`rounded-lg py-2.5 text-sm ${type === t.id ? "bg-fg font-semibold text-canvas" : "text-gray-500"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>

          <button type="submit" disabled={me < 0 || !name.trim() || busy} className={primaryButtonClass}>
            {busy ? "Bringing it over…" : "Bring it over"}
          </button>
        </>
      )}
    </form>
  );
}
