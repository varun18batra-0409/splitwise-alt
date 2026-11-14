import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader, inputClass, secondaryButtonClass } from "@/components/ui";
import { savePayWays } from "@/app/pay-actions";
import { getAccount } from "@/lib/identity";
import { visitorRegion } from "@/lib/region";

export const metadata = { title: "How friends pay you", robots: { index: false } };

// You, How friends pay you: a Pay button on Settle up for anyone who owes you.
export default async function PayDetailsPage({ searchParams }: { searchParams: Promise<{ pay?: string; payError?: string }> }) {
  const { pay: payState, payError } = await searchParams;
  const account = await getAccount();
  if (!account) redirect("/signin?back=/account/pay");
  return (
    <>
      <PageHeader title="How friends pay you" back="/account" />
      <section id="pay" aria-label="How friends pay you back" className="scroll-mt-4">
        <p className="text-sm text-gray-500">
          People who owe you get a Pay button with the amount filled in. Only people in your groups who owe you see these. Loopin never moves money.
        </p>
        {payState === "saved" && (
          <p role="status" className="mt-3 text-sm text-emerald-400">
            Saved.
          </p>
        )}
        {payState === "error" && payError && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {payError.slice(0, 160)}
          </p>
        )}
        <form action={savePayWays} className="mt-4 space-y-3">
          {/* UPI only works in India: shown there, or to anyone who already saved one. */}
          {account.upiId || (account.homeCountry || visitorRegion(await headers()).country || "IN").toUpperCase() === "IN" ? (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-600">UPI ID (India)</span>
              <input name="upiId" defaultValue={account.upiId} maxLength={120} placeholder="e.g. asha@okicici" autoComplete="off" autoCapitalize="none" spellCheck={false} className={inputClass} />
            </label>
          ) : (
            <input type="hidden" name="upiId" value="" data-upi-hidden="1" />
          )}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-600">PayPal, Venmo, Cash App, Revolut or Monzo link</span>
            <input name="payLink" defaultValue={account.payLink} maxLength={300} placeholder="e.g. paypal.me/asha or venmo.com/u/asha" autoComplete="off" autoCapitalize="none" spellCheck={false} className={inputClass} />
          </label>
          <button type="submit" className={secondaryButtonClass}>
            Save pay details
          </button>
        </form>
      </section>
    </>
  );
}
