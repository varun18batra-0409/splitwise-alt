import { headers } from "next/headers";
import { PeoplePassportsIcon } from "@/components/DrawnIcons";
import Link from "@/components/Link";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { visitorRegion } from "@/lib/region";
import { loadPassport } from "@/lib/passport-db";
import { COUNTRIES, countryOf } from "@/lib/geo";
import { parseHandPlaces, stampPages } from "@/lib/passport";
import { removePlaceAction, setHomeCountryAction, setPassportShareAction } from "@/app/passport-actions";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass } from "@/components/ui";
import { ShareSheet } from "@/components/ShareSheet";
import { PassportBook } from "@/components/PassportBook";
import { CountryPicker } from "@/components/CountryPicker";

export const metadata = { title: "Your trip passport", robots: { index: false } };

// Your trip passport: a booklet with a stamp for every trip (cities at home,
// countries abroad), plus countries from before Loopin, stamped lighter.

export default async function PassportPage({ searchParams }: { searchParams: Promise<{ error?: string; added?: string; shared?: string }> }) {
  const sp = await searchParams;
  const account = await getAccount();
  if (!account)
    return (
      <>
        <PageHeader title="Trip passport" back="/account" />
        <p className="text-sm text-gray-500">Sign in to collect a stamp for every trip, on any phone.</p>
        <Link href="/signin?back=/passport" className={`mt-5 ${primaryButtonClass}`}>
          Sign in
        </Link>
      </>
    );
  const today = todayKey(new Date(), await getTimeZone());
  const region = visitorRegion(await headers());
  const p = await loadPassport(account, region.country && countryOf(region.country) ? region.country : "", today);
  // Changes whenever the passport does, so a shared picture is never an old one.
  const version = `${p.stats.countries}-${p.stats.cities}-${p.stamps.length}-${p.been.length}-${(account.name || "").length}`;
  const home = countryOf(p.home);
  const hand = parseHandPlaces(account.places);
  const empty = p.stamps.length + p.been.length === 0;

  return (
    <>
      <PageHeader title="Trip passport" back="/account" />
      {sp.error && <ErrorNote>{sp.error.slice(0, 120)}</ErrorNote>}

      <Link href="/passport/friends" className="mb-4 flex items-center gap-3 rounded-2xl border border-line px-4 py-3 active:bg-mist" data-friends-link>
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-owed/40 text-owed"><PeoplePassportsIcon size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Friends’ passports</span>
          <span className="block text-xs text-gray-500">Where everyone in your groups has been</span>
        </span>
        <span aria-hidden className="text-gray-400">›</span>
      </Link>
      <PassportBook name={account.name} stats={p.stats} milestones={p.milestones} pages={stampPages(p.stamps, p.been)} index={p.index} badges={p.badges} />

      {!empty && (
        <div className="mt-5">
          <ShareSheet image={`/passport/image?v=${version}`} fileName="loopin-passport.png" title="Share your passport" words={`My Loopin passport: ${[p.stats.countries ? `${p.stats.countries} ${p.stats.countries === 1 ? "country" : "countries"}` : "", p.stats.cities ? `${p.stats.cities} ${p.stats.cities === 1 ? "city" : "cities"}` : ""].filter(Boolean).join(", ") || "my first stamps"} and counting ✈️`} label="Share my passport" />
        </div>
      )}

      {p.unplaced.length > 0 && (
        <section className="mt-6 rounded-2xl border border-line px-4 py-3.5">
          <p className="text-sm font-semibold">Trips without a place yet</p>
          <p className="mt-0.5 text-xs text-gray-500">Add where they went to get their stamps.</p>
          <ul className="mt-2 space-y-1.5">
            {p.unplaced.slice(0, 8).map((t) => (
              <li key={t.groupId}>
                <Link href={`/groups/${t.groupId}/settings#where`} className="text-sm font-medium text-fg underline underline-offset-4">
                  {t.name}: add where
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Places from before Loopin */}
      <section id="been" className="mt-8 scroll-mt-4">
        <h2 className="font-display text-lg font-semibold tracking-tight">Places I’ve been</h2>
        <p className="mt-0.5 text-sm text-gray-500">Countries you’ve been to. Each gets a “Been there” stamp in your passport, and every trip you take with Loopin adds its own stamp too. City stamps come from your trips.</p>
        {sp.added && (
          <p role="status" className="mt-2 text-sm text-owed">
            {Number(sp.added) > 1 ? `${Number(sp.added)} countries added to your passport.` : Number(sp.added) === 1 ? "Added to your passport." : "Those were already in your passport."}
          </p>
        )}
        <CountryPicker added={hand.map((h) => h.c)} home={p.home} />
        {hand.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Countries you’ve been to">
            {hand.map((h) => (
              <li key={h.c}>
                <form action={removePlaceAction} className="flex items-center gap-1.5 rounded-full border border-line py-1 pl-3 pr-1 text-sm">
                  <input type="hidden" name="country" value={h.c} />
                  {countryOf(h.c)?.flag} {countryOf(h.c)?.name}
                  <button type="submit" aria-label={`Remove ${countryOf(h.c)?.name}`} className="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 active:bg-mist">
                    ✕
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Who can open it from a group */}
      <section id="who" className="mt-8 scroll-mt-4 border-t border-line pt-6">
        <h2 className="font-display text-lg font-semibold tracking-tight">Who can see it</h2>
        <p className="mt-0.5 text-sm text-gray-500">People you share a group with can open your passport from the group. Never your money, groups or email.</p>
        <form action={setPassportShareAction} className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-mist p-1" aria-label="Who can see my passport">
          {(
            [
              ["groups", "People in my groups"],
              ["private", "Only me"],
            ] as const
          ).map(([v, label]) => {
            const on = (account.passportShare || "groups") === v;
            return (
              <button key={v} type="submit" name="share" value={v} aria-pressed={on} className={`rounded-full px-2 py-2.5 text-sm ${on ? "bg-fg font-semibold text-canvas" : "text-gray-500"}`}>
                {label}
              </button>
            );
          })}
        </form>
        {sp.shared && (
          <p role="status" className="mt-2 text-sm text-owed">
            {sp.shared === "private" ? "Only you can see your passport now." : "People in your groups can see your passport."}
          </p>
        )}
      </section>

      <section className="mt-8 border-t border-line pt-6">
        <form action={setHomeCountryAction} className="flex items-end gap-2">
          <label className="block min-w-0 flex-1">
            <span className="mb-1 block text-sm font-semibold">Home country</span>
            <span className="mb-2 block text-xs text-gray-500">Trips here get city stamps; trips abroad get a country stamp.</span>
            <select name="country" defaultValue={p.home} aria-label="Home country" className={`${inputClass} min-w-0`}>
              <option value="">Not set</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="shrink-0 rounded-xl border border-line px-4 py-3 text-sm font-semibold">
            Save
          </button>
        </form>
        {home && <p className="mt-2 text-xs text-gray-400">Now: {home.flag} {home.name}{account.homeCountry ? "" : " (from where you use Loopin)"}</p>}
      </section>
    </>
  );
}
