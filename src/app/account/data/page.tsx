import { PageHeader, secondaryButtonClass } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PushEndpointField } from "@/components/PushEndpointField";
import { deleteMyAccount } from "@/app/actions";
import { getAccount, getMemberships } from "@/lib/identity";
import { loadMyGroups } from "@/lib/group-data";

export const metadata = { title: "Your data", robots: { index: false } };

// You, Export your data: one spreadsheet of everything, and (signed in) deleting your sign-in.
export default async function YourDataPage() {
  const account = await getAccount();
  const groups = await loadMyGroups(await getMemberships());
  return (
    <>
      <PageHeader title="Your data" back="/account" />
      <section className="scroll-mt-4" id="data">
        <p className="mb-4 text-sm text-gray-500">
          One spreadsheet with every expense and payment in all your groups, your share of each, your account details, your postcards, passport,
          collections and notification settings. To remove a whole group for everyone, use “Delete group” in its settings.
        </p>
        {(account || groups.length > 0) && (
          <a href="/api/my-data" download className={`mb-4 ${secondaryButtonClass}`}>
            Download all my data
          </a>
        )}
        {account && (
          <form action={deleteMyAccount}>
            <PushEndpointField />
            <ConfirmButton
              message="Delete your sign-in, email, postcards and passkeys? Your groups stay on this phone and in each group’s history."
              className="mx-auto block min-h-11 px-4 py-2 text-center text-sm text-fg/75 underline underline-offset-4 active:text-fg"
            >
              Delete my email &amp; sign-in
            </ConfirmButton>
          </form>
        )}
      </section>
    </>
  );
}
