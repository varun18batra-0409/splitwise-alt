import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { getMyMemberId } from "@/lib/identity";
import { loadGroup } from "@/lib/group-data";
import { getTimeZone } from "@/lib/tz";
import { formatMoney } from "@/lib/money";
import { dateRange, tripReport } from "@/lib/trip-report";
import { PageHeader } from "@/components/ui";
import { TripShare } from "@/components/TripShare";

export const metadata = { title: "Trip report" };

// The trip in numbers, to look back on and share (a picture plus text, never a link).
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const myId = await getMyMemberId(id);
  const data = await loadGroup(id);
  if (!data) notFound();
  if (!myId || !data.group.members.some((m) => m.id === myId)) redirect("/private");
  const { group, expenses, transfers } = data;
  const r = tripReport({ name: group.name, currency: group.currency, members: group.members, expenses, transfers, tz: await getTimeZone() });
  const m = (x: number) => formatMoney(x, group.currency);
  const title = group.type === "trip" ? "Trip report" : "Group report";

  return (
    <>
      <PageHeader title={title} back={`/groups/${group.id}`} />
      {r.count === 0 ? (
        <p className="rounded-2xl bg-mist px-4 py-8 text-center text-sm text-gray-600">The report appears once the group has expenses.</p>
      ) : (
        <>
          <section className="vault rounded-[24px] px-6 py-7 text-fg" aria-label="The trip in numbers">
            <p className="text-sm text-fg/60">{[dateRange(r), r.days > 1 ? `${r.days} days` : "", `${r.count} expenses`].filter(Boolean).join(" · ")}</p>
            <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight">{group.name}</h1>
            <p className="mt-4 font-display text-[40px] font-semibold leading-none tabular-nums">{m(r.total)}</p>
            <p className="mt-2 text-sm text-fg/70">
              {[r.people > 1 ? `about ${m(r.perPerson)} each` : "", r.days > 1 ? `${m(r.perDay)} a day` : ""].filter(Boolean).join(" · ")}
            </p>

            <ul className="mt-6 space-y-3">
              {r.categories.slice(0, 4).map((c) => (
                <li key={c.id}>
                  <div className="flex justify-between text-sm">
                    <span>
                      {c.emoji} {c.label}
                    </span>
                    <span className="tabular-nums text-fg/70">
                      {m(c.amount)} · {c.pct}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-line">
                    <div className="h-1.5 rounded-full bg-owed" style={{ width: `${Math.max(2, c.pct)}%` }} />
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-6 space-y-1 text-sm text-fg/70">
              {r.biggest && (
                <p>
                  Biggest: {r.biggest.description} ({m(r.biggest.amount)})
                </p>
              )}
              {r.topPayer && r.people > 1 && (
                <p>
                  Paid the most: {r.topPayer.id === myId ? "You" : r.topPayer.name} ({m(r.topPayer.amount)})
                </p>
              )}
            </div>

            {r.people > 1 && (
              <>
                <h2 className="mt-6 text-sm font-semibold">Each person’s part</h2>
                <ul className="mt-2 space-y-1 text-sm text-fg/70">
                  {r.shares.map((s) => (
                    <li key={s.id} className="flex justify-between">
                      <span>{s.id === myId ? "You" : s.name}</span>
                      <span className="tabular-nums">{m(s.amount)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h2 className="mt-6 text-sm font-semibold">{r.settle.length ? "To settle up" : "All settled ✅"}</h2>
            {r.settle.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-fg/70">
                {r.settle.map((s, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>
                      {s.from} → {s.to}
                    </span>
                    <span className="tabular-nums text-owe">{m(s.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="mt-6">
            <TripShare report={r} />
          </div>

          {!group.closed && (
            <section className="mt-10 border-t border-line pt-6">
              <h2 className="text-base font-semibold">{group.type === "trip" ? "Trip over?" : "All done?"}</h2>
              <p className="mb-4 mt-1 text-sm text-gray-500">
                {transfers.length
                  ? "Settle up, then close the group. It stays in your history, and this report stays here."
                  : "Everyone’s square. Close the group; it stays in your history, and this report stays here."}
              </p>
              <Link href={`/groups/${group.id}/settle#close`} className="block border border-line px-4 py-3 text-center text-sm font-semibold text-fg active:bg-mist">
                {transfers.length ? "Settle up & close" : "Close the group"}
              </Link>
            </section>
          )}
        </>
      )}
    </>
  );
}
