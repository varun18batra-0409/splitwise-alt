import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { convertGroupCurrency, deleteGroup, setGroupClosed, updateGroupSettings } from "@/app/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CURRENCIES, currencyInfo, formatMoney, formatPercent, isSupportedCurrency, POPULAR_CURRENCIES } from "@/lib/money";
import { getRate } from "@/lib/rate-cache";
import { niceDate } from "@/lib/format";
import Link from "@/components/Link";
import { CurrencySelect } from "@/components/CurrencySelect";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";

const PRESETS = [0, 200, 300, 400];
const sectionTitle = "text-sm font-semibold text-gray-500";

const ERRORS: Record<string, string> = {
  markup: "Enter a markup between 0% and 20%, like 3.5.",
  currency: "Pick a currency from the list.",
  name: "Give the group a name.",
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
      members: { select: { id: true, name: true, leftAt: true } },
      expenses: { where: { deletedAt: null }, select: { amount: true } },
      _count: { select: { expenses: true, payments: true } },
    },
  });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");

  const isPreset = PRESETS.includes(group.cardMarkupBp);

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
          . All {group._count.expenses} expenses, every share and {group._count.payments} payments will be converted at the
          rate below. Original receipt amounts stay as they were, and everyone is notified.
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
      {error && ERRORS[error] && <ErrorNote>{ERRORS[error]}</ErrorNote>}

      <form action={updateGroupSettings} className="space-y-10">
        <input type="hidden" name="groupId" value={group.id} />
        <section className="space-y-8">
        <h2 className={`!mb-3 ${sectionTitle}`}>Basics</h2>

        <label className="block">
          <span className="mb-2 block text-base font-semibold">Group name</span>
          <input name="name" required defaultValue={group.name} maxLength={60} autoComplete="off" className={inputClass} />
        </label>

        <fieldset>
          <legend className="mb-1 text-base font-semibold">Group currency</legend>
          <p className="mb-4 text-sm text-gray-500">
            Balances are shown in this.
            {group._count.expenses + group._count.payments > 0 && " Changing it converts existing amounts (you’ll confirm the rate)."}
          </p>
          <CurrencySelect name="currency" defaultValue={group.currency} />
        </fieldset>

        <label className="block">
          <span className="mb-1 block text-base font-semibold">Also show amounts in</span>
          <span className="mb-4 block text-sm text-gray-500">
            Shown as ≈ next to balances, at today’s rate. Automatic picks your most-used foreign currency.
          </span>
          <select name="secondaryCurrency" defaultValue={group.secondaryCurrency} className={inputClass}>
            <option value="">Automatic</option>
            <option value="none">Don’t show a second currency</option>
            <optgroup label="Popular">
              {POPULAR_CURRENCIES.filter((c) => c !== group.currency).map((code) => {
                const c = currencyInfo(code);
                return (
                  <option key={code} value={code}>
                    {c.flag} {code} — {c.name}
                  </option>
                );
              })}
            </optgroup>
            <optgroup label="All currencies">
              {CURRENCIES.filter((c) => c.code !== group.currency && !POPULAR_CURRENCIES.includes(c.code)).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.code} — {c.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
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

        <button type="submit" className={primaryButtonClass}>
          Save settings
        </button>
      </form>

      {/* People & data: one list of links */}
      <h2 className={`mt-12 ${sectionTitle}`}>People &amp; data</h2>
      <ul className="mt-6 divide-y divide-line rounded-2xl border border-line">
        <SettingsLink href={`/groups/${group.id}/people`} label="Manage people" hint={`${group.members.filter((m) => !m.leftAt).length} people · rename, remove, leave`} />
        <SettingsLink href={`/groups/${group.id}/invite`} label="Add people" hint="Loopin users, contacts or email" />
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
        <p className="mb-4 text-sm text-gray-500">For everyone. Anyone in it can restore it for 30 days.</p>
        <form action={deleteGroup}>
          <input type="hidden" name="groupId" value={group.id} />
          <ConfirmButton
            message={`Delete “${group.name}” for everyone? It can be restored for 30 days.`}
            className="w-full rounded-full border border-red-500/40 px-5 py-3.5 text-center text-base font-medium text-red-400 active:bg-red-500/10"
          >
            Delete group
          </ConfirmButton>
        </form>
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
