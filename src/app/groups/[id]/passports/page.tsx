import { notFound, redirect } from "next/navigation";
import Link from "@/components/Link";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { loadPassport } from "@/lib/passport-db";
import { countryOf } from "@/lib/geo";
import { Avatar, PageHeader } from "@/components/ui";
import { WorldMap } from "@/components/PassportBook";
import map from "@/generated/map.json";

export const metadata = { title: "Our passports", robots: { index: false } };

// The group's passports: where everyone in this group has been, together and
// one by one. Respects each person's "Only me" switch, and never shows a trip
// that's still happening.
export default async function GroupPassports({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const myId = await getMyMemberId(id);
  if (!myId) redirect("/private");
  const group = await db.group.findUnique({
    where: { id },
    select: { id: true, name: true, deletedAt: true, members: { select: { id: true, name: true, accountId: true, claimedAt: true, leftAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!group || group.deletedAt || !group.members.some((m) => m.id === myId)) notFound();
  const today = todayKey(new Date(), await getTimeZone());
  type Person = { m: { id: string; name: string; accountId: string | null; claimedAt: Date | null; leftAt: Date | null }; mine: boolean; state: "notOnLoopin" | "private" | "open" | "empty"; codes: string[]; cities: number };
  const people: Person[] = await Promise.all(
    group.members.map(async (m): Promise<Person> => {
      const mine = m.id === myId;
      if (!m.accountId) return { m, mine, state: "notOnLoopin", codes: [], cities: 0 };
      const a = await db.account.findUnique({ where: { id: m.accountId }, select: { id: true, homeCountry: true, places: true, passportShare: true } });
      if (!a) return { m, mine, state: "notOnLoopin", codes: [], cities: 0 };
      if (!mine && a.passportShare === "private") return { m, mine, state: "private", codes: [], cities: 0 };
      const p = await loadPassport(a, "", today, { forFriend: !mine });
      const codes = p.index.map((r) => r.code);
      return { m, mine, state: codes.length ? "open" : "empty", codes, cities: p.stats.cities };
    }),
  );
  const first = (n: string) => n.trim().split(/\s+/)[0] || n;
  const visible = people.filter((p) => p.state === "open");
  const together = [...new Set(visible.flatMap((p) => p.codes))].sort((a, b) => (countryOf(a)?.name ?? a).localeCompare(countryOf(b)?.name ?? b, "en"));
  // A couple of fun lines.
  const lines: string[] = [];
  const most = [...visible].sort((a, b) => b.codes.length - a.codes.length)[0];
  if (most && visible.length > 1 && most.codes.length > (visible.find((x) => x !== most)?.codes.length ?? 0))
    lines.push(`🧭 Most travelled: ${most.mine ? "you" : first(most.m.name)}, ${most.codes.length} ${most.codes.length === 1 ? "country" : "countries"}`);
  // Every country only one of you has been to, person by person, and the ones you've all been to.
  const onlyBy =
    visible.length > 1
      ? [...visible]
          .sort((a, b) => Number(b.mine) - Number(a.mine))
          .map((p) => ({ p, codes: together.filter((c) => p.codes.includes(c) && visible.filter((x) => x.codes.includes(c)).length === 1) }))
          .filter((r) => r.codes.length > 0)
      : [];
  const shared = visible.length > 1 ? together.filter((c) => visible.filter((p) => p.codes.includes(c)).length === visible.length) : [];
  const back = `/groups/${id}`;
  const order = [...people].sort((a, b) => Number(b.mine) - Number(a.mine) || Number(Boolean(a.m.leftAt)) - Number(Boolean(b.m.leftAt)) || b.codes.length - a.codes.length);
  return (
    <>
      <PageHeader title="Our passports" back={back} />
      <section aria-label="Together" className="rounded-[22px] border border-line bg-white px-5 py-5">
        <p className="text-sm text-gray-500">{group.name}, together</p>
        <p className="mt-1 font-display text-[28px] font-semibold leading-tight" data-group-countries={together.length}>
          {together.length} {together.length === 1 ? "country" : "countries"}
        </p>
        {together.length > 0 && (map as { ok: boolean }).ok && (
          <div className="mt-3 rounded-[14px] bg-[#efe8d6] p-2">
            <WorldMap className="" index={together.map((c) => ({ code: c, name: countryOf(c)?.name ?? c, trips: 1 }))} />
          </div>
        )}
        {together.length > 0 && (
          <p className="mt-2 text-[22px] leading-snug tracking-[0.06em]" aria-label={together.map((c) => countryOf(c)?.name).join(", ")}>
            {together.map((c) => countryOf(c)?.flag).join(" ")}
          </p>
        )}
        {lines.length > 0 && (
          <ul className="mt-4 space-y-1.5 text-sm text-fg/85">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        {(shared.length > 0 || onlyBy.length > 0) && (
          <div className="mt-5 space-y-3" data-passport-compare>
            {shared.length > 0 && (
              <CountryRow title={`🤝 All of you (${shared.length})`} codes={shared} />
            )}
            {onlyBy.map(({ p, codes }) => (
              <CountryRow key={p.m.id} title={`✨ Only ${p.mine ? "you" : first(p.m.name)} (${codes.length})`} codes={codes} data-only={p.mine ? "you" : first(p.m.name)} />
            ))}
          </div>
        )}
        {together.length === 0 && <p className="mt-2 text-sm text-gray-500">No stamps yet. Finish a trip together, or add the countries you’ve been to on your passport.</p>}
      </section>

      <ul className="mt-6 divide-y divide-line border-y border-line" data-group-passports>
        {order.map(({ m, mine, state, codes, cities }) => {
          const href = mine ? "/passport" : state === "notOnLoopin" ? `/groups/${id}/people` : `/passport/friends/${m.accountId}?from=${id}`;
          const sub =
            state === "notOnLoopin"
              ? "Not on Loopin yet · invite them"
              : state === "private"
                ? "Keeps their passport private"
                : state === "empty"
                  ? mine
                    ? "Empty so far · add where you’ve been"
                    : "Empty so far · nudge them"
                  : [`${codes.length} ${codes.length === 1 ? "country" : "countries"}`, cities ? `${cities} ${cities === 1 ? "city" : "cities"}` : ""].filter(Boolean).join(" · ");
          return (
            <li key={m.id}>
              <Link href={href} className="flex items-center gap-3 py-3 active:bg-mist" data-passport-person={first(m.name)}>
                <Avatar name={m.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {mine ? `${m.name} (you)` : m.name}
                    {m.leftAt && <span className="ml-1.5 text-xs font-normal text-gray-400">left</span>}
                  </span>
                  <span className="block truncate text-xs text-gray-400">{sub}</span>
                </span>
                <span className="shrink-0 text-base" aria-hidden>
                  {state === "private" ? "🔒" : codes.slice(0, 4).map((c) => countryOf(c)?.flag).join("")}
                </span>
                <span aria-hidden className="text-gray-400">
                  ›
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-center text-xs text-gray-400">Trips still happening stay hidden until they’re over.</p>
    </>
  );
}

// A titled row of countries: flag and name, all of them (they wrap).
function CountryRow({ title, codes, ...rest }: { title: string; codes: string[]; "data-only"?: string }) {
  return (
    <div className="rounded-[16px] bg-mist/60 px-3.5 py-3" {...rest}>
      <p className="mb-2 text-[13px] font-semibold text-fg/80">{title}</p>
      <ul className="flex flex-wrap gap-1.5">
        {codes.map((c) => (
          <li key={c} className="flex items-center gap-1 rounded-full border border-line bg-canvas/40 px-2.5 py-1 text-[12.5px] text-fg/85">
            <span aria-hidden>{countryOf(c)?.flag}</span>
            {countryOf(c)?.name ?? c}
          </li>
        ))}
      </ul>
    </div>
  );
}
