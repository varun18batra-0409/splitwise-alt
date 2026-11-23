import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { getAccount, getMemberships } from "@/lib/identity";
import { PageHeader } from "@/components/ui";
import { directEntryOn } from "@/lib/direct";
import { pickableGroups } from "@/lib/direct-db";

// "+ Add expense" from the home screen. First a choice: with a person, or in a group (no JavaScript needed: both are plain links).
// "In a group" is the old behaviour: no groups go to make one; with one group it jumps straight in; with several, it asks which group.
export default async function PickGroupForExpense({ searchParams }: { searchParams: Promise<{ in?: string }> }) {
  const sp = await searchParams;
  const memberships = await getMemberships();

  if (!directEntryOn() || sp.in === "group") {
    const groups = await pickableGroups(memberships);
    if (groups.length === 0) redirect("/groups/new");
    if (groups.length === 1) redirect(`/groups/${groups[0].id}/add`);

    return (
      <>
        <PageHeader title="Add expense to…" back={directEntryOn() ? "/add" : "/"} />
        <ul className="space-y-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`/groups/${g.id}/add`}
                className="block rounded-xl border border-gray-200 px-4 py-4 font-medium active:bg-gray-50"
              >
                {g.name}
              </Link>
            </li>
          ))}
        </ul>
      </>
    );
  }

  const account = await getAccount();
  const row = "flex min-h-[72px] items-center gap-3.5 rounded-[22px] border border-line bg-white px-4 py-3.5 active:bg-mist";
  return (
    <>
      <PageHeader title="Add expense" back="/" />
      <ul className="space-y-3" data-add-choice>
        <li>
          <Link href={account ? "/add/person" : "/signin?back=/add/person"} className={row} data-choice="person">
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[22px] font-semibold leading-tight tracking-[-0.01em]">With a person</span>
              <span className="mt-0.5 block text-[14px] leading-snug text-fg/65">{account ? "Just the two of you, no group needed." : "Sign in to add expenses with a person."}</span>
            </span>
            <span aria-hidden className="text-fg/60">›</span>
          </Link>
        </li>
        <li>
          <Link href="/add?in=group" className={row} data-choice="group">
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[22px] font-semibold leading-tight tracking-[-0.01em]">In a group</span>
              <span className="mt-0.5 block text-[14px] leading-snug text-fg/65">A trip, a flat, or any group you’re in.</span>
            </span>
            <span aria-hidden className="text-fg/60">›</span>
          </Link>
        </li>
      </ul>
    </>
  );
}
