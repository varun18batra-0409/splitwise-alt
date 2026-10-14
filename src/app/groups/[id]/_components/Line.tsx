// A label/value row used in expense breakdowns.
export function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={`flex justify-between gap-3 ${strong ? "font-semibold text-ink" : ""}`}>
      <span className="whitespace-pre">{label}</span>
      <span className="text-right">{value}</span>
    </p>
  );
}
