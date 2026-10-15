import Link from "next/link";
import { deleteMyAccount, signOutThisPhone } from "@/app/actions";
import { getAccount, getMemberships } from "@/lib/identity";
import { loadMyGroups } from "@/lib/group-data";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PageHeader, primaryButtonClass, secondaryButtonClass } from "@/components/ui";

// You: signed-in email (optional), sign out, delete your data, privacy.
export default async function AccountPage() {
  const account = await getAccount();
  const groups = await loadMyGroups(await getMemberships());
  const admins = (process.env.ADMIN_EMAIL ?? "").split(",").map((s) => s.trim().toLowerCase());
  const isAdmin = Boolean(account && admins.includes(account.email));

  return (
    <>
      <PageHeader title="You" back="/" />

      {account ? (
        <section className="vault rounded-[20px] px-5 py-5 text-fg">
          <p className="text-sm text-fg/55">Signed in as</p>
          <p className="mt-1 break-all font-display text-xl font-semibold">{account.email}</p>
          <p className="mt-2 text-sm text-fg/55">
            Your {groups.length} {groups.length === 1 ? "group is" : "groups are"} saved to this email. Sign in on any phone to get them back.
          </p>
        </section>
      ) : (
        <section className="vault rounded-[20px] px-5 py-5 text-fg">
          <p className="font-display text-xl font-semibold">Not signed in</p>
          <p className="mt-2 text-sm text-fg/60">
            Your groups live on this phone. Optionally save them to your email so a new phone — or the installed app — can get them back.
          </p>
          <Link href="/signin?back=/account" className={`mt-5 ${primaryButtonClass}`}>
            Save my groups to my email
          </Link>
        </section>
      )}

      {account && (
        <section className="mt-10 border-t border-line pt-8">
          <h2 className="mb-1 text-base font-semibold">Sign out of this phone</h2>
          <p className="mb-4 text-sm text-gray-500">This phone forgets your groups. They stay safe in your email — sign in again to get them back.</p>
          <form action={signOutThisPhone}>
            <ConfirmButton message="Sign out of this phone?" className={secondaryButtonClass}>
              Sign out
            </ConfirmButton>
          </form>
        </section>
      )}

      <section className="mt-10 border-t border-line pt-8">
        <h2 className="mb-1 text-base font-semibold">Your data</h2>
        <p className="mb-4 text-sm text-gray-500">
          Download any group as a spreadsheet from its settings. To remove a whole group for everyone, use “Delete group” in its settings.
        </p>
        {account && (
          <form action={deleteMyAccount}>
            <ConfirmButton
              message="Delete your sign-in and email? Your groups stay on this phone and in each group’s history."
              className="w-full rounded-full border border-red-500/40 px-5 py-3.5 text-center text-base font-medium text-red-400 active:bg-red-500/10"
            >
              Delete my email &amp; sign-in
            </ConfirmButton>
          </form>
        )}
      </section>

      {isAdmin && (
        <Link href="/stats" className={`mt-10 ${secondaryButtonClass}`}>
          Owner stats
        </Link>
      )}

      <p className="mt-10 text-center text-sm">
        <Link href="/privacy" className="text-gray-500 underline underline-offset-4">
          How we handle your data
        </Link>
      </p>
    </>
  );
}
