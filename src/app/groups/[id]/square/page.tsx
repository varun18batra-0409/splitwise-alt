import { notFound, redirect } from "next/navigation";
import Link from "@/components/Link";
import { loadGroup } from "@/lib/group-data";
import { getMyMemberId } from "@/lib/identity";
import { formatMoney } from "@/lib/money";
import { PageHeader, secondaryButtonClass } from "@/components/ui";
import { GroupCover } from "@/components/GroupCover";
import { ShareSheet } from "@/components/ShareSheet";
import { coverFor } from "@/lib/covers";
import { placePhoto } from "@/lib/places";
import { squareNumbers, squareTiles } from "@/lib/square";
import { Confetti } from "@/components/Confetti";

// "All square": nobody owes anybody. A moment worth sharing, not just a zero.
export default async function SquarePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ amounts?: string }> }) {
  const { id } = await params;
  const hide = (await searchParams).amounts === "0";
  const data = await loadGroup(id, { events: false, viewer: await getMyMemberId(id) });
  if (!data) notFound();
  const { group, expenses, payments, transfers } = data;
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  const people = group.members.filter((m) => !m.leftAt).length;
  const n = squareNumbers({ expenses, payments, people, tripStart: group.tripStart, tripEnd: group.tripEnd });
  const money = (x: number) => formatMoney(x, group.currency);
  const photo = group.type === "trip" ? placePhoto(group.name)?.src : undefined;
  const square = transfers.length === 0 && expenses.length > 0;
  const tiles = squareTiles(n, { hide, formatSpent: money });

  return (
    <>
      <PageHeader title={square ? "All square" : "Not square yet"} back={`/groups/${group.id}`} />
      <section aria-label="All square" className="flex flex-col items-center">
        {/* The group's polaroid, pinned. */}
        <div className="relative mt-2 w-[78%] max-w-[300px] -rotate-2 bg-[#f4f1e8] p-2.5 pb-0 shadow-[0_30px_50px_-20px_rgba(0,0,0,0.95)]">
          <span aria-hidden className="absolute -top-3 left-1/2 z-10 h-6 w-16 -translate-x-1/2 rotate-2 bg-[#f4f1e8]/70 shadow-sm" />
          <div className="relative aspect-[4/3.4] overflow-hidden bg-[#222]">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <GroupCover {...coverFor(group)} uid={`sq-${group.id}`} letter={group.name} sizes="300px" />
            )}
          </div>
          <p className="truncate px-1 pb-3 pt-2 text-center font-hand text-[26px] font-bold text-[#26231d]">{group.name}</p>
        </div>

        {square ? (
          <>
            <Confetti id={`${group.id}:${expenses.length}:${payments.length}`} />
            <p className="mt-9 text-center font-display text-[44px] font-semibold leading-none tracking-tight" data-square>
              All square
            </p>
            <p className="mt-3 text-center font-hand text-[24px] font-bold text-[#ffd9a8]">Nobody owes anybody. Nice one.</p>
            <dl className={`mt-8 grid w-full gap-2 text-center ${tiles.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
              {tiles.map(([v, l]) => (
                <div key={l} className="rounded-2xl border border-line px-2 py-3">
                  <dt className="sr-only">{l}</dt>
                  <dd className="money text-lg font-semibold tabular-nums">{v}</dd>
                  <dd className="text-xs text-gray-500">{l}</dd>
                </div>
              ))}
            </dl>
            {/* One switch, no extra screen: it changes the tiles above and the picture that gets shared. */}
            <a
              href={hide ? `/groups/${group.id}/square` : `/groups/${group.id}/square?amounts=0`}
              role="switch"
              aria-checked={hide}
              data-hide-amounts
              className="mt-6 flex min-h-11 w-full items-center gap-3 rounded-2xl border border-line px-4 py-2.5 active:bg-mist"
            >
              <span className="min-w-0 flex-1 text-sm font-medium">Hide amounts</span>
              <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${hide ? "bg-owed" : "bg-fg/15"}`}>
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-canvas transition-all ${hide ? "left-6" : "left-1"}`} />
              </span>
            </a>
            <div className="mt-4 w-full">
              <ShareSheet image={`/groups/${group.id}/square-image${hide ? "?amounts=0" : ""}`} fileName="all-square.png" title="Share: all square" words={`${group.name}: all square 🎉 Nobody owes anybody.`} label="Share the moment" />
            </div>
          </>
        ) : (
          <>
            <p className="mt-9 text-center font-display text-3xl font-semibold">Almost there</p>
            <p className="mt-2 text-center text-sm text-gray-500">
              {transfers.length === 0 ? "Add an expense first." : `${transfers.length} ${transfers.length === 1 ? "payment" : "payments"} to go.`}
            </p>
            {transfers.length > 0 && (
              <Link href={`/groups/${group.id}/settle`} className={`mt-6 w-full ${secondaryButtonClass}`}>
                Settle up
              </Link>
            )}
          </>
        )}
        <Link href={`/groups/${group.id}`} className="mt-6 text-sm font-medium text-fg underline underline-offset-4">
          Back to {group.name}
        </Link>
      </section>
    </>
  );
}
