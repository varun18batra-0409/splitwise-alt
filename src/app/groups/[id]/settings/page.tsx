import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { getAccount, getMyMemberId } from "@/lib/identity";
import { regionFor } from "@/lib/region";
import { convertGroupCurrency, deleteGroup, saveGroupSettings, setGroupClosed } from "@/app/actions";
import { NOTIFY_KINDS, parseNotify } from "@/lib/notify-prefs";
import { groupTypesFor, sharingInputs } from "@/lib/group-types";
import { StaysGoes } from "@/components/StaysGoes";
import { deleteText } from "@/lib/leave-text";
import { ConfirmButton } from "@/components/ConfirmButton";
import { currencyInfo, formatMoney, formatPercent, isSupportedCurrency, toInputAmount } from "@/lib/money";
import { getRate } from "@/lib/rate-cache";
import { niceDate } from "@/lib/format";
import Link from "@/components/Link";
import { CurrencySelect } from "@/components/CurrencySelect";
import { ChipRadios, GroupTypeChips, SecondCurrencyChips } from "@/components/SettingsControls";
import { settingsSnapshot } from "@/lib/settings-save";
import { PhoneStatus } from "@/components/PushControls";
import { currencyLine } from "@/lib/currency-line";
import { pickAdmin } from "@/lib/group-admin";
import { CoverPicker } from "@/components/CoverPicker";
import { TripDates } from "@/components/TripDates";
import { WhereTo } from "@/components/WhereTo";
import { coverFor, coverOf } from "@/lib/covers";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";

const PRESETS = [0, 200, 300, 400];
const sectionTitle = "text-sm font-semibold text-gray-500";

const ERRORS: Record<string, string> = {
  markup: "Enter a markup between 0% and 20%, like 3.5.",
  currency: "Pick a currency from the list.",
  name: "Give the group a name.",
  admin: "Only the person who started the group can do that.",
};

