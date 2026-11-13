// The number row at the top of the Been tab: countries · trips · days away. A number that is 0 is left out.
export function PassportStats({ stats }: { stats: { n: number; label: string }[] }) {
  if (!stats.length) return null;
  return (
    <dl className="mb-6 flex rounded-[20px] border border-line bg-white py-3.5" data-passport-stats-row={stats.map((s) => s.n).join("|")}>
      {stats.map((s, i) => (
        <div key={s.label} className={`flex min-w-0 flex-1 flex-col-reverse items-center px-1 text-center ${i ? "border-l border-line" : ""}`}>
          <dt className="mt-1 text-[14px] text-fg/75">{s.label}</dt>
          <dd className="font-display text-[32px] font-semibold leading-none tabular-nums">{s.n}</dd>
        </div>
      ))}
    </dl>
  );
}
