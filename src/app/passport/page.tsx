import { headers } from "next/headers";
import { PeoplePassportsIcon } from "@/components/DrawnIcons";
import Link from "@/components/Link";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { visitorRegion } from "@/lib/region";
import { celebrateMarks, loadPassport } from "@/lib/passport-db";
import { COUNTRIES, countryOf } from "@/lib/geo";
import { parseHandPlaces, passportNeedsAnswer, passportShared, stampPages } from "@/lib/passport";
import { beenCards, shownCards } from "@/lib/passport-cards";
import { answerPassportQuestionAction, setHomeCountryAction, setPassportShareAction } from "@/app/passport-actions";
import { ErrorNote, PageHeader, primaryButtonClass } from "@/components/ui";
import { ShareSheet } from "@/components/ShareSheet";
import { Notice } from "@/components/Notice";
import { PassportBook } from "@/components/PassportBook";
import { CountryPicker } from "@/components/CountryPicker";
import { SelectField } from "@/components/SelectField";
import { PASSPORT_TABS, PassportArt, PassportTabs, passportTab } from "@/components/PassportTabs";
import { PassportStats } from "@/components/PassportStats";
import { BeenCardBig, BeenCardHand, BeenCardSmall, InkFilter } from "@/components/BeenCard";
import { InfoIcon, LockIcon, ShareIcon } from "@/components/PassportIcons";

export const metadata = { title: "Your trip passport", robots: { index: false } };

// Your passport. The Been tab is a card for every trip (a stamp on the place's photo), with the numbers on top
// and countries from before Loopin as small cards. The old booklet is one quiet link away (?book=1).

