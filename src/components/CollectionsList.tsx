import Link from "@/components/Link";
import { formatMoney } from "@/lib/money";
import { countsLine, progress, progressBar } from "@/lib/collect-rules";

export type CollectionRow = {
  id: string;
  code: string;
  title: string;
  currency: string;
  amount: number;
  closedAt: Date | null;
  entries: { name: string; amount: number; status: string }[];
};

// Collect: the collections you're running (open first), each with how far along it is.
// On Home it shows the first few with "See all"; on its own page (limit left out) it shows every one.
// `total`: the real number of collections when `list` holds only the newest (Home loads 20): "See all N" says the real N.
export function CollectionsSection({ list, limit, total, className = "mt-8" }: { list: CollectionRow[]; limit?: number; total?: number; className?: string }) {
  const all = Math.max(total ?? 0, list.length);
  const shown = limit ? list.slice(0, limit) : list;
  return (
    <section className={className} aria-label="Collections">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold tracking-tight">Collecting</h2>
        <Link href="/collect/new" className="text-sm text-gray-500">
          ＋ New
        </Link>
      </div>
      <ul className="lp-rise space-y-2">
        {shown.map((c) => {
          const p = progress(c.entries, c.amount);
          const bar = progressBar(p);
          const toCheck = p.paidCount - p.checked;
          return (
            <li key={c.id}>
              <Link href={`/c/${c.code}`} className={`block rounded-2xl border border-line px-4 py-3.5 active:bg-mist ${c.closedAt ? "opacity-60" : ""}`}>
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[15px] font-semibold">{c.title}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">Confirmed {formatMoney(p.confirmedAmount, c.currency)}</span>
                </span>
                <span className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-fg/[0.08]">
                  <span className="lp-bar-x block h-full bg-fg" style={{ width: `${Math.max(bar.confirmedPct, p.checked ? 4 : 0)}%` }} />
                  <span className="block h-full bg-fg/25" style={{ width: `${bar.reportedPct}%` }} />
                </span>
                <span className="mt-1.5 flex justify-between gap-3 text-xs text-gray-400">
                  <span>
                    {c.closedAt ? "Closed · " : ""}
                    {countsLine(p).split(" · ").map((part, i) => (
                      // Each part stays whole: "2 checked" never splits across two lines.
                      <span key={i} className="whitespace-nowrap">
                        {i > 0 && " · "}
                        {part}
                      </span>
                    ))}
                  </span>
                  {toCheck > 0 && !c.closedAt && (
                    <span className="shrink-0 font-medium text-owed">
                      {p.reportedAmount > 0 ? `${formatMoney(p.reportedAmount, c.currency)} reported, awaiting check` : `${toCheck} to check`}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {limit && all > limit && (
        <Link href="/collect" className="mt-3 block text-center text-sm font-medium text-fg/80 underline underline-offset-4">
          {`See all ${all} collections`}
        </Link>
      )}
    </section>
  );
}
