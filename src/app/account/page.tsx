import Link from "@/components/Link";
import { CompassIcon, PeoplePassportsIcon } from "@/components/DrawnIcons";
import { InviteFriends } from "@/components/InviteFriends";
import { deleteMyAccount, removeMyPasskey, saveMyName, signOutThisPhone } from "@/app/actions";
import { db } from "@/lib/db";
import { sameName } from "@/lib/names";
import { listPasskeys } from "@/lib/passkeys";
import { PasskeyAdd } from "@/components/Passkeys";
import { niceDate } from "@/lib/format";
import { getAccount, getMemberships } from "@/lib/identity";
import { loadMyGroups } from "@/lib/group-data";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PageHeader, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { savePayWays } from "@/app/pay-actions";

// You: signed-in email (optional), sign out, delete your data, privacy.
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ name?: string; groups?: string; pay?: string; payError?: string }> }) {
  const { name: nameState, groups: renamed, pay: payState, payError } = await searchParams;
  const account = await getAccount();
  const postcardsNew = account ? await db.postcard.count({ where: { toId: account.id, readAt: null } }) : 0;
  const groups = await loadMyGroups(await getMemberships());
  const admins = (process.env.ADMIN_EMAIL ?? "").split(",").map((s) => s.trim().toLowerCase());
  const isAdmin = Boolean(account && admins.includes(account.email));
  const passkeys = account ? await listPasskeys(account.id) : [];
  // Groups where you still go by your profile name: renamed with it if you like.
  const sameNameGroups = account?.name
    ? (await db.member.findMany({ where: { accountId: account.id, leftAt: null, group: { deletedAt: null } }, select: { name: true } })).filter((m) =>
        sameName(m.name, account.name),
      ).length
    : 0;
  const shown = account?.name || "";

  return (
    <>
      <PageHeader title="You" back="/" />

      {account ? (
        <section aria-label="Your profile" className="vault rounded-[20px] px-5 py-5 text-fg">
          <div className="flex items-center gap-4">
            <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-fg/10 font-display text-2xl font-semibold">
              {(shown || account.email).slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-2xl font-semibold leading-tight">{shown || "Add your name"}</p>
              <p className="mt-0.5 text-sm text-fg/55">Signed in as</p>
              <p className="break-all text-sm text-fg/80">{account.email}</p>
            </div>
          </div>
          {nameState === "saved" && (
            <p role="status" className="mt-3 text-sm text-emerald-400">
              Name saved{Number(renamed) > 0 ? `, and changed in ${renamed} ${renamed === "1" ? "group" : "groups"}` : ""}.
            </p>
          )}
          <details className="group/name mt-4" open={nameState === "empty" || !shown}>
            <summary className="inline-flex h-10 cursor-pointer list-none items-center rounded-full border border-fg/25 px-4 text-sm font-semibold active:bg-fg/10 group-open/name:hidden [&::-webkit-details-marker]:hidden">
              Edit name
            </summary>
            <form action={saveMyName} className="space-y-3">
              <label className="block">
                <span className="text-sm text-fg/70">Your name</span>
                <input
                  name="name"
                  defaultValue={shown}
                  required
                  maxLength={40}
                  autoComplete="name"
                  placeholder="e.g. Maya"
                  className="mt-1 block w-full rounded-xl border border-fg/25 bg-transparent px-3.5 py-3 text-base text-fg outline-none focus:border-fg/60"
                />
              </label>
              {nameState === "empty" && <p className="text-sm text-red-400">Type a name.</p>}
              {sameNameGroups > 0 && (
                <label className="flex items-start gap-2.5 text-sm text-fg/80">
                  <input type="checkbox" name="groups" defaultChecked className="mt-0.5 h-4 w-4 accent-fg" />
                  <span>
                    Also change it in {sameNameGroups === 1 ? "the 1 group" : `the ${sameNameGroups} groups`} where you’re {account.name}
                  </span>
                </label>
              )}
              <p className="text-xs text-fg/50">Friends see this name in invites and when they look you up.</p>
              <button type="submit" className={primaryButtonClass}>
                Save
              </button>
            </form>
          </details>
          <p className="mt-4 text-sm text-fg/55">
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

      {/* The trip passport: a stamp for every trip. */}
      {account && (
        <Link href="/passport" className="mt-6 flex items-center gap-4 rounded-[20px] border border-line bg-white px-5 py-4 text-fg active:opacity-90">
          <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#d8bd7a]/50 bg-[radial-gradient(circle_at_30%_25%,rgba(216,189,122,0.18),transparent_70%)] text-[#e8d29a]"><CompassIcon size={24} /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg font-semibold">Your trip passport</span>
            <span className="block text-sm text-gray-500">A stamp for every place you’ve been</span>
          </span>
          <span aria-hidden className="text-xl">›</span>
        </Link>
      )}
      {/* Postcards: their own row, right below the passport. */}
      {account && (
        <Link href="/postcards" className="mt-3 flex items-center gap-4 rounded-[20px] border border-line bg-white px-5 py-4 text-fg active:opacity-90" data-postcards-link>
          <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#e9b9a0]/45 bg-[radial-gradient(circle_at_30%_25%,rgba(233,185,160,0.16),transparent_70%)] text-[#f0c9b2]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="1.5" /><path d="M12 8v8M15 9h3.5v3.5H15zM5.5 10h4M5.5 13h4" /></svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg font-semibold">Your postcards</span>
            <span className="block text-sm text-gray-500">{postcardsNew ? `${postcardsNew} new · ` : ""}Warm notes to people you’ve shared a group with</span>
          </span>
          <span aria-hidden className="text-xl">›</span>
        </Link>
      )}
      {account && (
        <Link href="/passport/friends" className="mt-3 flex items-center gap-4 rounded-[20px] border border-line bg-white px-5 py-4 text-fg active:opacity-90">
          <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-owed/40 bg-[radial-gradient(circle_at_30%_25%,rgba(111,227,168,0.16),transparent_70%)] text-owed"><PeoplePassportsIcon size={24} /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg font-semibold">Friends’ passports</span>
            <span className="block text-sm text-gray-500">Where everyone in your groups has been</span>
          </span>
          <span aria-hidden className="text-xl">›</span>
        </Link>
      )}

      {/* How friends pay you back: a Pay button on Settle up for anyone who owes you. */}
      {account && (
        <section id="pay" aria-label="How friends pay you back" className="mt-6 scroll-mt-4 rounded-[20px] border border-line px-5 py-5">
          <h2 className="font-display text-lg font-semibold tracking-tight">How friends pay you back</h2>
          <p className="mt-1 text-sm text-gray-500">
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
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-600">UPI ID (India)</span>
              <input name="upiId" defaultValue={account.upiId} maxLength={120} placeholder="e.g. asha@okicici" autoComplete="off" autoCapitalize="none" spellCheck={false} className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-600">PayPal, Venmo, Cash App, Revolut or Monzo link</span>
              <input name="payLink" defaultValue={account.payLink} maxLength={300} placeholder="e.g. paypal.me/asha or venmo.com/u/asha" autoComplete="off" autoCapitalize="none" spellCheck={false} className={inputClass} />
            </label>
            <button type="submit" className={secondaryButtonClass}>
              Save pay details
            </button>
          </form>
        </section>
      )}

      <InviteFriends name={account?.name} className="mt-6" />

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
        <Link href="/faq" className="mr-4 text-gray-500 underline underline-offset-4">
          FAQ
        </Link>
        <Link href="/terms" className="text-gray-500 underline underline-offset-4">
          Terms
        </Link>
      </p>
    </>
  );
}
