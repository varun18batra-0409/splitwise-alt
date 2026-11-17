// The number row at the top of the Been tab: countries · trips · days travelled. A number that is 0 is left out.
export function PassportStats({ stats }: { stats: { n: number; label: string }[] }) {
  if (!stats.length) return null;
  return (
    <div className="mb-6">
    <dl className="flex rounded-[20px] border border-line bg-white py-3.5" data-passport-stats-row={stats.map((s) => s.n).join("|")}>
      {stats.map((s, i) => (
        <div key={s.label} className={`flex min-w-0 flex-1 flex-col-reverse items-center justify-end px-1 text-center ${i ? "border-l border-line" : ""}`}>
          <dt className="mt-1 text-balance text-[14px] leading-tight text-fg/75">{s.label}</dt>
          <dd className="font-display text-[24px] font-semibold leading-none tabular-nums">{s.n}</dd>
        </div>
      ))}
    </dl>
    {/* Where the numbers come from, once and quietly. */}
    <p className="mt-2 text-balance text-center text-[13px] leading-snug text-fg/55" data-passport-stats-note>
      Trips and days come from your trips in Loopin.
    </p>
    </div>
  );
}
