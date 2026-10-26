import { headers } from "next/headers";
import Link from "@/components/Link";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { visitorRegion } from "@/lib/region";
import { loadPassport } from "@/lib/passport-db";
import { COUNTRIES, countryOf } from "@/lib/geo";
import { parseHandPlaces } from "@/lib/passport";
import { addPlaceAction, removePlaceAction, setHomeCountryAction } from "@/app/passport-actions";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass } from "@/components/ui";
import { ShareSheet } from "@/components/ShareSheet";

export const metadata = { title: "Your trip passport", robots: { index: false } };

// Your trip passport: a stamp for every place your trips went. Cities at home,
// countries abroad; places from before Loopin added by hand look lighter.

const INKS = ["#2b4c7e", "#a53a3a", "#2f7d4f", "#6a3d8f", "#8a5a2b", "#1f6f78"];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const month = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : "");

function CityStamp({ city, when, trips, byHand }: { city: string; when: string; trips: number; byHand: boolean }) {
  const h = hash(city);
  const ink = INKS[h % INKS.length];
  return (
    <li
      className={`flex min-w-[118px] flex-col items-center rounded-[10px] border-[2.5px] px-3 py-2 text-center ${byHand ? "border-dashed opacity-55" : ""}`}
      style={{ borderColor: ink, color: ink, transform: `rotate(${(h % 9) - 4}deg)` }}
      data-stamp={city}
      data-by-hand={byHand ? "1" : "0"}
    >
      <span className="font-display text-[17px] font-bold leading-tight tracking-wide">{city}</span>
      <span className="mt-0.5 text-[10px] font-semibold tracking-[0.12em]">{byHand ? "BEEN THERE" : `${month(when).toUpperCase()}${trips > 1 ? ` · ×${trips}` : ""}`}</span>
    </li>
  );
}

