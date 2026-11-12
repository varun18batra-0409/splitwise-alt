import Link from "@/components/Link";
import { PageHeader, primaryButtonClass } from "@/components/ui";

export const metadata = { title: "Private group" };

// Shown when someone opens a group they're not in. It never reveals the
// group's name or its invite link: only people in the group can invite.
export default async function PrivateGroup({ searchParams }: { searchParams: Promise<{ linked?: string }> }) {
  // This phone used to be a name in the group, but that name is now linked to an email.
  const linked = (await searchParams).linked === "1";
  return (
    <>
      <PageHeader title="Private group" back="/" />
      {linked ? (
        <>
          <p className="mb-2 text-gray-600">This name is now linked to an email. Sign in with that email to use it on this phone.</p>
          <p className="mb-8 text-gray-600">Your group is safe: nothing was lost.</p>
          <Link href="/signin" className={primaryButtonClass}>
            Sign in
          </Link>
        </>
      ) : (
        <>
          <p className="mb-2 text-gray-600">You’re not in this group, so you can’t see it.</p>
          <p className="mb-8 text-gray-600">Ask someone in the group to add you. They can find you by your email, or send you an invite.</p>
          <Link href="/" className={primaryButtonClass}>
            Go to my groups
          </Link>
        </>
      )}
    </>
  );
}