// Group settings: name, currency (converting existing amounts if needed),
// foreign card markup, and close / reopen. Every change notifies the group.
export default async function GroupSettings({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; convert?: string }>;
}) {
  const { id } = await params;
  const { error, convert } = await searchParams;
  const group = await db.group.findUnique({
    where: { id },
    include: {
      members: { select: { id: true, name: true, leftAt: true, splitWeight: true, claimedAt: true, addedBy: true, seenAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      expenses: { where: { deletedAt: null }, select: { amount: true } },
      _count: { select: { expenses: true, payments: true } },
    },
  });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  // Someone who left can still read the group, but not change it.
  if (group.members.find((m) => m.id === myId)?.leftAt) redirect(`/groups/${group.id}/people?error=${encodeURIComponent("You left this group. Rejoin it to change its settings.")}`);

  const india = regionFor(await headers(), (await getAccount())?.homeCountry).india; // Teen Patti is named only for people in India
  const isPreset = PRESETS.includes(group.cardMarkupBp);
  // Deleting the group and changing its currency are for the person who started it.
  const admin = pickAdmin(group.members);
  const isAdmin = admin?.id === myId;
  const adminNote = `Only ${admin?.name ?? "the person who started the group"}, who looks after this group, can change this.`;
  const active = group.members.filter((m) => !m.leftAt);
  const myNotifyJson = (await db.member.findUnique({ where: { id: myId }, select: { notify: true } }))?.notify;
  const prefs = parseNotify(myNotifyJson);

  // Step 2 of changing the currency: confirm the conversion rate.
  if (convert && isSupportedCurrency(convert) && convert !== group.currency) {
    const live = await getRate(group.currency, convert);
    const total = group.expenses.reduce((s, e) => s + e.amount, 0);
    const to = currencyInfo(convert);
    return (
      <>
        <PageHeader title="Change group currency" back={`/groups/${group.id}/settings`} />
        {error && <ErrorNote>{error}</ErrorNote>}
        <p className="mb-6 text-gray-600">
          Switching from <strong>{group.currency}</strong> to{" "}
          <strong>
            {to.flag} {convert}
          </strong>
          . Every amount in the group ({group._count.expenses ? `${group._count.expenses} expense${group._count.expenses === 1 ? "" : "s"}, ` : ""}
          {group._count.payments ? `${group._count.payments} payment${group._count.payments === 1 ? "" : "s"}, ` : ""}bills, budgets, goals, the deposit and card
          games) will be converted at the rate below. Original receipt amounts stay as they were, and everyone is notified.
        </p>
        <form action={convertGroupCurrency} className="space-y-6">
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="currency" value={convert} />
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-600">Conversion rate</span>
            <span className="flex items-center gap-2">
              <span className="shrink-0 text-gray-600">1 {group.currency} =</span>
              <input
                name="rate"
                required
                inputMode="decimal"
                defaultValue={live.ok ? live.rate : ""}
                placeholder="rate"
                className={inputClass}
              />
              <span className="shrink-0 text-gray-600">{convert}</span>
            </span>
            <span className="mt-2 block text-sm text-gray-500">
              {live.ok ? `Live rate for ${niceDate(live.date)}. You can change it.` : live.message}
            </span>
          </label>
          {total > 0 && (
            <p className="rounded-xl bg-mist px-4 py-3 text-sm text-gray-600">
              Current group total: {formatMoney(total, group.currency)}
            </p>
          )}
          <button type="submit" className={primaryButtonClass}>
            Convert to {convert}
          </button>
          <Link href={`/groups/${group.id}/settings`} className={`block ${secondaryButtonClass}`}>
            Cancel
          </Link>
        </form>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Group settings" back={`/groups/${group.id}`} />
      {error && <ErrorNote>{ERRORS[error] ?? error.slice(0, 200)}</ErrorNote>}

      <form action={saveGroupSettings} className="space-y-10" data-settings-form>
        <input type="hidden" name="groupId" value={group.id} />
        {/* What this page shows now: Save only changes what you changed, and never undoes what someone else changed meanwhile. */}
        <input type="hidden" name="was" value={JSON.stringify(settingsSnapshot(group, group.members, myNotifyJson))} />
        <section className="space-y-8">
        <h2 className={`!mb-3 ${sectionTitle}`}>Basics</h2>

        <label className="block">
          <span className="mb-2 block text-base font-semibold">Group name</span>
          <input name="name" required defaultValue={group.name} maxLength={60} autoComplete="off" className={inputClass} />
        </label>

        {group.type === "trip" && <TripDates name={group.name} start={group.tripStart} end={group.tripEnd} titleClass="text-base font-semibold" />}

        {/* Where to: for everyone's trip passport (a stamp for each place). */}
        {group.type === "trip" && <WhereTo name={group.name} place={group.tripPlace} country={group.tripCountry} />}

        <CoverPicker defaultValue={coverOf(group)} letter={group.name} uid={group.id} legendClassName="mb-1 text-base font-semibold" own={{ groupId: group.id, src: coverFor(group).src }} />

        <fieldset>
          <legend className="mb-1 text-base font-semibold">Group currency</legend>
          <p className="mb-4 text-sm text-gray-500">
            {currencyLine(group.currency)}
            {group._count.expenses + group._count.payments > 0 && " Changing it converts existing amounts (you’ll confirm the rate)."}
          </p>
          {isAdmin ? (
            <CurrencySelect name="currency" defaultValue={group.currency} label="Group currency" />
          ) : (
            <>
              <input type="hidden" name="currency" value={group.currency} />
              <p className="rounded-xl bg-mist px-4 py-3 text-sm" data-admin-only="currency">
                <strong>{group.currency}</strong> · {adminNote}
              </p>
            </>
          )}
        </fieldset>

        <div>
          <span className="mb-1 block text-base font-semibold">Also show amounts in</span>
          <span className="mb-4 block text-sm text-gray-500">
            Shown as ≈ next to balances, at today’s rate. Automatic picks your most-used foreign currency.
          </span>
          <SecondCurrencyChips groupCurrency={group.currency} defaultValue={group.secondaryCurrency} />
        </div>
        </section>

        <section className="space-y-8">
        <h2 className={`!mb-3 ${sectionTitle}`}>Card fees abroad</h2>
        <fieldset>
          <legend className="mb-1 text-base font-semibold">Card markup</legend>
          <p className="mb-4 text-sm text-gray-500">
            Your bank’s fee on foreign card payments (an estimate). Only added to card payments in another currency.
          </p>
          <div className="grid grid-cols-4 gap-2">
            {PRESETS.map((bp) => (
              <label
                key={bp}
                className="flex items-center justify-center rounded-xl border border-gray-200 py-3 text-sm font-medium has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-dark"
              >
                <input type="radio" name="markup" value={String(bp)} defaultChecked={bp === group.cardMarkupBp} className="sr-only" />
                {formatPercent(bp)}
              </label>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
            <input type="radio" name="markup" value="custom" defaultChecked={!isPreset} className="h-5 w-5 accent-[var(--color-accent)]" />
            <span className="text-sm font-medium">Custom</span>
            <span className="ml-auto flex items-center gap-1">
              <input
                name="customMarkup"
                inputMode="decimal"
                placeholder="3.5"
                defaultValue={isPreset ? "" : String(group.cardMarkupBp / 100)}
                aria-label="Custom markup percentage"
                className="w-20 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-right outline-none focus:border-accent"
              />
              %
            </span>
          </label>
        </fieldset>
        </section>


        {/* How you share costs: the group type and each person's part */}
        <section id="sharing" className="space-y-5">
          <h2 className={`!mb-3 ${sectionTitle}`}>How you share costs</h2>
          <div>
            <span className="mb-2 block text-base font-semibold">Group type</span>
            <GroupTypeChips types={groupTypesFor(india)} defaultValue={group.type} />
          </div>
          <fieldset>
            <legend className="mb-1 text-base font-semibold">{group.type === "couple" ? "Each person’s %" : "Shares"}</legend>
            <p className="mb-3 text-sm text-gray-500">
              {group.type === "couple"
                ? "Your split for every expense, e.g. 55 and 45."
                : "Everyone pays 1 share unless you change it, e.g. 1.5 for a bigger room."}
            </p>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {active.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate">{m.id === myId ? `${m.name} (you)` : m.name}</span>
                  <input
                    name={`w_${m.id}`}
                    inputMode="decimal"
                    aria-label={`${m.name}’s ${group.type === "couple" ? "percent" : "shares"}`}
                    defaultValue={sharingInputs(group.type, active.map((x) => x.splitWeight))[active.indexOf(m)]}
                    className="w-20 rounded-lg border border-line bg-mist px-2 py-1.5 text-right text-fg outline-none focus:border-accent"
                  />
                </li>
              ))}
            </ul>
          </fieldset>
        </section>

        {/* Reminders (flats) and settle-up rules (homes and couples) */}
        {(group.type === "home" || group.type === "couple") && (
          <section id="settling" className="space-y-4">
            <h2 className={`!mb-3 ${sectionTitle}`}>Reminders and settling up</h2>
            {group.type === "home" && (
              <label className="flex items-start gap-3 rounded-2xl border border-line px-4 py-3">
                <span className="flex-1">
                  <span className="block font-medium">Reminders</span>
                  <span className="block text-sm text-gray-500">A nudge the day before a bill is due, a Monday note to whoever owes, and the payments on settle-up day.</span>
                </span>
                <input type="checkbox" name="reminders" defaultChecked={group.reminders} className="mt-1 h-5 w-5 accent-[var(--color-accent)]" />
              </label>
            )}
            <div>
              <span className="mb-2 block text-base font-semibold">Settle-up day</span>
              <ChipRadios
                name="settleDay"
                label="Settle-up day"
                defaultValue={String(group.settleDay)}
                cols="grid-cols-3 min-[400px]:grid-cols-4"
                options={[
                  { value: "0", label: "None" },
                  ...[1, 5, 10, 15, 20, 25].map((d) => ({ value: String(d), label: `${d === 1 ? "1st" : `${d}th`}` })),
                  { value: "31", label: "Last day" },
                ]}
              />
              <span className="mt-1.5 block text-xs text-gray-500">The day of the month Loopin nudges everyone to settle up.</span>
            </div>
            <label className="block">
              <span className="mb-2 block text-base font-semibold">Leave out payments under</span>
              <input name="settleMin" inputMode="decimal" defaultValue={group.settleMin ? toInputAmount(group.settleMin, group.currency) : ""} placeholder="0 (show every payment)" className={inputClass} />
              <span className="mt-1 block text-sm text-gray-500">Small amounts stay in the balances; they’re just not suggested as payments.</span>
            </label>
          </section>
        )}

        {/* Phone notifications for this group, just for me */}
        <section id="notify" className="space-y-3">
          <h2 className={`!mb-3 ${sectionTitle}`}>Phone notifications for this group</h2>
          <PhoneStatus compact />
          <input type="hidden" name="notifyForm" value="1" />
          <ul className="divide-y divide-line rounded-2xl border border-line">
            <li>
              <label className="flex items-center gap-3 px-4 py-3">
                <span className="flex-1 font-medium">All notifications</span>
                <input type="checkbox" name="all" defaultChecked={!prefs.off} className="h-5 w-5 accent-[var(--color-accent)]" />
              </label>
            </li>
            {NOTIFY_KINDS.map((k) => (
              <li key={k.id}>
                <label className="flex items-center gap-3 px-4 py-3">
                  <span className="flex-1">{k.label}</span>
                  <input type="checkbox" name={k.id} defaultChecked={prefs[k.id]} className="h-5 w-5 accent-[var(--color-accent)]" />
                </label>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-400">Only for you. This phone’s permission is above.</p>
        </section>

        {/* The one Save for everything above */}
        <div className="sticky bottom-[calc(6rem+env(safe-area-inset-bottom))] z-10">
          <button type="submit" className={primaryButtonClass}>
            Save settings
          </button>
        </div>
      </form>

      {/* People & data: one list of links */}
      <h2 className={`mt-12 ${sectionTitle}`}>People &amp; data</h2>
      <ul className="mt-6 divide-y divide-line rounded-2xl border border-line">
        <SettingsLink href={`/groups/${group.id}/people`} label="Manage people" hint={`${group.members.filter((m) => !m.leftAt).length === 1 ? "1 person" : `${group.members.filter((m) => !m.leftAt).length} people`} · rename, remove, leave`} />
        <SettingsLink href={`/groups/${group.id}/invite`} label="Add people" hint="Loopin users, contacts or email" />
        <SettingsLink href={`/postcards/new?group=${group.id}`} label="Send a postcard" hint="A warm note to people in this group" />
        <SettingsLink href={`/groups/${group.id}/export`} label="Download spreadsheet" hint="Every expense and payment, as CSV" download />
      </ul>

      {/* Close / reopen */}
      <h2 className={`mt-12 ${sectionTitle}`}>Finish</h2>
      <section id="close" className="mt-6 scroll-mt-6">
        <h3 className="mb-1 text-base font-semibold">{group.closed ? "This group is closed" : "Close this group"}</h3>
        <p className="mb-4 text-sm text-gray-500">
          {group.closed ? "New expenses are paused. History is kept." : "Trip over? Close it. History is kept and you can reopen it any time."}
        </p>
        <form action={setGroupClosed}>
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="closed" value={group.closed ? "0" : "1"} />
          <button type="submit" className={secondaryButtonClass}>
            {group.closed ? "Reopen group" : "Close group"}
          </button>
        </form>
      </section>

      {/* Delete (restorable for 30 days) */}
      <section className="mt-8">
        <h3 className="mb-1 text-base font-semibold">Delete this group</h3>
        <p className="mb-4 text-sm text-gray-500">For everyone. Whoever deleted it, or looks after it, can restore it for 30 days.</p>
        {!isAdmin ? (
          <p className="rounded-xl bg-mist px-4 py-3 text-sm text-gray-600" data-admin-only="delete">
            Only {admin?.name ?? "the person who started the group"}, who started it, can delete this group.
          </p>
        ) : (
        <form action={deleteGroup}>
          <input type="hidden" name="groupId" value={group.id} />
          <StaysGoes text={deleteText()} label="What stays, what goes" />
          <ConfirmButton
            message={`Delete “${group.name}” for everyone? It can be restored for 30 days.`}
            className="w-full rounded-full border border-red-500/40 px-5 py-3.5 text-center text-base font-medium text-red-400 active:bg-red-500/10"
          >
            Delete group
          </ConfirmButton>
        </form>
        )}
      </section>
    </>
  );
}

function SettingsLink({ href, label, hint, download }: { href: string; label: string; hint: string; download?: boolean }) {
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        <span className="block truncate text-xs text-gray-400">{hint}</span>
      </span>
      <span className="text-gray-400" aria-hidden>
        ›
      </span>
    </>
  );
  const cls = "flex items-center gap-3 px-4 py-3.5 active:bg-mist";
  return (
    <li>
      {download ? (
        <a href={href} download className={cls}>
          {inner}
        </a>
      ) : (
        <Link href={href} className={cls}>
          {inner}
        </Link>
      )}
    </li>
  );
}