export default async function PassportPage({ searchParams }: { searchParams: Promise<{ error?: string; added?: string }> }) {
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
  const home = countryOf(p.home);
  const hand = parseHandPlaces(account.places);
  const empty = p.countries.length === 0;

  return (
    <>
      <PageHeader title="Trip passport" back="/account" />
      {sp.error && <ErrorNote>{sp.error.slice(0, 120)}</ErrorNote>}

      {/* The cover */}
      <section aria-label="Your passport" className="relative overflow-hidden rounded-[22px] bg-[#1d2a44] px-5 pb-5 pt-6 text-[#e9dfc4] shadow-[0_24px_40px_-24px_rgba(0,0,0,0.9)]">
        <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 text-[120px] opacity-[0.08]">🧭</span>
        <p className="font-display text-[13px] font-semibold tracking-[0.3em] text-[#e9dfc4]/70">LOOPIN · PASSPORT</p>
        <p className="mt-3 font-display text-[30px] font-semibold leading-none">{account.name || "You"}</p>
        <p className="mt-3 text-sm tabular-nums text-[#e9dfc4]/80" data-passport-stats={`${p.stats.cities}|${p.stats.countries}`}>
          {p.stats.cities} {p.stats.cities === 1 ? "city" : "cities"} · {p.stats.countries} {p.stats.countries === 1 ? "country" : "countries"} · {p.stats.thisYear} this year
        </p>
        {p.milestones.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {p.milestones.map((m) => (
              <li key={m} className="rounded-full border border-[#e9dfc4]/30 px-2.5 py-1 text-xs font-semibold">
                {m}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!empty && (
        <div className="mt-4">
          <ShareSheet image="/passport/image" fileName="loopin-passport.png" title="Share your passport" words={`${p.stats.cities} cities, ${p.stats.countries} countries and counting ✈️`} label="Share my passport" />
        </div>
      )}

      {/* The stamps, on passport paper. */}
      <section aria-label="Stamps" className="mt-6 rounded-[18px] bg-[#efe9da] px-4 py-5 text-[#26231d] [background-image:repeating-linear-gradient(0deg,transparent_0_23px,rgba(38,35,29,0.05)_23px_24px)]">
        {empty ? (
          <p className="py-8 text-center font-hand text-[22px] font-bold text-[#5c564a]">No stamps yet. Your next trip earns the first one ✈️</p>
        ) : (
          <div className="space-y-6">
            {p.countries.map((c) => {
              const ink = INKS[hash(c.code) % INKS.length];
              return (
                <div key={c.code} data-country={c.code}>
                  {!c.home && (
                    // A country abroad: the big round stamp.
                    <div
                      className={`mx-auto mb-3 flex h-[132px] w-[132px] flex-col items-center justify-center rounded-full border-[3px] text-center ${c.byHand ? "border-dashed opacity-55" : ""}`}
                      style={{ borderColor: ink, color: ink, transform: `rotate(${(hash(c.code) % 13) - 6}deg)`, boxShadow: `inset 0 0 0 5px #efe9da, inset 0 0 0 7px ${ink}` }}
                      data-country-stamp={c.code}
                    >
                      <span className="text-[34px] leading-none">{c.flag}</span>
                      <span className="mt-1 max-w-[100px] font-display text-[15px] font-bold leading-tight">{c.name}</span>
                      <span className="mt-0.5 text-[10px] font-semibold tracking-[0.12em]">{c.byHand ? "BEEN THERE" : `${month(c.first).toUpperCase()}${c.trips > 1 ? ` · ×${c.trips}` : ""}`}</span>
                    </div>
                  )}
                  {c.home && <p className="mb-2 text-sm font-semibold text-[#5c564a]">{c.flag} Around {c.name}</p>}
                  {c.cities.length > 0 && (
                    <ul className="flex flex-wrap justify-center gap-3">
                      {c.cities.map((city) => (
                        <CityStamp key={city.city} city={city.city} when={city.first} trips={city.trips} byHand={city.byHand} />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

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
        <p className="mt-0.5 text-sm text-gray-500">From before Loopin. They show lighter than stamps from real Loopin trips.</p>
        {sp.added && (
          <p role="status" className="mt-2 text-sm text-owed">
            Added to your passport.
          </p>
        )}
        <form action={addPlaceAction} className="mt-3 flex flex-wrap gap-2" aria-label="Add a place">
          <select name="country" required defaultValue="" aria-label="Country" className={`${inputClass} min-w-0 flex-1`}>
            <option value="" disabled>
              Country…
            </option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </select>
          <input name="city" maxLength={30} placeholder="City (optional)" aria-label="City" autoComplete="off" className={`${inputClass} w-40`} />
          <button type="submit" className="rounded-xl bg-fg px-4 py-3 text-sm font-semibold text-canvas">
            Add
          </button>
        </form>
        {hand.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {hand.map((h) => (
              <li key={`${h.c}-${h.city ?? ""}`}>
                <form action={removePlaceAction} className="flex items-center gap-1.5 rounded-full border border-line py-1 pl-3 pr-1 text-sm">
                  <input type="hidden" name="country" value={h.c} />
                  <input type="hidden" name="city" value={h.city ?? ""} />
                  {countryOf(h.c)?.flag} {h.city ? `${h.city}, ` : ""}
                  {countryOf(h.c)?.name}
                  <button type="submit" aria-label={`Remove ${h.city ?? countryOf(h.c)?.name}`} className="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 active:bg-mist">
                    ✕
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 border-t border-line pt-6">
        <form action={setHomeCountryAction} className="flex items-end gap-2">
          <label className="block min-w-0 flex-1">
            <span className="mb-1 block text-sm font-semibold">Home country</span>
            <span className="mb-2 block text-xs text-gray-500">Trips here get city stamps; trips abroad get a country stamp.</span>
            <select name="country" defaultValue={p.home} aria-label="Home country" className={inputClass}>
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
