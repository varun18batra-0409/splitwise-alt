import { ExpenseGlyph } from "@/components/ExpenseGlyph";
import { bounceIfDirect } from "@/lib/direct-db";
import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { getMyMemberId, privatePath } from "@/lib/identity";
import { loadGroup } from "@/lib/group-data";
import { getTimeZone } from "@/lib/tz";
import { formatMoney } from "@/lib/money";
import { overviewMoney, roundPartsToTotal, shownParts } from "@/lib/money-display";
import { Amt } from "@/components/Amt";
import { dateRange, tripReport } from "@/lib/trip-report";
import { PageHeader } from "@/components/ui";
import { getCategory } from "@/lib/categories";
import { TripShare } from "@/components/TripShare";
import { GroupCover } from "@/components/GroupCover";
import { coverFor, coverOf } from "@/lib/covers";
import { tripPhotoSrc } from "@/lib/places";

export const metadata = { title: "Trip report" };

// The trip in numbers, to look back on and share (a picture plus text, never a link).
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await bounceIfDirect(id); // a pair of two people has no group screens: its person page instead
  const myId = await getMyMemberId(id);
  const data = await loadGroup(id, { events: false, viewer: await getMyMemberId(id) });
  if (!data) notFound();
  if (!myId || !data.group.members.some((m) => m.id === myId)) redirect(await privatePath(id));
  const { group, expenses, transfers } = data;
  const viewerLeft = Boolean(data.leaver);
  const r = { ...tripReport({ name: group.name, type: group.type, currency: group.currency, members: group.members, expenses, transfers, tz: await getTimeZone() }), viewerLeft };
  const m = (x: number) => <Amt minor={x} currency={group.currency} />; // whole units from 1,000 up; exact in the tooltip / data-exact
  const exact = (x: number) => formatMoney(x, group.currency); // the settle-up lines stay exact
  // The rows add up to the total shown: the category rows (and "Everything else") and each person's part are rounded together to the rounded
  // total, the largest leftover fractions going up (display only; the exact amount is in the tooltip).
  const catShown = roundPartsToTotal(r.categories.map((c) => c.amount), group.currency);
  // Everyone's part is rounded together; a tie for the extra unit goes by the group's own member order, never by the order on screen.
  const shareBy = shownParts(Object.fromEntries(r.shares.map((s) => [s.id, s.amount])), group.members.map((x) => x.id), group.currency);
  const rm = (shown: number, exactMinor: number) => (
    <span title={formatMoney(exactMinor, group.currency)} data-exact={formatMoney(exactMinor, group.currency)}>
      {overviewMoney(shown, group.currency)}
    </span>
  );
  const placeShot = tripPhotoSrc(group);
  const title = group.type === "trip" ? "Trip report" : "Group report";

  return (
    <>
      <PageHeader title={title} back={`/groups/${group.id}`} />
      {r.count === 0 ? (
        <p className="rounded-2xl bg-mist px-4 py-8 text-center text-sm text-gray-600">The report appears once the group has expenses.</p>
      ) : (
        <>
          <section className="vault overflow-hidden rounded-[24px] text-fg" aria-label="The trip in numbers">
            {coverOf(group) !== "plain" && (
              <div className="relative h-[170px] overflow-hidden" aria-hidden>
                {placeShot ? (
                  // The same place photo the group's own page shows (a Tokyo trip is Tokyo, not palms).
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={placeShot} alt="" className="lp-drift absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <GroupCover {...coverFor(group)} uid={`report-${group.id}`} sizes="(max-width: 448px) 100vw, 448px" priority drift />
                )}
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(17,17,20,0)_30%,#141418_100%)]" />
              </div>
            )}
            <div className={`relative px-6 pb-7 ${coverOf(group) !== "plain" ? "-mt-8" : "pt-7"}`}>
            <p className="text-sm text-fg/60">{[dateRange(r), r.days > 1 ? `${r.days} days` : "", `${r.count} expenses`].filter(Boolean).join(" · ")}</p>
            <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight">{group.name}</h1>
            <p className="mt-4 money whitespace-nowrap text-[40px] font-semibold leading-none tabular-nums max-[359px]:text-[34px]">{m(r.total)}</p>
            {/* Each part stays whole on a line; on a small phone the second drops under the first instead of breaking mid-way. */}
            <p className="mt-2 flex flex-wrap gap-x-2 text-sm text-fg/70">
              {r.people > 1 && <span className="whitespace-nowrap">about {m(r.perPerson)} each</span>}
              {r.people > 1 && r.days > 1 && <span aria-hidden className="max-[359px]:hidden">·</span>}
              {r.days > 1 && <span className="whitespace-nowrap">{m(r.perDay)} a day</span>}
            </p>

            <ul className="mt-6 space-y-3">
              {r.categories.slice(0, 4).map((c) => (
                <li key={c.id}>
                  <Link href={`/search?g=${group.id}&c=${c.id}`} className="block active:opacity-80" data-category-link={c.id}>
                  <div className="flex justify-between text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <ExpenseGlyph title="" category={c.id} size={20} className="shrink-0 rounded-[6px]!" />
                      <span className="min-w-0">
                        <span className="block break-words">{c.label}</span>
                        {/* The plain word under the playful name (Beds & Bunks / Stay), for readers who may not guess it. */}
                        <span className="block text-[13px] leading-tight text-fg/65" data-category-plain>{getCategory(c.id).plain}</span>
                      </span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap pl-3 tabular-nums text-fg/70">
                      {rm(catShown[r.categories.indexOf(c)], c.amount)} · {c.pct}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-line">
                    <div className="meter-bar h-1.5 origin-left rounded-full bg-fg" style={{ width: `${Math.max(2, c.pct)}%` }} />
                  </div>
                  </Link>
                </li>
              ))}
              {/* The rest, so the lines add up to the total. */}
              {r.categories.length > 4 && (
                <li className="flex justify-between text-sm text-fg/55">
                  <span>Everything else ({r.categories.length - 4})</span>
                  <span className="tabular-nums">
                    {rm(catShown.slice(4).reduce((t, x) => t + x, 0), r.categories.slice(4).reduce((t, c) => t + c.amount, 0))} · {r.categories.slice(4).reduce((t, c) => t + c.pct, 0)}%
                  </span>
                </li>
              )}
            </ul>

            <div className="mt-6 space-y-1 text-sm text-fg/70">
              {r.biggest && (
                <p>
                  Biggest: {r.biggest.description} ({m(r.biggest.amount)})
                </p>
              )}
              {r.topPayer && r.people > 1 && (
                <p>
                  Paid the most: {r.topPayer.id === myId ? "You" : r.topPayer.name} ({rm(r.topPayer.shown ?? r.topPayer.amount, r.topPayer.amount)})
                </p>
              )}
            </div>

            {r.people > 1 && (
              <>
                <h2 className="mt-6 text-sm font-semibold">Each person’s part</h2>
                <ul className="mt-2 space-y-1 text-sm text-fg/70">
                  {r.shares.map((s, si) => (
                    <li key={s.id} className="flex justify-between gap-3">
                      <span className="min-w-0 break-words">{s.id === myId ? "You" : s.name}</span>
                      <span className="shrink-0 whitespace-nowrap tabular-nums">{rm(shareBy[s.id] ?? s.amount, s.amount)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h2 className="mt-6 text-sm font-semibold">{r.settle.length ? "To settle up" : viewerLeft ? "You’re settled ✅" : "All settled ✅"}</h2>
            {r.settle.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-fg/70">
                {r.settle.map((s, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="min-w-0 break-words">
                      {s.fromId === myId ? "You" : s.from} → {s.toId === myId ? "You" : s.to}
                    </span>
                    {/* The colour rule: orange only when it is money you pay, green when it is coming to you, plain when it is between two others. */}
                    <span className={`shrink-0 whitespace-nowrap tabular-nums ${s.fromId === myId ? "text-owe" : s.toId === myId ? "text-owed" : "text-fg/80"}`}>{exact(s.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            </div>
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
                  : `${viewerLeft ? "You’re square." : "Everyone’s square."} Close the group; it stays in your history, and this report stays here.`}
              </p>
              <Link href={`/groups/${group.id}/settle#close`} className="block border border-line px-4 py-3 text-center text-sm font-semibold text-fg active:bg-mist rounded-full">
                {transfers.length ? "Settle up & close" : "Close the group"}
              </Link>
            </section>
          )}
        </>
      )}
    </>
  );
}
