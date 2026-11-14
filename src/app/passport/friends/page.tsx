import Link from "@/components/Link";
import { PeoplePassportsIcon } from "@/components/DrawnIcons";
import { LockIcon } from "@/components/PassportIcons";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { loadPassport, passportFriends } from "@/lib/passport-db";
import { passportShared } from "@/lib/passport";
import { countryOf } from "@/lib/geo";
import { Avatar, PageHeader, primaryButtonClass } from "@/components/ui";
import { FriendSearch } from "@/components/FriendSearch";
import { pickFriends } from "@/lib/friend-list";

export const metadata = { title: "Friends’ passports", robots: { index: false } };

// Everyone you've shared a group with (on Loopin), and where they've been.
// Tap anyone to open their passport.
export default async function FriendsPassports({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const account = await getAccount();
  if (!account)
    return (
      <>
        <PageHeader title="Friends’ passports" back="/passport" />
        <p className="text-sm text-gray-500">Sign in to see where your friends have been.</p>
        <Link href="/signin?back=/passport/friends" className={`mt-5 ${primaryButtonClass}`}>
          Sign in
        </Link>
      </>
    );
  const today = todayKey(new Date(), await getTimeZone());
  const { shown: friends, matched, total } = pickFriends(await passportFriends(account.id), q.slice(0, 60), 80);
  const owners = await Promise.all(
    friends.map(async (f) => {
      const { db } = await import("@/lib/db");
      const a = await db.account.findUnique({ where: { id: f.accountId }, select: { id: true, homeCountry: true, places: true, passportShare: true, passportChoiceAt: true } });
      if (!a || !passportShared(a)) return { ...f, private: true, unshared: Boolean(a) && a!.passportShare !== "private", countries: [] as string[], stats: null };
      const p = await loadPassport(a, "", today, { forFriend: true });
      return { ...f, private: false, unshared: false, countries: p.index.map((r) => r.code), stats: p.stats };
    }),
  );
  const first = (n: string) => n.trim().split(/\s+/)[0] || n;
  return (
    <>
      <PageHeader title="Friends’ passports" back="/passport" />
      <p className="-mt-2 mb-4 text-sm text-gray-500">Everyone you’ve shared a group with. Tap anyone to flip through their stamps.</p>
      {total > 80 && (
        // A long list: the page shows 80 at a time, and this searches everyone by name.
        <form method="get" role="search" className="mb-4">
          <input name="q" defaultValue={q} placeholder={`Search all ${total} friends by name`} aria-label="Search all friends by name" autoComplete="off" enterKeyHint="search" className="w-full rounded-xl border border-line bg-transparent px-4 py-3 text-base outline-none focus:border-fg/50" />
          {matched > owners.length && <p className="mt-2 text-xs text-gray-500">Showing {owners.length} of {matched}. Type more of the name to narrow it down.</p>}
        </form>
      )}
      {owners.length === 0 && total > 0 && q ? (
        <p className="py-6 text-center text-sm text-gray-500">Nobody matches “{q}”.</p>
      ) : owners.length === 0 ? (
        <div className="rounded-2xl bg-mist px-5 py-8 text-center">
          <span aria-hidden className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-fg/25 text-fg/75">
            <PeoplePassportsIcon size={26} />
          </span>
          <p className="mt-2 font-semibold">No friends here yet</p>
          <p className="mt-1 text-sm text-gray-500">When friends join your groups on Loopin, their passports show up here.</p>
          <Link href="/groups/new" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4">
            Start a trip
          </Link>
        </div>
      ) : (
        <FriendSearch count={owners.length}>
          <ul className="divide-y divide-line border-y border-line" data-friends>
            {owners.map((f) => (
              <li key={f.accountId} data-friend={first(f.name).toLowerCase()} data-search={`${f.name} ${f.countries.map((c) => countryOf(c)?.name ?? "").join(" ")}`.toLowerCase()}>
                <Link href={`/passport/friends/${f.accountId}`} className="flex items-center gap-3 py-3 active:bg-mist">
                  <Avatar name={f.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{f.name}</span>
                    <span className="block truncate text-xs text-gray-400">
                      {[
                        f.private
                          ? f.unshared
                            ? "Hasn’t shared their passport yet"
                            : "Keeps their passport private"
                          : f.stats
                            ? [f.stats.countries ? `${f.stats.countries} ${f.stats.countries === 1 ? "country" : "countries"}` : "", f.stats.cities ? `${f.stats.cities} ${f.stats.cities === 1 ? "city" : "cities"}` : ""].filter(Boolean).join(" · ")
                            : "",
                        `${f.groups.slice(0, 2).join(", ")}${f.groups.length > 2 ? ` +${f.groups.length - 2}` : ""}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {f.private && (
                    <span className="shrink-0 text-fg/55" aria-hidden>
                      <LockIcon size={16} />
                    </span>
                  )}
                  <span aria-hidden className="text-gray-400">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </FriendSearch>
      )}
    </>
  );
}
