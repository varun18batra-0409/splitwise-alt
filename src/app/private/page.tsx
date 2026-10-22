import Link from "@/components/Link";
import { PageHeader, primaryButtonClass } from "@/components/ui";

export const metadata = { title: "Private group" };

// Shown when someone opens a group they're not in. It never reveals the
// group's name or its invite link: only people in the group can invite.
export default function PrivateGroup() {
  return (
    <>
      <PageHeader title="Private group" back="/" />
      <p className="mb-2 text-gray-600">You’re not in this group, so you can’t see it.</p>
      <p className="mb-8 text-gray-600">Ask someone in the group to add you. They can find you by your email, or send you an invite.</p>
      <Link href="/" className={primaryButtonClass}>
        Go to my groups
      </Link>
    </>
  );
}
