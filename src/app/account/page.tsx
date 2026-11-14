import { ACCOUNT_FOOTER_LINKS, FooterLinks } from "@/components/FooterLinks";
import Link from "@/components/Link";
import { unreadPostcards } from "@/lib/blocks";
import { CompassIcon, PeoplePassportsIcon } from "@/components/DrawnIcons";
import { BellIcon, ChartIcon } from "@/components/icons";
import { GetAppButton } from "@/components/GetApp";
import { DevicesLineIcon, DownloadLineIcon, HelpLineIcon, LockLineIcon, PostcardLineIcon, WalletLineIcon, YouList, YouRow } from "@/components/YouRows";
import { InviteFriends } from "@/components/InviteFriends";
import { saveMyName } from "@/app/actions";
import { db } from "@/lib/db";
import { sameName } from "@/lib/names";
import { getAccount, getMemberships } from "@/lib/identity";
import { loadDeletedGroups, loadMyGroups } from "@/lib/group-data";
import { PageHeader, primaryButtonClass, secondaryButtonClass } from "@/components/ui";

// You: who you are, then one row per thing. Each row opens its own page (pay details, privacy, sign-in, your data, notifications, support);
// nothing is written twice on this page.
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ name?: string; groups?: string }> }) {
  const { name: nameState, groups: renamed } = await searchParams;
  const account = await getAccount();
  const postcardsNew = account ? await unreadPostcards(account.id) : 0;
  const memberships = await getMemberships();
  const groups = await loadMyGroups(memberships);
  const deletedCount = (await loadDeletedGroups(memberships)).length;
  const admins = (process.env.ADMIN_EMAIL ?? "").split(",").map((s) => s.trim().toLowerCase());
  const isAdmin = Boolean(account && admins.includes(account.email));
  // Groups where you still go by your profile name: renamed with it if you like.
  const sameNameGroups = account?.name
    ? (await db.member.findMany({ where: { accountId: account.id, leftAt: null, group: { deletedAt: null } }, select: { name: true } })).filter((m) =>
        sameName(m.name, account.name),
      ).length
    : 0;
  const shown = account?.name || "";

  return (
    <>
      <PageHeader title="You" back="/" bell />

      {account ? (
        <section aria-label="Your profile" className="rounded-[20px] border border-line bg-white px-5 py-5 text-fg">
          <div className="flex items-center gap-4">
            <span aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#1f1f24] font-display text-3xl font-semibold">
              {(shown || account.email).slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-2xl font-semibold leading-tight">{shown || "Add your name"}</p>
              <p className="mt-0.5 break-all text-[13px] text-fg/55">Signed in as {account.email}</p>
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
            Your {groups.length} {groups.length === 1 ? "group is" : "groups are"} saved to this email. Sign in on any phone to get them back.
          </p>
        </section>
      ) : (
        <section className="rounded-[20px] border border-line bg-white px-5 py-5 text-fg">
          <p className="font-display text-xl font-semibold">Not signed in</p>
          <p className="mt-2 text-sm text-fg/60">
            {groups.length
              ? "These groups are only on this phone. Save them to your email before you switch phones, so a new phone or the installed app can get them back."
              : "Sign in to see your groups on any phone, or to start one."}
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
      {!account && (
        <YouList className="mt-6">
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
      <YouList label="Account" className="mt-8">
        {account && <YouRow href="/account/sign-in" icon={<DevicesLineIcon />} title="Sign-in & devices" line="Fingerprint sign-in, sign out of phones" />}
        <YouRow href="/account/data" icon={<DownloadLineIcon />} title="Export your data" line="A copy of everything in your groups" />
        <YouRow href="/how-it-works" icon={<HelpLineIcon />} title="How Loopin works" line="Three steps, one minute" />
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
