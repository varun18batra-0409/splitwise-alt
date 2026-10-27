"use client";

import { useMemo, useState } from "react";
import { importFromSplitwise } from "@/app/actions";
import { GROUP_TYPES, type GroupType } from "@/lib/group-types";
import { MAX_IMPORT_BYTES, balancesOf, planRow, previewText } from "@/lib/splitwise-csv";
import { detectFormat, parseImport, type ColumnMap, type Detected } from "@/lib/import-formats";
import { POPULAR_CURRENCIES } from "@/lib/money";
import { inputClass, primaryButtonClass } from "./ui";

// "Bring a group over from another app": pick the app's exported spreadsheet
// (CSV), check what was found, say which person is you, and import.
// Splitwise exports and Loopin downloads are read as they are; any other file
// gets a short "which column is which?" step, with guesses filled in. The file
// is read on the phone first (so the preview is instant), then again on the server.
export function SplitwiseImport({ yourName }: { yourName: string }) {
  const [text, setText] = useState("");
  const [detected, setDetected] = useState<Detected | null>(null);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [currency, setCurrency] = useState("INR");
  const [name, setName] = useState("");
  const [type, setType] = useState<GroupType>("other");
  const [me, setMe] = useState(-1);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setDetected({ ok: false, error: "That file is too big. Export one group at a time." });
      return;
    }
    const t = await file.text();
    const d = detectFormat(t);
    setText(t);
    setDetected(d);
    setMap(d.ok && d.format === "generic" ? d.guess : null);
    if (d.ok && d.format === "generic") setCurrency(d.currency);
    // "goa-trip_2026-10-20_export.csv" → "Goa trip"
    const base = file.name.replace(/\.csv$/i, "").replace(/_\d{4}-\d{2}-\d{2}.*$/, "").replace(/[-_]?expenses?$/i, "").replace(/[_-]+/g, " ").trim();
    setName(base ? base[0].toUpperCase() + base.slice(1, 60) : "");
    setMe(-1);
  }

  const parsed = useMemo(() => (detected?.ok ? parseImport(text, { map: map ?? undefined, currency }) : null), [detected, text, map, currency]);
  const ok = parsed?.ok ? parsed : null;
  const preview = ok ? previewText(ok) : null;
  const matches = ok?.expected ? ok.expected.every((x, i) => x === balancesOf(ok.rows.map(planRow), ok.people.length)[i]) : null;
  // You: picked from your name, until you pick someone else.
  const guessedMe = ok
    ? (() => {
        const exact = ok.people.findIndex((x) => x.trim().toLowerCase() === yourName.trim().toLowerCase());
        if (exact >= 0) return exact;
        const first = yourName.trim().toLowerCase().split(" ")[0];
        return first ? ok.people.findIndex((x) => x.trim().toLowerCase().split(" ")[0] === first) : -1;
      })()
    : -1;
  const meNow = ok && me >= 0 && me < ok.people.length ? me : guessedMe;
  const generic = detected?.ok && detected.format === "generic" ? detected : null;

  return (
    <form action={importFromSplitwise} onSubmit={() => setBusy(true)} className="space-y-6">
      <label className="block rounded-[18px] border border-dashed border-line bg-white px-5 py-6 text-center">
        <span className="block text-[17px] font-semibold">{detected ? "Pick a different file" : "Pick the exported file"}</span>
        <span className="mt-1 block text-sm text-gray-500">A .csv spreadsheet from the other app</span>
        <input
          type="file"
          accept=".csv,text/csv,text/comma-separated-values,application/vnd.ms-excel"
          aria-label="Spreadsheet to import"
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </label>

      {detected && !detected.ok && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {detected.error}
        </p>
      )}
      {detected?.ok && <p className="text-sm text-gray-500">Read as: {detected.label}</p>}

      {generic && map && (
        <section className="space-y-3 rounded-[18px] border border-line px-5 py-4" aria-label="Which column is which?">
          <p className="font-semibold">Which column is which?</p>
          <p className="text-xs text-gray-500">Loopin has guessed from the column names. Change anything that’s wrong; the summary below updates as you go.</p>
          <ColumnSelect label="What it was" value={map.description} headers={generic.headers} onChange={(v) => setMap({ ...map, description: v })} />
          <ColumnSelect label="Amount" value={map.amount} headers={generic.headers} onChange={(v) => setMap({ ...map, amount: v })} />
          <ColumnSelect label="Paid by" value={map.paidBy} headers={generic.headers} onChange={(v) => setMap({ ...map, paidBy: v })} />
          <ColumnSelect label="Date" value={map.date} headers={generic.headers} none="No date column (use today)" onChange={(v) => setMap({ ...map, date: v })} />
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-600">How each one was shared</span>
            <select
              aria-label="How each one was shared"
              value={map.split}
              onChange={(e) => setMap({ ...map, split: e.target.value as ColumnMap["split"] })}
              className={inputClass}
            >
              <option value="everyone">Equally between everyone</option>
              <option value="column">Equally between the people named in a column</option>
              <option value="shares">Each person has their own column with their share</option>
            </select>
          </label>
          {map.split === "column" && (
            <ColumnSelect label="Who it was for" value={map.forCol ?? -1} headers={generic.headers} onChange={(v) => setMap({ ...map, forCol: v })} />
          )}
          {map.split === "shares" && (
            <fieldset className="text-sm">
              <legend className="mb-1 font-medium text-gray-600">Each person’s share column</legend>
              <div className="flex flex-wrap gap-2">
                {generic.headers.map((h, i) => {
                  const on = (map.shareCols ?? []).includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => setMap({ ...map, shareCols: on ? (map.shareCols ?? []).filter((x) => x !== i) : [...(map.shareCols ?? []), i] })}
                      className={`rounded-full border px-3 py-1.5 ${on ? "border-fg bg-fg text-canvas" : "border-line"}`}
                    >
                      {h || `Column ${i + 1}`}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-600">Currency of the amounts</span>
            <select aria-label="Currency of the amounts" value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
              {POPULAR_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      {parsed && !parsed.ok && detected?.ok && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {parsed.error}
        </p>
      )}

      {ok && preview && (
        <>
          <input type="hidden" name="csv" value={text} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="me" value={meNow} />
          {generic && map && <input type="hidden" name="map" value={JSON.stringify(map)} />}
          {generic && <input type="hidden" name="currency" value={currency} />}

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
            {matches === true && <p className="mt-2 text-emerald-700">✓ Matches the file’s own balances</p>}
            {matches === false && <p className="mt-2 text-amber-700">Balances differ slightly from the file’s own total (rounding). Check after importing.</p>}
            {ok.otherCurrencies.length > 0 && (
              <p className="mt-2 text-amber-700">
                Lines in {ok.otherCurrencies.join(", ")} are left out: Loopin brings over one currency per group. You can add them after, in their own currency.
              </p>
            )}
            {ok.skipped.filter((s) => !s.reason.startsWith("in ")).length > 0 && (
              <details className="mt-2 text-gray-500">
                <summary className="cursor-pointer">{ok.skipped.filter((s) => !s.reason.startsWith("in ")).length} line(s) skipped</summary>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {ok.skipped
                    .filter((s) => !s.reason.startsWith("in "))
                    .slice(0, 10)
                    .map((s) => (
                      <li key={s.line}>
                        Line {s.line}: {s.reason}
                      </li>
                    ))}
                </ul>
              </details>
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
                  aria-checked={meNow === i}
                  onClick={() => setMe(i)}
                  className={`rounded-full border px-4 py-2 text-sm ${meNow === i ? "border-fg bg-fg font-semibold text-canvas" : "border-line bg-white"}`}
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
            <div className="grid grid-cols-4 gap-1 rounded-full bg-mist p-1" role="radiogroup" aria-label="What’s it for?">
              {GROUP_TYPES.filter((t) => t.id !== "pot").map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={type === t.id}
                  onClick={() => setType(t.id)}
                  className={`rounded-full py-2.5 text-sm ${type === t.id ? "bg-fg font-semibold text-canvas" : "text-gray-500"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>

          <button type="submit" disabled={meNow < 0 || !name.trim() || busy} className={primaryButtonClass}>
            {busy ? "Bringing it over…" : "Bring it over"}
          </button>
        </>
      )}
    </form>
  );
}

function ColumnSelect({ label, value, headers, onChange, none }: { label: string; value: number; headers: string[]; onChange: (v: number) => void; none?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-600">{label}</span>
      <select aria-label={`${label} column`} value={value} onChange={(e) => onChange(Number(e.target.value))} className={inputClass}>
        {none && <option value={-1}>{none}</option>}
        {!none && value < 0 && <option value={-1}>Pick a column</option>}
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}
