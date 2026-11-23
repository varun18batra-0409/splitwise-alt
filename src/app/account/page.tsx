import { EmailText } from "@/components/EmailText";
import { ACCOUNT_FOOTER_LINKS, FooterLinks } from "@/components/FooterLinks";
import Link from "@/components/Link";
import { unreadPostcards } from "@/lib/blocks";
import { CompassIcon, PeoplePassportsIcon } from "@/components/DrawnIcons";
import { BellIcon, ChartIcon } from "@/components/icons";
import { GetAppButton } from "@/components/GetApp";
import { DevicesLineIcon, DownloadLineIcon, HelpLineIcon, LockedYouRow, LockLineIcon, PlayLineIcon, PostcardLineIcon, WalletLineIcon, YouList, YouRow } from "@/components/YouRows";
import { InviteFriends } from "@/components/InviteFriends";
import { saveMyName } from "@/app/actions";
import { db } from "@/lib/db";
import { sameName } from "@/lib/names";
import { getAccount, getMemberships } from "@/lib/identity";
import { countMyGroups, loadDeletedGroups } from "@/lib/group-data";
import { PageHeader, primaryButtonClass, secondaryButtonClass } from "@/components/ui";

// You: who you are, then one row per thing. Each row opens its own page (pay details, privacy, sign-in, your data, notifications, support);
// nothing is written twice on this page.
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ name?: string; groups?: string }> }) {
  const { name: nameState, groups: renamed } = await searchParams;
  // Who you are, then everything that doesn't depend on the others, all at once.
  const [account, memberships] = await Promise.all([getAccount(), getMemberships()]);
  const [postcardsNew, groupCount, deleted, sameNameRows] = await Promise.all([
    account ? unreadPostcards(account.id) : Promise.resolve(0),
    countMyGroups(memberships), // (only the number is shown here)
    loadDeletedGroups(memberships),
    account?.name ? db.member.findMany({ where: { accountId: account.id, leftAt: null, group: { deletedAt: null } }, select: { name: true } }) : Promise.resolve([] as { name: string }[]),
  ]);
  const deletedCount = deleted.length;
  const admins = (process.env.ADMIN_EMAIL ?? "").split(",").map((s) => s.trim().toLowerCase());
  const isAdmin = Boolean(account && admins.includes(account.email));
  // Groups where you still go by your profile name: renamed with it if you like.
  const sameNameGroups = account?.name ? sameNameRows.filter((m) => sameName(m.name, account.name)).length : 0;
  const shown = account?.name || "";

  return (
    <>
      <PageHeader title="You" back="/" bell />

      {account ? (
        <section aria-label="Your profile" className="rounded-[20px] border border-line bg-white px-5 py-5 text-fg">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <span aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#1f1f24] font-display text-3xl font-semibold">
              {(shown || account.email).slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-[9em] flex-1 basis-[9em]">
              {/* A long name wraps onto a second line; at very large text it moves under the letter (founder, 22 Nov). Never wider than the screen:
                  a very long word is hyphenated, and the size stops growing past about a ninth of the screen width (only at the biggest text sizes). */}
              <p className="break-words font-display text-[length:min(1.5rem,9vw)] font-semibold leading-tight hyphens-auto">{shown || "Add your name"}</p>
              <p className="mt-0.5 break-words text-[13px] text-fg/55">Signed in as <EmailText email={account.email} /></p>
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
                  <input type="checkbox" name="groups" defaultChecked className="mt-0.5 h-5 w-5" />
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
            Your {groupCount} {groupCount === 1 ? "group is" : "groups are"} saved to this email. Sign in on any device to get {groupCount === 1 ? "it" : "them"} back.
          </p>
        </section>
      ) : (
        <section className="rounded-[20px] border border-line bg-white px-5 py-5 text-fg">
          <p className="font-display text-xl font-semibold">Not signed in</p>
          <p className="mt-2 text-sm text-fg/60">
            {groupCount
              ? "These groups are only on this device. Save them to your email before you switch devices, so a new device or the installed app can get them back."
              : "Sign in to see your groups on any device, or to start one."}
          </p>
          <Link href="/signin?back=/account" className={`mt-5 ${primaryButtonClass}`}>
            Sign in or sign up
          </Link>
        </section>
      )}

      {/* Groups deleted in the last 30 days live at the bottom of Your groups; a quiet line here, only when there are some. */}
      {deletedCount > 0 && (
        <Link href="/groups#deleted" className="mt-4 flex min-h-11 items-center justify-between gap-3 px-1 text-sm text-fg/65 active:text-fg" data-deleted-link>
          <span>Recently deleted groups ({deletedCount})</span>
          <span aria-hidden>›</span>
        </Link>
      )}

      {/* Your things: passport, postcards, friends, recap. */}
      {account && (
        <YouList className="mt-6">
          <YouRow href="/passport" icon={<CompassIcon size={22} />} title="Your trip passport" line="A stamp for every place you’ve been" />
          <YouRow hook="postcards" href="/postcards" icon={<PostcardLineIcon />} title="Your postcards" line={`${postcardsNew ? `${postcardsNew} new · ` : ""}Warm notes from people you’ve shared a group with`} />
          <YouRow href="/passport/friends" icon={<PeoplePassportsIcon size={22} />} title="Friends’ passports" line="Where friends in your groups have been" />
          <YouRow href="/search" icon={<ChartIcon size={22} />} title="Your recap" line="Your spending, month by month" />
        </YouList>
      )}
      {/* Signed out: the rows that need an account are here, locked, so nobody wonders where they are. They open sign-in. */}
      {!account && (
        <YouList className="mt-6">
          <LockedYouRow icon={<CompassIcon size={22} />} title="Your trip passport" />
          <LockedYouRow icon={<PostcardLineIcon />} title="Your postcards" />
          <YouRow href="/search" icon={<ChartIcon size={22} />} title="Your recap" line="Your spending, month by month" />
        </YouList>
      )}

      {/* Preferences and account: each row goes straight to its section below, or to its own page. */}
      {account && (
        <YouList label="Preferences" className="mt-8">
          <YouRow hook="notify" href="/account/notifications" icon={<BellIcon size={22} />} title="Notifications & email" line="Choose what Loopin sends you" />
          <YouRow href="/account/pay" icon={<WalletLineIcon />} title="How friends pay you" line="Your UPI ID or pay link" />
          <YouRow href="/account/privacy" icon={<LockLineIcon />} title="Privacy & sharing" line="Blocked people and what others can see" />
        </YouList>
      )}
      {!account && (
        <YouList label="Preferences" className="mt-8">
          <LockedYouRow icon={<BellIcon size={22} />} title="Notifications & email" />
          <LockedYouRow icon={<LockLineIcon />} title="Privacy & sharing" />
        </YouList>
      )}
      <YouList label="Account" className="mt-8">
        {account && <YouRow href="/account/sign-in" icon={<DevicesLineIcon />} title="Sign-in & devices" line="Fingerprint sign-in, sign out of devices" />}
        <YouRow href="/account/data" icon={<DownloadLineIcon />} title="Export your data" line="A copy of everything in your groups" />
        <YouRow href="/how-it-works" icon={<PlayLineIcon />} title="How Loopin works" line="A one-minute tour" />
        <YouRow href="/support" icon={<HelpLineIcon />} title="Help & support" line="Guides and a way to reach us" />
      </YouList>

      {/* Moved here from Home's header: puts Loopin on the home screen (hidden once it is installed). */}
      <GetAppButton variant="card" className="mt-6" />

      <InviteFriends name={account?.name} className="mt-6" />

      {isAdmin && (
        <Link href="/stats" className={`mt-10 ${secondaryButtonClass}`}>
          Owner stats
        </Link>
      )}

      <FooterLinks links={ACCOUNT_FOOTER_LINKS} className="mt-10" />
    </>
  );
}
