import { headers } from "next/headers";
import Link from "@/components/Link";
import { createGroup } from "@/app/actions";
import { defaultCurrency } from "@/lib/region";
import { getAccount } from "@/lib/identity";
import { CurrencySelect } from "@/components/CurrencySelect";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";

// New group: a name, your name and the currency. People are added next, on
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
          <Link href={`/signin?${new URLSearchParams({ mode: "signup", back })}`} className={`mt-6 ${primaryButtonClass}`}>
            Sign up with email
          </Link>
          <Link href={`/signin?${new URLSearchParams({ back })}`} className={`mt-3 ${secondaryButtonClass}`}>
            I already have an account
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

      <form action={createGroup} className="space-y-8">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-600">Group name</span>
          <input name="groupName" required placeholder="Euro trip" defaultValue={(name ?? "").slice(0, 60)} autoComplete="off" className={inputClass} />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-600">Your name in this group</span>
          <input name="yourName" required defaultValue={account.name} placeholder="Your name" autoComplete="given-name" className={inputClass} />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-600">
            Group currency <span className="font-normal text-gray-400">(balances are shown in this)</span>
          </span>
          <CurrencySelect name="currency" defaultValue={currency} />
        </label>

        <p className="rounded-xl bg-mist px-4 py-3 text-sm text-gray-500">
          Next: add people. Pick friends already on Loopin, choose from your contacts, or invite by email.
        </p>

        <button type="submit" className={primaryButtonClass}>
          Create group &amp; add people
        </button>
      </form>
    </>
  );
}
