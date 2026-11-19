import Link from "@/components/Link";

// A quiet card for someone in this group without an account: who they are on this phone, and the way to keep the group if they change
// phones. Same pattern as the "groups only on this device" line on Home. The button goes to the sign-in page, which asks before moving
// any group (so nothing moves without a yes).
export function GuestCard({ name, groupName, groupId }: { name: string; groupName: string; groupId: string }) {
  return (
    <section aria-label="You are in this group without an account" className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl border border-line px-4 py-2" data-guest-card>
      <p className="min-w-0 flex-1 basis-48 text-sm leading-snug text-fg/75">
        <b className="font-semibold text-fg">You’re {name}, on this phone</b>
        <span className="block">Sign in so {groupName} stays yours if you change phones.</span>
      </p>
      <Link href={`/signin?${new URLSearchParams({ back: `/groups/${groupId}` })}`} className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-fg underline underline-offset-4">
        Sign in
      </Link>
    </section>
  );
}
