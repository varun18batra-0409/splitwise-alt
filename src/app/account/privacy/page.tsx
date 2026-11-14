import { PageHeader } from "@/components/ui";
import { PrivacySafety } from "@/components/PrivacySafety";
import { getAccount } from "@/lib/identity";

export const metadata = { title: "Privacy & sharing", robots: { index: false } };

// You, Privacy & sharing: AI reading on or off, and the people you blocked.
export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ ai?: string; blocked?: string; unblocked?: string }> }) {
  const { ai, blocked, unblocked } = await searchParams;
  const account = await getAccount();
  return (
    <>
      <PageHeader title="Privacy & sharing" back="/account" />
      <PrivacySafety accountId={account?.id ?? null} flags={{ ai, blocked, unblocked }} />
    </>
  );
}
