import { headers } from "next/headers";
import Link from "@/components/Link";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { visitorRegion } from "@/lib/region";
import { celebrateMarks, loadPassport } from "@/lib/passport-db";
import { COUNTRIES, countryOf } from "@/lib/geo";
import { parseHandPlaces, passportCounts, passportNeedsAnswer, passportShared, stampPages } from "@/lib/passport";
import { withCountryPhotos } from "@/lib/country-photos";
import { beenCards, shownCards } from "@/lib/passport-cards";
import { answerPassportQuestionAction, setHomeCountryAction, setPassportShareAction } from "@/app/passport-actions";
import { ErrorNote, PageHeader, primaryButtonClass } from "@/components/ui";
import { ShareSheet } from "@/components/ShareSheet";
import { Notice } from "@/components/Notice";
import { PassportBook } from "@/components/PassportBook";
import { CountryPicker } from "@/components/CountryPicker";
import { SelectField } from "@/components/SelectField";
import { PassportArt, PassportTabs, passportTab } from "@/components/PassportTabs";
import { WantToGoTab } from "@/components/want/WantToGoTab";
import { PassportStats } from "@/components/PassportStats";
import { StampCard } from "@/components/BeenCard";
import { LockIcon, ShareIcon } from "@/components/PassportIcons";

export const metadata = { title: "Your trip passport", robots: { index: false } };

// Your passport (mockup 14). Been: the numbers on top, then one card for every trip and for every country added by hand (photo,
// name, dates, a tilted stamp, one outline button). Want to go: a private list of places. The booklet opens from the passport art
// (?book=1); the settings sit behind one "Passport settings" row at the bottom.

