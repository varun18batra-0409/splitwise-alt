import Link from "@/components/Link";
import { deleteMyAccount, removeMyPasskey, signOutThisPhone } from "@/app/actions";
import { listPasskeys } from "@/lib/passkeys";
import { PasskeyAdd } from "@/components/Passkeys";
import { niceDate } from "@/lib/format";
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
  const passkeys = account ? await listPasskeys(account.id) : [];

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
            Sign in or sign up
          </Link>
        </section>
      )}

      {account && (
        <section className="mt-10 border-t border-line pt-8">
          <h2 className="mb-1 text-base font-semibold">Fingerprint / face sign-in</h2>
          <p className="mb-4 text-sm text-gray-500">Sign in with one touch instead of a code. Your fingerprint never leaves your phone; Loopin only gets a key that proves it’s you.</p>
          {passkeys.length > 0 && (
            <ul className="mb-4 divide-y divide-line border-y border-line">
              {passkeys.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{p.label || "Passkey"}</span>
                    <span className="block text-xs text-gray-500">
                      Added {niceDate(p.createdAt.toISOString().slice(0, 10))}
                      {p.lastUsedAt ? ` · last used ${niceDate(p.lastUsedAt.toISOString().slice(0, 10))}` : ""}
                    </span>
                  </span>
                  <form action={removeMyPasskey}>
                    <input type="hidden" name="id" value={p.id} />
                    <ConfirmButton message="Remove this fingerprint / face sign-in?" className="rounded-full border border-line px-3.5 py-1.5 text-sm text-fg active:bg-mist">
                      Remove
                    </ConfirmButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <PasskeyAdd className={secondaryButtonClass} label={passkeys.length ? "Add this phone too" : "Turn on fingerprint / face sign-in"} />
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
          One spreadsheet with every expense and payment in all your groups, your share of each, and your account details. To remove a whole group
          for everyone, use “Delete group” in its settings.
        </p>
        {groups.length > 0 && (
          <a href="/api/my-data" download className={`mb-4 ${secondaryButtonClass}`}>
            Download all my data
          </a>
        )}
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
        <Link href="/how-it-works" className="mr-4 text-gray-500 underline underline-offset-4">
          How Loopin works
        </Link>
        <Link href="/faq" className="text-gray-500 underline underline-offset-4">
          FAQ
        </Link>
      </p>
    </>
  );
}
