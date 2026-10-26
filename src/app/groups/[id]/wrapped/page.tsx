import { notFound, redirect } from "next/navigation";
import { loadGroup } from "@/lib/group-data";
import { getMyMemberId } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { PageHeader } from "@/components/ui";
import { WrappedDeck } from "@/components/WrappedDeck";
import { wrapSlides } from "@/lib/wrapped";
import { coverFor } from "@/lib/covers";
import { placePhoto } from "@/lib/places";

export const metadata = { title: "Wrapped", robots: { index: false } };

// A group's story: how much, where it went, the big night, the splurge, and
// everyone's award. Made for trips, works for any group.
export default async function WrappedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadGroup(id);
  if (!data) notFound();
  const { group, expenses, transfers } = data;
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  const still = transfers.reduce((s, t) => s + t.amount, 0);
  const { slides } = wrapSlides({
    name: group.name,
    currency: group.currency,
    tz: await getTimeZone(),
    people: group.members.filter((m) => !m.leftAt).map((m) => ({ id: m.id, name: m.name })),
    expenses,
    tripStart: group.tripStart,
    tripEnd: group.tripEnd,
    stillToSettle: still,
    myId,
  });
  return (
    <>
      <PageHeader title="Wrapped" back={`/groups/${group.id}`} />
      <WrappedDeck
        slides={slides}
        photo={group.type === "trip" ? placePhoto(group.name)?.src : undefined}
        cover={coverFor(group)}
        groupId={group.id}
        groupName={group.name}
        settleHref={still > 0 ? `/groups/${group.id}/settle` : undefined}
      />
    </>
  );
}
