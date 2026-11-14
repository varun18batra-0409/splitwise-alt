import type { Metadata } from "next";
import Link from "@/components/Link";
import { CollectionsSection } from "@/components/CollectionsList";
import { PageHeader, primaryButtonClass } from "@/components/ui";
import { getAccount } from "@/lib/identity";
import { myCollections } from "@/lib/collect";

export const metadata: Metadata = { title: "Your collections", robots: { index: false } };

// Every collection you're running, open ones first (Home shows the first few).
export default async function Collections() {
  const account = await getAccount();
  if (!account) {
    return (
      <>
        <PageHeader title="Your collections" back="/" />
        <p className="mb-6 text-sm text-gray-500">Sign in to see the collections you’re running.</p>
        <Link href={`/signin?${new URLSearchParams({ back: "/collect" })}`} className={primaryButtonClass}>
          Sign in
        </Link>
      </>
    );
  }
  const list = await myCollections(account.id, 200);
  return (
    <>
      <PageHeader title="Your collections" back="/" />
      {list.length === 0 ? (
        <>
          <p className="mb-6 text-sm text-gray-500">Nothing here yet. Gather money for a gift, a farewell or a booking with one link.</p>
          <Link href="/collect/new" className={primaryButtonClass}>
            Start a collection
          </Link>
        </>
      ) : (
        <CollectionsSection list={list} className="" showToCheck />
      )}
    </>
  );
}
