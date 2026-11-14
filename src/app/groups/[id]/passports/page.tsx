import { PassportCompare } from "@/components/PassportCompare";
import { notFound, redirect } from "next/navigation";
import Link from "@/components/Link";
import { LockIcon } from "@/components/PassportIcons";
import { db } from "@/lib/db";
import { getMyMemberId, privatePath } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { loadPassport, passportRoster } from "@/lib/passport-db";
import { blockedEitherWay } from "@/lib/blocks";
import { passportShared } from "@/lib/passport";
import { countryOf } from "@/lib/geo";
import { Avatar, PageHeader } from "@/components/ui";
import map from "@/generated/map.json";

export const metadata = { title: "Our passports", robots: { index: false } };

// The group's passports: where everyone in this group has been, together and
// one by one. Respects each person's "Only me" switch, and never shows a trip
// that's still happening.
export default async function GroupPassports({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const myId = await getMyMemberId(id);
  if (!myId) redirect(await privatePath(id));
  const group = await db.group.findUnique({
    where: { id },
    select: { id: true, name: true, deletedAt: true, members: { select: { id: true, name: true, accountId: true, claimedAt: true, leftAt: true, addedBy: true, seenAt: true, removedAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!group || group.deletedAt || !group.members.some((m) => m.id === myId)) notFound();
  // Only someone who really joined (and wasn't removed) can open it, and it lists only people who did too.
  const everyone = passportRoster(group.members, myId);
  if (!everyone) redirect(await privatePath(id));
  // Someone blocked (either way round) is left out of Our passports; the group itself is untouched.
  const myAccountId = group.members.find((m) => m.id === myId)?.accountId;
  const hidden = myAccountId ? await blockedEitherWay(myAccountId) : new Set<string>();
  const roster = everyone.filter((m) => m.id === myId || !m.accountId || !hidden.has(m.accountId));
  const today = todayKey(new Date(), await getTimeZone());
  type Person = { m: { id: string; name: string; accountId: string | null; claimedAt: Date | null; leftAt: Date | null; addedBy: string; seenAt: Date | null; removedAt: Date | null }; mine: boolean; state: "notOnLoopin" | "private" | "unshared" | "open" | "empty"; codes: string[]; cities: number };
  const people: Person[] = await Promise.all(
    roster.map(async (m): Promise<Person> => {
      const mine = m.id === myId;
      if (!m.accountId) return { m, mine, state: "notOnLoopin", codes: [], cities: 0 };
      const a = await db.account.findUnique({ where: { id: m.accountId }, select: { id: true, homeCountry: true, places: true, passportShare: true, passportChoiceAt: true } });
      if (!a) return { m, mine, state: "notOnLoopin", codes: [], cities: 0 };
      if (!mine && !passportShared(a)) return { m, mine, state: a.passportShare === "private" ? "private" : "unshared", codes: [], cities: 0 };
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
    lines.push(`Most travelled: ${most.mine ? "you" : first(most.m.name)}, ${most.codes.length} ${most.codes.length === 1 ? "country" : "countries"}`);
  // Every country only one of you has been to, person by person, and the ones you've all been to.
  const onlyBy =
    visible.length > 1
      ? [...visible]
          .sort((a, b) => Number(b.mine) - Number(a.mine))
          .map((p) => ({ p, codes: together.filter((c) => p.codes.includes(c) && visible.filter((x) => x.codes.includes(c)).length === 1) }))
          .filter((r) => r.codes.length > 0)
      : [];
  const shared = visible.length > 1 ? together.filter((c) => visible.filter((p) => p.codes.includes(c)).length === visible.length) : [];
  const c3 = (code: string) => ({ code, flag: countryOf(code)?.flag ?? "", name: shortName(code) });
  const back = `/groups/${id}`;
  const order = [...people].sort((a, b) => Number(b.mine) - Number(a.mine) || Number(Boolean(a.m.leftAt)) - Number(Boolean(b.m.leftAt)) || b.codes.length - a.codes.length);
  return (
    <>
      <PageHeader title="Our passports" back={back} />
      <section aria-label="Together" className="rounded-[22px] border border-line bg-white px-5 py-5">
        <p className="text-sm text-gray-500">{group.name}</p>
        {together.length > 0 && <p className="mt-1 text-[15px] text-fg/75">Between you</p>}
        <p className="mt-0.5 font-display text-[28px] font-semibold leading-tight" data-group-countries={together.length}>
          {together.length === 0 ? "No countries yet" : <span className="whitespace-nowrap">{together.length} {together.length === 1 ? "country" : "countries"}</span>}
        </p>
        {lines.length > 0 && (
          <ul className="mt-4 space-y-1.5 text-sm text-fg/85">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        {together.length > 0 && (
          <PassportCompare
            showMap={(map as { ok: boolean }).ok}
            sets={[
              { key: "all", label: "Everywhere", countries: together.map(c3) },
              ...(shared.length > 0 ? [{ key: "shared", label: "Shared", countries: shared.map(c3) }] : []),
              ...onlyBy.map(({ p, codes }) => ({ key: p.mine ? "you" : p.m.id, label: `Only ${p.mine ? "you" : first(p.m.name)}`, countries: codes.map(c3) })),
            ]}
          />
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
                : state === "unshared"
                  ? "Hasn’t shared their passport yet"
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
                <span className="shrink-0 text-[13px] tabular-nums text-fg/55" aria-hidden>
                  {state === "private" || state === "unshared" ? <LockIcon size={16} /> : codes.slice(0, 4).join(" ")}
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

// Short enough to sit under a flag.
const SHORT: Record<string, string> = { AE: "UAE", GB: "UK", US: "USA", VA: "Vatican", BA: "Bosnia", CZ: "Czechia", KR: "S. Korea", KP: "N. Korea", DO: "Dominican Rep.", CD: "DR Congo", CF: "C. African Rep.", ZA: "S. Africa", NZ: "N. Zealand", SA: "Saudi", PG: "Papua NG", TT: "Trinidad", AG: "Antigua", KN: "St Kitts", VC: "St Vincent", LC: "St Lucia", MK: "N. Macedonia", BO: "Bolivia", LA: "Laos", RU: "Russia", TZ: "Tanzania", VN: "Vietnam", SY: "Syria", IR: "Iran", MD: "Moldova", PS: "Palestine", TW: "Taiwan" };
const shortName = (code: string) => SHORT[code] ?? countryOf(code)?.name ?? code;
