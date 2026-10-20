import { headers } from "next/headers";
import Link from "@/components/Link";
import { NewGroupForm } from "@/components/NewGroupForm";
import { defaultCurrency } from "@/lib/region";
import { getAccount } from "@/lib/identity";
import { ErrorNote, PageHeader, primaryButtonClass } from "@/components/ui";

// New group: what it's for (Trip · Home · Couple · Other), a name, your name and
// the currency; couples also choose their split. People are added next, on
// the "Add people" screen (Loopin users, contacts or email) — never by typing
// a name, so everyone in a group is a real, verified person.
export default async function NewGroup({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; name?: string }>;
}) {
  const { error, name } = await searchParams;
  const currency = defaultCurrency(await headers());
  const account = await getAccount();

  if (!account) {
    const back = `/groups/new${name ? `?name=${encodeURIComponent(name)}` : ""}`;
    return (
      <>
        <PageHeader title="New group" back="/" />
        <section className="vault rounded-[24px] px-6 py-8 text-fg">
          <h1 className="font-display text-2xl font-semibold leading-tight">First, a quick sign-up</h1>
          <p className="mt-2 text-sm text-fg/60">
            Everyone in a Loopin group is a real person with a verified email. That’s how friends can find you and how
            notifications reach the right phone. It takes 30 seconds, and there’s no password.
          </p>
          <Link href={`/signin?${new URLSearchParams({ back })}`} className={`mt-6 ${primaryButtonClass}`}>
            Sign in or sign up
          </Link>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader title="New group" back="/" />
      {error === "busy" ? (
        <ErrorNote>Lots of groups made from here in the last hour. Wait a bit and try again.</ErrorNote>
      ) : (
        error && <ErrorNote>Please fill in the group name and your name.</ErrorNote>
      )}

      <NewGroupForm defaultCurrency={currency} yourName={account.name} initialName={(name ?? "").slice(0, 60)} />
      <p className="mt-6 text-center text-sm text-gray-500">
        Moving from another app?{" "}
        <Link href="/import" className="font-medium text-fg underline">
          Bring a group over
        </Link>
      </p>
    </>
  );
}
