import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { convertGroupCurrency, deleteGroup, setGroupClosed, updateGroupSettings } from "@/app/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CURRENCIES, currencyInfo, formatMoney, formatPercent, isSupportedCurrency, POPULAR_CURRENCIES } from "@/lib/money";
import { getRate } from "@/lib/rate-cache";
import { niceDate } from "@/lib/format";
import Link from "next/link";
import { CurrencySelect } from "@/components/CurrencySelect";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";

const PRESETS = [0, 200, 300, 400];

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
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(`/join/${group.inviteCode}`);

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

        <label className="block">
          <span className="mb-2 block text-base font-semibold">Group name</span>
          <input name="name" required defaultValue={group.name} maxLength={60} autoComplete="off" className={inputClass} />
        </label>

        <fieldset>
          <legend className="mb-1 text-base font-semibold">Group currency</legend>
          <p className="mb-4 text-sm text-gray-500">
            Balances and settle-up amounts are shown in this currency. Expenses in other currencies are converted into it.
            {group._count.expenses + group._count.payments > 0 && " If you change it, you’ll confirm a rate to convert existing amounts next."}
          </p>
          <CurrencySelect name="currency" defaultValue={group.currency} />
        </fieldset>

        <label className="block">
          <span className="mb-1 block text-base font-semibold">Also show amounts in</span>
          <span className="mb-4 block text-sm text-gray-500">
            Balances are also shown in this currency (≈), converted at today’s rate. Handy on a trip: a {group.currency} group in
            Thailand can show baht too. Automatic uses the foreign currency your expenses use most.
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

        <fieldset>
          <legend className="mb-1 text-base font-semibold">Foreign-currency credit-card markup</legend>
          <p className="mb-4 text-sm text-gray-500">
            An estimated fee your card adds when you pay in another currency. It’s added only to card payments in a
            foreign currency — never to cash or bank transfers — and you can change it on any expense. Actual bank
            charges can differ.
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

        <button type="submit" className={primaryButtonClass}>
          Save settings
        </button>
      </form>

      {/* People */}
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="mb-1 text-base font-semibold">People</h2>
        <p className="mb-4 text-sm text-gray-500">Rename someone, remove a person added by mistake, or leave the group.</p>
        <Link href={`/groups/${group.id}/people`} className={secondaryButtonClass}>
          Manage people ({group.members.filter((m) => !m.leftAt).length})
        </Link>
      </section>

      {/* Export */}
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="mb-1 text-base font-semibold">Download as a spreadsheet</h2>
        <p className="mb-4 text-sm text-gray-500">
          Every expense and payment, with each person’s share, as a CSV file. Opens in Excel or Google Sheets.
        </p>
        <a href={`/groups/${group.id}/export`} download className={secondaryButtonClass}>
          Download CSV
        </a>
      </section>

      {/* Who this phone is in the group */}
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="mb-1 text-base font-semibold">You on this phone</h2>
        <p className="mb-4 text-sm text-gray-500">
          This phone is set up as <span className="text-fg">{group.members.find((m) => m.id === myId)?.name}</span>. Picked the wrong name
          when joining? Switch to the right one.
        </p>
        <Link href={`/join/${group.inviteCode}`} className={secondaryButtonClass}>
          Switch person
        </Link>
      </section>

      {/* Close / reopen */}
      <section className="mt-12 border-t border-gray-100 pt-8">
        <h2 className="mb-1 text-base font-semibold">{group.closed ? "This group is closed" : "Close this group"}</h2>
        <p className="mb-4 text-sm text-gray-500">
          {group.closed
            ? "It’s hidden from your main list and new expenses are paused. Its full history is kept."
            : "When a trip or plan is over, close the group. It moves under “Show closed groups” on the home screen, keeps its full history, and can be reopened any time."}
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
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="mb-1 text-base font-semibold">Delete this group</h2>
        <p className="mb-4 text-sm text-gray-500">
          Removes the group for everyone in it. Anyone in the group can restore it from their home screen for 30 days.
          After that it’s gone for good.
        </p>
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
