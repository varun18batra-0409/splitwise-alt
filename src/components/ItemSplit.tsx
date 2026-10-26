"use client";

import { useState } from "react";
import { extraAmount, itemize, itemsNote, parseBillText } from "@/lib/itemize";
import { formatMoney, parseAmount, toInputAmount } from "@/lib/money";

// Split by item: type each line of the bill and tap who had it. Tax, service
// charge and tip (an amount, or a % like "5%") are shared in proportion to what
// each person ordered. "Use this split" fills in the amount and each person's part.

type Row = { name: string; price: string; who: string[] };
const blank = (): Row => ({ name: "", price: "", who: [] });

export function ItemSplit({
  people,
  currency,
  onApply,
  onClose,
}: {
  people: { id: string; label: string }[];
  currency: string;
  onApply: (r: { total: number; perPerson: Record<string, number>; note: string }) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([blank(), blank()]);
  const [tax, setTax] = useState("");
  const [service, setService] = useState("");
  const [tip, setTip] = useState("");
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pasteNote, setPasteNote] = useState("");
  const money = (n: number) => formatMoney(n, currency);
  const label = (id: string) => people.find((p) => p.id === id)?.label ?? "?";

  const items = rows.map((r) => ({ name: r.name.trim(), price: parseAmount(r.price, currency) ?? 0, who: r.who }));
  const subtotal = items.reduce((s, i) => s + (i.price > 0 ? i.price : 0), 0);
  const ex = [tax, service, tip].map((x) => extraAmount(x, subtotal, currency));
  const badExtra = ex.some((x) => x === null);
  const missingWho = items.some((i) => i.price > 0 && i.who.length === 0);
  const result = !badExtra && !missingWho ? itemize(items, ex.map((x) => x ?? 0)) : null;

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toggle = (i: number, id: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, who: r.who.includes(id) ? r.who.filter((x) => x !== id) : [...r.who, id] } : r)));

  // "Paste the bill": text copied from a photo (Google Lens / iPhone Live Text).
  function takePasted() {
    const b = parseBillText(pasted, currency);
    if (!b.items.length) {
      setPasteNote("Couldn’t find items with prices. Each line needs a name and a price, like “Butter Chicken 320”.");
      return;
    }
    const kept = rows.filter((r) => r.price.trim());
    setRows([...kept, ...b.items.map((i) => ({ name: i.name, price: toInputAmount(i.price, currency), who: [] }))]);
    if (b.tax) setTax(toInputAmount(b.tax, currency));
    if (b.service) setService(toInputAmount(b.service, currency));
    if (b.tip) setTip(toInputAmount(b.tip, currency));
    const extra = [b.tax && `tax ${money(b.tax)}`, b.service && `service ${money(b.service)}`, b.tip && `tip ${money(b.tip)}`].filter(Boolean).join(", ");
    setPasteNote(`Found ${b.items.length} ${b.items.length === 1 ? "item" : "items"}${extra ? ` and ${extra}` : ""}. Check them, then tap who had what.`);
    setPasting(false);
    setPasted("");
  }

  function apply() {
    if (!result) return;
    const extrasText = [
      tax.trim() && `Tax ${tax.trim()}`,
      service.trim() && `Service charge ${service.trim()}`,
      tip.trim() && `Tip ${tip.trim()}`,
    ].filter(Boolean) as string[];
    const note = itemsNote(
      items.filter((i) => i.price > 0).map((i) => ({ name: i.name, priceText: money(i.price), whoText: i.who.length === people.length ? "everyone" : i.who.map(label).join(", ") })),
      extrasText.length ? [`${extrasText.join(" · ")}: shared by what each had`] : [],
    );
    onApply({ total: result.total, perPerson: result.perPerson, note });
  }

  return (
    <div className="mt-3 space-y-4 rounded-2xl border border-line px-4 pb-4 pt-4" aria-label="Split by item" role="group">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">Split by item</p>
        <button type="button" onClick={onClose} className="text-sm text-gray-500">
          Close
        </button>
      </div>
      <p className="-mt-2 text-xs text-gray-500">Each line of the bill, and tap who had it. Shared dishes: tap everyone who shared.</p>
      {/* Free "scan": the phone's own text reader does the reading. */}
      {pasting ? (
        <div className="space-y-2 rounded-xl border border-line p-3">
          <p className="text-xs text-gray-500">
            Point your camera at the bill and copy its text (Google Lens on Android, or press on the text in Photos on iPhone), then paste it here.
          </p>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={5}
            maxLength={6000}
            aria-label="Bill text"
            placeholder={"Butter Chicken 320\nGarlic Naan 2 x 60 120\nCGST 2.5% 11\nService charge 22"}
            className="w-full resize-none rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <button type="button" onClick={takePasted} className="rounded-lg bg-fg px-3.5 py-2 text-sm font-semibold text-canvas">
              Turn into items
            </button>
            <button type="button" onClick={() => setPasting(false)} className="px-2 text-sm text-gray-500">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setPasting(true); setPasteNote(""); }} className="text-sm font-semibold text-fg">
          📋 Paste the bill (from Google Lens / Live Text)
        </button>
      )}
      {pasteNote && (
        <p className="text-xs text-gray-500" role="status" data-paste-note>
          {pasteNote}
        </p>
      )}
      <ul className="space-y-3">
        {rows.map((r, i) => (
          <li key={i} className="rounded-xl bg-mist p-3" data-item-row={i}>
            <div className="flex gap-2">
              <input
                value={r.name}
                onChange={(e) => set(i, { name: e.target.value })}
                placeholder={i === 0 ? "e.g. Butter chicken" : "Item"}
                aria-label={`Item ${i + 1} name`}
                maxLength={40}
                autoComplete="off"
                className="min-w-0 flex-1 rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <span className="flex w-28 shrink-0 items-center rounded-lg border border-line px-2 focus-within:border-accent">
                <span className="text-xs text-gray-400">{currency}</span>
                <input
                  value={r.price}
                  onChange={(e) => set(i, { price: e.target.value })}
                  inputMode="decimal"
                  placeholder="0"
                  aria-label={`Item ${i + 1} price`}
                  autoComplete="off"
                  className="w-full bg-transparent py-2 text-right text-sm tabular-nums outline-none"
                />
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {people.map((p) => {
                const on = r.who.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(i, p.id)}
                    aria-pressed={on}
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${on ? "border-fg bg-fg text-canvas" : "border-line text-gray-500"}`}
                  >
                    {p.label}
                  </button>
                );
              })}
              <button type="button" onClick={() => set(i, { who: people.map((p) => p.id) })} className="px-1 text-xs font-semibold text-accent">
                All
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setRows((rs) => [...rs, blank()])} className="text-sm font-semibold text-fg">
        ＋ Another item
      </button>

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["Tax / GST", tax, setTax],
            ["Service charge", service, setService],
            ["Tip", tip, setTip],
          ] as const
        ).map(([l, v, setV]) => (
          <label key={l} className="block">
            <span className="mb-1 block text-[11px] font-medium text-gray-500">{l}</span>
            <input
              value={v}
              onChange={(e) => setV(e.target.value)}
              inputMode="decimal"
              placeholder="0 or 5%"
              aria-label={l}
              autoComplete="off"
              className="w-full rounded-lg border border-line bg-transparent px-2.5 py-2 text-right text-sm tabular-nums outline-none focus:border-accent"
            />
          </label>
        ))}
      </div>

      {subtotal > 0 && (
        <div className="rounded-xl border border-line px-3 py-2.5 text-sm" role="status">
          {missingWho ? (
            <p className="text-gray-500">Tap who had each item.</p>
          ) : badExtra ? (
            <p className="text-red-500">Tax, service and tip: an amount, or a % like 5%.</p>
          ) : result ? (
            <>
              <ul className="space-y-0.5">
                {people
                  .filter((p) => (result.perPerson[p.id] ?? 0) > 0)
                  .map((p) => (
                    <li key={p.id} className="flex justify-between gap-3 tabular-nums" data-item-share={p.label}>
                      <span>{p.label}</span>
                      <span className="font-semibold">{money(result.perPerson[p.id])}</span>
                    </li>
                  ))}
              </ul>
              <p className="mt-1.5 border-t border-line pt-1.5 text-xs text-gray-500 tabular-nums">
                Items {money(result.subtotal)}
                {result.extras > 0 ? ` + ${money(result.extras)} tax/service/tip` : ""} = <strong className="text-fg">{money(result.total)}</strong>
              </p>
            </>
          ) : null}
        </div>
      )}
      <button
        type="button"
        onClick={apply}
        disabled={!result}
        className="block w-full rounded-xl bg-fg px-4 py-3 text-center text-sm font-semibold text-canvas disabled:opacity-40"
      >
        {result ? `Use this split · ${money(result.total)}` : "Use this split"}
      </button>
    </div>
  );
}
