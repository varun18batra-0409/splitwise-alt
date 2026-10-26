import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "@/components/Link";
import { NewCollectionForm } from "@/components/NewCollectionForm";
import { PageHeader, primaryButtonClass } from "@/components/ui";
import { defaultCurrency } from "@/lib/region";
import { getAccount } from "@/lib/identity";
import { loopinFriends } from "@/lib/collect";

export const metadata: Metadata = { title: "Collect money", robots: { index: false } };

// Collect: one person gathers money from many (a gift, a farewell, a turf
// booking). A link for the WhatsApp group; people pay you directly and tick
// their name, and you see who's left.
export default async function NewCollection() {
  const account = await getAccount();
  const currency = defaultCurrency(await headers());

  if (!account) {
    return (
      <>
        <PageHeader title="Collect money" back="/" />
        <section className="vault rounded-[24px] px-6 py-8 text-fg">
          <p className="font-hand text-[26px] font-bold leading-none text-fg/80">Chasing 30 people for ₹300?</p>
          <h1 className="mt-3 font-display text-2xl font-semibold leading-tight">One link. Everyone pays you, ticks their name, done.</h1>
          <p className="mt-2 text-sm text-fg/60">
            Sign in first so the collection is saved to you. It takes 30 seconds and there’s no password. The people paying don’t need to sign up.
          </p>
          <Link href={`/signin?${new URLSearchParams({ back: "/collect/new" })}`} className={`mt-6 ${primaryButtonClass}`}>
            Sign in or sign up
          </Link>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Collect money" back="/" />
      <p className="-mt-4 mb-6 text-sm text-gray-500">For gifts, farewells, bookings or a society fund: one link, and you’ll see who’s paid and who hasn’t.</p>
      <NewCollectionForm defaultCurrency={currency} yourName={account.name} friends={await loopinFriends(account.id)} yourUpi={account.upiId} yourPayLink={account.payLink} />
    </>
  );
}
