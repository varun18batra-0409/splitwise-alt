import Link from "@/components/Link";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { loadPassport, passportFriends } from "@/lib/passport-db";
import { countryOf } from "@/lib/geo";
import { Avatar, PageHeader, primaryButtonClass } from "@/components/ui";
import { FriendSearch } from "@/components/FriendSearch";

export const metadata = { title: "Friends’ passports", robots: { index: false } };

// Everyone you've shared a group with (on Loopin), and where they've been.
// Tap anyone to open their passport.
export default async function FriendsPassports() {
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
  const friends = (await passportFriends(account.id)).slice(0, 80);
  const owners = await Promise.all(
    friends.map(async (f) => {
      const { db } = await import("@/lib/db");
      const a = await db.account.findUnique({ where: { id: f.accountId }, select: { id: true, homeCountry: true, places: true, passportShare: true } });
      if (!a || a.passportShare === "private") return { ...f, private: true, countries: [] as string[], stats: null };
      const p = await loadPassport(a, "", today);
      return { ...f, private: false, countries: p.index.map((r) => r.code), stats: p.stats };
    }),
  );
  const first = (n: string) => n.trim().split(/\s+/)[0] || n;
  return (
    <>
      <PageHeader title="Friends’ passports" back="/passport" />
      <p className="-mt-2 mb-4 text-sm text-gray-500">Everyone you’ve shared a group with. Tap anyone to flip through their stamps.</p>
      {owners.length === 0 ? (
        <div className="rounded-2xl bg-mist px-5 py-8 text-center">
          <p className="text-3xl" aria-hidden>
            🛂
          </p>
          <p className="mt-2 font-semibold">No friends here yet</p>
          <p className="mt-1 text-sm text-gray-500">When friends join your groups on Loopin, their passports show up here.</p>
          <Link href="/groups/new" className="mt-5 inline-block text-sm font-semibold underline underline-offset-4">
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
                      {f.private ? "Keeps their passport private" : f.stats ? `${f.stats.countries} ${f.stats.countries === 1 ? "country" : "countries"} · ${f.stats.cities} ${f.stats.cities === 1 ? "city" : "cities"}` : ""}
                      {" · "}
                      {f.groups.slice(0, 2).join(", ")}
                      {f.groups.length > 2 ? ` +${f.groups.length - 2}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-base tracking-tight" aria-hidden>
                    {f.private ? "🔒" : f.countries.slice(0, 4).map((c) => countryOf(c)?.flag).join("")}
                  </span>
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
