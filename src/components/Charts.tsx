// Simple, accessible charts drawn with plain HTML (no chart library).
// Single-series charts use the one accent colour; every bar carries its value
// as text, and a table view is one tap away for screen readers and exact numbers.

export type BarDatum = { key: string; label: string; value: number; valueText: string; icon?: string };

// Horizontal bars: comparing amounts between categories or people.
export function HBarChart({ title, data, total }: { title: string; data: BarDatum[]; total?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure>
      <figcaption className="mb-3 flex items-baseline justify-between gap-3">
        <span className="font-display text-base font-semibold tracking-tight">{title}</span>
        {total && <span className="text-sm tabular-nums text-gray-500">{total}</span>}
      </figcaption>
      <ul className="space-y-3">
        {data.map((d) => (
          <li key={d.key} title={`${d.label}: ${d.valueText}`}>
            <div className="mb-1 flex justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                {d.icon && <span className="mr-1.5">{d.icon}</span>}
                {d.label}
              </span>
              <span className="shrink-0 tabular-nums text-gray-500">{d.valueText}</span>
            </div>
            <div className="h-2 rounded-full bg-mist">
              <div className="h-2 rounded-r-[4px] rounded-l-full bg-meter-up" style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <TableView data={data} />
    </figure>
  );
}

// Vertical columns: spending over time.
export function ColumnChart({ title, data, total }: { title: string; data: BarDatum[]; total?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0]);
  return (
    <figure>
      <figcaption className="mb-3 flex items-baseline justify-between gap-3">
        <span className="font-display text-base font-semibold tracking-tight">{title}</span>
        {total && <span className="text-sm tabular-nums text-gray-500">{total}</span>}
      </figcaption>
      {peak && <p className="mb-2 text-xs text-gray-500">Busiest day: {peak.label}, {peak.valueText}</p>}
      <div className="flex h-36 items-end gap-[2px] border-b border-line" role="img" aria-label={`${title}. Busiest day ${peak?.label}, ${peak?.valueText}`}>
        {data.map((d) => (
          <div key={d.key} className="flex h-full flex-1 items-end" title={`${d.label}: ${d.valueText}`}>
            <div
              className={`w-full rounded-t-[4px] ${d === peak ? "bg-meter-up" : "bg-meter-up/50"}`}
              style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-gray-400">
        <span>{data[0]?.label}</span>
        {data.length > 1 && <span>{data[data.length - 1]?.label}</span>}
      </div>
      <TableView data={data} />
    </figure>
  );
}

function TableView({ data }: { data: BarDatum[] }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer list-none py-1 text-xs text-gray-400 [&::-webkit-details-marker]:hidden">Show as table</summary>
      <table className="mt-1 w-full text-sm">
        <tbody>
          {data.map((d) => (
            <tr key={d.key} className="border-t border-gray-100">
              <td className="py-1.5">{d.label}</td>
              <td className="py-1.5 text-right tabular-nums">{d.valueText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
