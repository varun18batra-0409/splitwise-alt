import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { setGroupClosed, updateGroupSettings } from "@/app/actions";
import { formatPercent } from "@/lib/money";
import { CurrencySelect } from "@/components/CurrencySelect";
import { ErrorNote, PageHeader, primaryButtonClass, secondaryButtonClass } from "@/components/ui";

const PRESETS = [0, 200, 300, 400];

const ERRORS: Record<string, string> = {
  markup: "Enter a markup between 0% and 20%, like 3.5.",
  currency: "Pick a currency from the list.",
  locked: "The group currency can't change once expenses have been added.",
};

// Group settings: base settlement currency and the foreign card markup.
export default async function GroupSettings({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const group = await db.group.findUnique({
    where: { id },
    include: { members: { select: { id: true } }, _count: { select: { expenses: true } } },
  });
  if (!group) notFound();
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(`/join/${group.inviteCode}`);

  const locked = group._count.expenses > 0;
  const isPreset = PRESETS.includes(group.cardMarkupBp);

  return (
    <>
      <PageHeader title="Group settings" back={`/groups/${group.id}`} />
      {error && ERRORS[error] && <ErrorNote>{ERRORS[error]}</ErrorNote>}

      <form action={updateGroupSettings} className="space-y-10">
        <input type="hidden" name="groupId" value={group.id} />

        <fieldset>
          <legend className="mb-1 text-base font-semibold">Group currency</legend>
          <p className="mb-4 text-sm text-gray-500">
            Balances and settle-up amounts are shown in this currency. Expenses in other currencies are converted into it.
          </p>
          <CurrencySelect name="currency" defaultValue={group.currency} disabled={locked} />
          {/* A disabled dropdown isn't sent with the form, so send the current value. */}
          {locked && <input type="hidden" name="currency" value={group.currency} />}
          {locked && (
            <p className="mt-2 text-sm text-gray-500">
              Locked because this group already has expenses, so saved amounts keep their meaning.
            </p>
          )}
        </fieldset>

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

    </>
  );
}