export default async function PassportPage({ searchParams }: { searchParams: Promise<{ error?: string; added?: string; shared?: string; sent?: string; tab?: string; book?: string; all?: string }> }) {
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
  const tab = passportTab(sp.tab);
  const shareWords = `My Loopin passport: ${[p.stats.countries ? `${p.stats.countries} ${p.stats.countries === 1 ? "country" : "countries"}` : "", p.stats.cities ? `${p.stats.cities} ${p.stats.cities === 1 ? "city" : "cities"}` : ""].filter(Boolean).join(", ") || "my first stamps"} and counting ✈️`;

  // The old booklet: cover, pages to swipe, map and badges.
  if (sp.book === "1")
    return (
      <>
        <PageHeader title="Passport book" back="/passport" />
        <PassportBook name={account.name} stats={p.stats} milestones={p.milestones} pages={stampPages(p.stamps, p.been)} index={p.index} badges={p.badges} />
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

  // A moment just reached (10 countries, a new continent): shown once here, and in Alerts.
  const moment = await celebrateMarks(account, p.marks);
  const { stats, cards } = beenCards({ trips: p.trips, stamps: p.stamps, been: p.been, stats: p.stats }, p.extras, today);
  const { shown, hidden } = shownCards(cards, sp.all === "1");
  const big = shown[0]?.kind === "trip" ? shown[0] : undefined;
  const rest = big ? shown.slice(1) : shown;

  return (
    <>
      <InkFilter />
      <PageHeader title="Your passport" back="/account" hideTitle />
      <div className="relative mb-5 min-h-[104px] pr-24">
        <PassportArt />
        <p aria-hidden className="font-display text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] min-[360px]:text-[34px]">
          Your passport
        </p>
        <p className="mt-1.5 text-[16px] leading-snug text-fg/75">{PASSPORT_TABS.length > 1 ? "Places behind you. Plans ahead." : "Places behind you."}</p>
      </div>
      <PassportTabs tab={tab} />

      {sp.error && <ErrorNote>{sp.error.slice(0, 120)}</ErrorNote>}
      {sp.sent && (
        <Notice params={["sent"]} className="mb-4">
          Sent to {Number(sp.sent) === 1 ? "1 person" : `${Number(sp.sent)} people`} in Loopin.
        </Notice>
      )}

      {passportNeedsAnswer(account) && (
        <section className="mb-4 rounded-[20px] border border-line bg-white px-5 py-4" aria-label="Show your places" data-passport-ask>
          <p className="font-display text-lg font-semibold leading-snug tracking-tight">Show your places to people in your groups?</p>
          <p className="mt-1 text-sm text-gray-500">Only people you share a group with can see it. You can change this any time.</p>
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

      {moment && (
        <section className="mb-4 rounded-[20px] border border-line bg-white px-5 py-4" role="status" data-passport-moment={moment.id}>
          <p className="font-display text-xl font-semibold tracking-tight">{moment.title}</p>
          <p className="mt-1 text-sm text-gray-500">{moment.body.replace(/ Open (it|your passport) to see.*$/, "")}</p>
        </section>
      )}

      {/* Been */}
      <PassportStats stats={stats} />

      <section id="been" className="scroll-mt-4" aria-labelledby="stamps-h">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="stamps-h" className="font-display text-[26px] font-semibold leading-tight tracking-tight">
            Your stamps
          </h2>
          <Link href="#who" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-[14px] text-fg/75" data-who-link>
            <LockIcon size={16} />
            {passportShared(account) ? "Your groups" : "Only you"}
          </Link>
        </div>
        {sp.added && (
          <p role="status" className="mb-3 text-sm text-owed">
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
            {big && <BeenCardBig c={big} />}
            {rest.map((c) => (c.kind === "hand" ? <BeenCardHand key={c.id} c={c} /> : <BeenCardSmall key={c.id} c={c} />))}
            {hidden > 0 && (
              <Link href="/passport?all=1#been" className="flex min-h-11 items-center justify-center text-[15px] font-semibold text-fg underline underline-offset-4" data-been-all>
                See all
              </Link>
            )}
          </div>
        )}

        <div className="mt-4">
          <CountryPicker added={hand.map((h) => h.c)} home={p.home} tile />
        </div>
        {!empty && (
          <div className="mt-3">
            <ShareSheet
              image={`/passport/image?v=${version}`}
              fileName="loopin-passport.png"
              title="Share your passport"
              words={shareWords}
              label={
                <>
                  <ShareIcon size={20} />
                  Share passport
                </>
              }
              className="pop flex w-full items-center justify-center gap-2.5 bg-fg px-5 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63]"
            />
          </div>
        )}
        <p className="mt-3 flex items-center justify-center gap-2 text-[14px] text-fg/75">
          <InfoIcon size={16} />
          <Link href="#who" className="inline-flex min-h-11 items-center underline underline-offset-4">
            Choose what you share.
          </Link>
        </p>
      </section>

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

      {/* Who can open it from a group */}
      <section id="who" className="mt-8 scroll-mt-4 border-t border-line pt-6">
        <h2 className="font-display text-lg font-semibold tracking-tight">Who can see it</h2>
        <p className="mt-0.5 text-sm text-gray-500">Hidden until you choose. If you say yes, people you share a group with can open your passport from the group. Never your money, groups or email.</p>
        <form action={setPassportShareAction} className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-mist p-1" aria-label="Who can see my passport">
          {(
            [
              ["groups", "People in my groups"],
              ["private", "Only me"],
            ] as const
          ).map(([v, label]) => {
            const on = (passportShared(account) ? "groups" : "private") === v;
            return (
              <button key={v} type="submit" name="share" value={v} aria-pressed={on} className={`rounded-full px-2 py-2.5 text-sm ${on ? "shadow-[inset_0_0_0_1.5px_var(--color-fg)] font-semibold text-fg" : "text-gray-500"}`}>
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
            <SelectField name="country" defaultValue={p.home} aria-label="Home country" className="min-w-0">
              <option value="">Not set</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name}
                </option>
              ))}
            </SelectField>
          </label>
          <button type="submit" className="shrink-0 rounded-xl border border-line px-4 py-3 text-sm font-semibold">
            Save
          </button>
        </form>
        {home && <p className="mt-2 text-xs text-gray-400">Now: {home.flag} {home.name}{account.homeCountry ? "" : " (from where you use Loopin)"}</p>}
      </section>

      <Link href="/passport/friends" className="mt-8 flex items-center gap-3 rounded-2xl border border-line px-4 py-3 active:bg-mist" data-friends-link>
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-fg/25 text-fg/75"><PeoplePassportsIcon size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Friends’ passports</span>
          <span className="block text-xs text-gray-500">Where friends in your groups have been</span>
        </span>
        <span aria-hidden className="text-gray-400">›</span>
      </Link>

      <p className="mb-10 mt-5 text-center">
        <Link href="/passport?book=1" className="inline-flex min-h-11 items-center text-[14px] text-fg/55 underline underline-offset-4" data-passport-book-link>
          Open the passport book
        </Link>
      </p>
    </>
  );
}