export default async function PassportPage({ searchParams }: { searchParams: Promise<{ error?: string; added?: string; shared?: string; sent?: string; tab?: string; book?: string; all?: string; open?: string; wished?: string; full?: string }> }) {
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
  const p = await loadPassport(account, region.country && countryOf(region.country) ? region.country : "", today, { withMoments: true });
  // Changes whenever the passport does, so a shared picture is never an old one.
  const counts = passportCounts(p, today);
  const version = `${counts.countries}-${counts.cities}-${counts.days}-${p.stamps.length}-${p.been.length}-${(account.name || "").length}`;
  const home = countryOf(p.home);
  const hand = parseHandPlaces(account.places);
  const empty = p.stamps.length + p.been.length === 0;
  const tab = passportTab(sp.tab);
  const shareWords = `My Loopin passport: ${[counts.countries ? `${counts.countries} ${counts.countries === 1 ? "country" : "countries"}` : "", counts.cities ? `${counts.cities} ${counts.cities === 1 ? "city" : "cities"}` : ""].filter(Boolean).join(", ") || "my first stamps"} and counting`;

  // The old booklet: cover, pages to swipe, map and badges.
  if (sp.book === "1")
    return (
      <>
        <PageHeader title="Passport book" back="/passport" />
        <PassportBook name={account.name} stats={p.stats} counts={counts} milestones={p.milestones} pages={stampPages(p.stamps, p.been)} index={withCountryPhotos(p.index)} badges={p.badges} />
        {!empty && (
          <div className="mb-10 mt-5 scroll-mb-28" data-passport-actions>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/passport/send" className="flex h-12 items-center justify-center rounded-full border border-fg/25 text-[15px] font-semibold active:bg-fg/10" data-passport-send>
                Send in Loopin
              </Link>
              <ShareSheet image={`/passport/image?v=${version}`} fileName="loopin-passport.png" title="Share your passport" words={shareWords} label="Share" />
            </div>
          </div>
        )}
      </>
    );

  // A moment just reached (10 countries, a new continent): shown once here, and in Alerts. (Only on Been.)
  const moment = tab === "been" ? await celebrateMarks(account, p.marks) : null;
  const { stats, cards } = beenCards({ trips: p.trips, stamps: p.stamps, been: p.been, stats: p.stats }, p.extras, today);
  const { shown, hidden } = shownCards(cards, sp.all === "1");
  const continents = p.stats.continents;

  return (
    <>
      <PageHeader title="Your passport" back="/account" hideTitle />
      <div className="relative mb-5 min-h-[76px] pr-[78px] min-[360px]:min-h-[104px] min-[360px]:pr-28">
        <PassportArt />
        <p aria-hidden className="whitespace-nowrap font-display text-[30px] font-semibold leading-[1.1] tracking-[-0.02em]">
          Your passport
        </p>
        <p className="mt-1.5 text-[16px] leading-snug text-fg/75">A personal travel log of your trips and places.</p>
      </div>
      <PassportTabs tab={tab} />

      {sp.error && <ErrorNote>{sp.error.slice(0, 120)}</ErrorNote>}
      {sp.sent && (
        <Notice params={["sent"]} className="mb-4">
          Sent to {Number(sp.sent) === 1 ? "1 person" : `${Number(sp.sent)} people`} in Loopin.
        </Notice>
      )}

      {tab === "want" ? (
        <>
          <WantToGoTab accountId={account.id} wished={sp.wished} full={sp.full === "1"} />
          <div className="mb-10" />
        </>
      ) : (
        <>
          <PassportStats stats={stats} />

          {moment && !moment.id.startsWith("trips-") && ( /* the "5 trips with Loopin" badge repeats the numbers above: kept in Alerts only */
            <p className="-mt-3 mb-5 text-center text-[14px] text-fg/75" role="status" data-passport-moment={moment.id}>
              {moment.title}
            </p>
          )}

          <section id="been" className="scroll-mt-4" aria-labelledby="stamps-h">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="stamps-h" className="font-display text-[26px] font-semibold leading-tight tracking-tight">
                Your stamps
              </h2>
              <Link href="/passport?open=who#who" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-[14px] text-fg/75" data-who-link>
                <LockIcon size={16} />
                {passportShared(account) ? "Your groups" : "Only you"}
              </Link>
            </div>
            {sp.added && (
              <p role="status" className="mb-3 text-sm text-fg/75">
                {Number(sp.added) > 1 ? `${Number(sp.added)} countries added to your passport.` : Number(sp.added) === 1 ? "Added to your passport." : "Those were already in your passport."}
              </p>
            )}

            {empty ? (
              <div className="rounded-[20px] border border-line bg-white px-5 py-5">
                <p className="font-display text-xl font-semibold tracking-tight">Your first stamp is waiting</p>
                <p className="mt-1 text-sm text-fg/75">A trip with a place gets its stamp here. Or add somewhere you’ve already been.</p>
              </div>
            ) : (
              <div className="space-y-3" data-been-cards>
                {shown.map((c) => (
                  <StampCard key={c.id} c={c} />
                ))}
                {hidden > 0 && (
                  <Link href="/passport?all=1#been" className="flex min-h-11 items-center justify-center text-[15px] font-semibold text-fg underline underline-offset-4" data-been-all>
                    See all
                  </Link>
                )}
              </div>
            )}

            {/* Two outline buttons side by side, as in the mockup. */}
            <div className={`mt-4 grid gap-3 ${empty ? "grid-cols-1" : "grid-cols-2"}`}>
              <CountryPicker added={hand.map((h) => h.c)} home={p.home} tile />
              {!empty && (
                <ShareSheet
                  image={`/passport/image?v=${version}`}
                  fileName="loopin-passport.png"
                  title="Share your passport"
                  words={shareWords}
                  label={
                    <>
                      <ShareIcon size={20} />
                      Share
                    </>
                  }
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-fg/25 px-3 text-center text-[15px] text-fg active:scale-[0.97] active:bg-fg/10"
                />
              )}
            </div>
          </section>

          {passportNeedsAnswer(account) && (
            <section className="mt-6 rounded-[20px] border border-line bg-white px-5 py-4" aria-label="Show your places" data-passport-ask>
              <p className="font-display text-lg font-semibold leading-snug tracking-tight">Show your places to people in your groups?</p>
              <p className="mt-1 text-sm text-fg/65">Only people you share a group with can see it. You can change this any time.</p>
              <form action={answerPassportQuestionAction} className="mt-3 grid grid-cols-2 gap-2">
                <button type="submit" name="answer" value="show" className="pop flex h-11 items-center justify-center bg-fg text-[15px] font-semibold text-canvas">
                  Show
                </button>
                <button type="submit" name="answer" value="not-now" className="flex h-11 items-center justify-center rounded-full border border-line text-[15px] font-semibold active:bg-mist">
                  Not now
                </button>
              </form>
            </section>
          )}

          {continents >= 2 && (
            <p className="mt-4 text-center text-[14px] text-fg/65" data-passport-continents={continents}>
              Your places span {continents} continents.
            </p>
          )}

          {p.unplaced.length > 0 && (
            <section className="mt-6 rounded-2xl border border-line px-4 py-3.5">
              <p className="text-sm font-semibold">Trips without a place yet</p>
              <p className="mt-0.5 text-xs text-gray-500">Add where they went to get their stamps.</p>
              <ul className="mt-2 space-y-1.5">
                {p.unplaced.slice(0, 8).map((t) => (
                  <li key={t.groupId}>
                    <Link href={`/groups/${t.groupId}/settings#where`} className="inline-flex min-h-11 items-center text-sm font-medium text-fg underline underline-offset-4">
                      {t.name}: add where
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Settings: one row; it opens to today's rows (a title, one line of what it is now, and a chevron each). */}
          <details id="settings" className="group mt-8 scroll-mt-4 overflow-hidden rounded-[20px] border border-line" open={sp.open === "who" || sp.open === "settings" || Boolean(sp.shared)} data-passport-rows>
            <summary className={rowSummary}>
              <span className="min-w-0 flex-1 text-[16px] font-semibold">Passport settings</span>
              <Chevron />
            </summary>
            <div className="divide-y divide-line border-t border-line">
              <details id="who" className="group scroll-mt-4" open={sp.open === "who" || Boolean(sp.shared)} data-row="who">
                <summary className={rowSummary}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold">Who can see it</span>
                    <span className="block truncate text-[14px] text-fg/65">{passportShared(account) ? "People in my groups" : "Only me"}</span>
                  </span>
                  <Chevron />
                </summary>
                <div className="px-4 pb-4">
                  <p className="text-sm text-fg/65">Hidden until you choose. If you say yes, people you share a group with can open your passport from the group. Never your money, groups or email.</p>
                  <form action={setPassportShareAction} className="mt-3 grid grid-cols-[1.35fr_1fr] gap-1 rounded-full bg-mist p-1" aria-label="Who can see my passport">
                    {(
                      [
                        ["groups", "People in my groups"],
                        ["private", "Only me"],
                      ] as const
                    ).map(([v, label]) => {
                      const on = (passportShared(account) ? "groups" : "private") === v;
                      return (
                        <button key={v} type="submit" name="share" value={v} aria-pressed={on} className={`min-h-11 whitespace-nowrap rounded-full px-2 text-[13px] min-[360px]:text-sm ${on ? "shadow-[inset_0_0_0_1.5px_var(--color-fg)] font-semibold text-fg" : "text-fg/65"}`}>
                          {label}
                        </button>
                      );
                    })}
                  </form>
                  {sp.shared && (
                    <p role="status" className="mt-2 text-sm text-fg/75">
                      {sp.shared === "private" ? "Only you can see your passport now." : "People in your groups can see your passport."}
                    </p>
                  )}
                </div>
              </details>

              <details className="group" data-row="home">
                <summary className={rowSummary}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold">Home country</span>
                    <span className="block truncate text-[14px] text-fg/65">{home ? home.name : "Not set"}</span>
                  </span>
                  <Chevron />
                </summary>
                <form action={setHomeCountryAction} className="flex items-end gap-2 px-4 pb-4">
                  <label className="block min-w-0 flex-1">
                    <span className="mb-2 block text-xs text-fg/65">Trips here get city stamps; trips abroad get a country stamp.</span>
                    <SelectField name="country" defaultValue={p.home} aria-label="Home country" className="min-w-0">
                      <option value="">Not set</option>
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </SelectField>
                  </label>
                  <button type="submit" className="min-h-11 shrink-0 rounded-xl border border-line px-4 py-3 text-sm font-semibold">
                    Save
                  </button>
                </form>
              </details>

              <Link href="/passport/friends" className={rowSummary} data-friends-link>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold">Friends’ passports</span>
                  <span className="block truncate text-[14px] text-fg/65">Where friends in your groups have been</span>
                </span>
                <Chevron />
              </Link>
            </div>
          </details>
          <div className="mb-10" />
        </>
      )}
    </>
  );
}

const rowSummary = "flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2.5 active:bg-mist [&::-webkit-details-marker]:hidden";
function Chevron() {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg/55 transition-transform group-open:rotate-90">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
