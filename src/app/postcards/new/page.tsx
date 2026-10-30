import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "@/components/Link";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { visitorRegion } from "@/lib/region";
import { countryOf, tripStops } from "@/lib/geo";
import { photoSet, placePhotos } from "@/lib/places";
import { PageHeader, ErrorNote, primaryButtonClass } from "@/components/ui";
import { POSTCARD_FONTS_URL, isSitePhoto, postDate } from "@/lib/postcards/catalog";
import { postcardPeople } from "@/lib/postcards/people";
import { Composer } from "./Composer";

export const metadata = { title: "Write a postcard", robots: { index: false } };

// Write a postcard. From a group, it starts from that trip: its place photos, "Greetings from Goa"
// (or the country, for a trip abroad), the country's stamp and the people in it.
export default async function NewPostcardPage({ searchParams }: { searchParams: Promise<{ group?: string; to?: string; error?: string }> }) {
  const sp = await searchParams;
  const back = `/postcards/new?${new URLSearchParams({ ...(sp.group ? { group: sp.group } : {}), ...(sp.to ? { to: sp.to } : {}) })}`;
  const me = await getAccount();
  if (!me) redirect(`/signin?back=${encodeURIComponent(back)}`);
  const groups = await postcardPeople(me.id);
  if (!groups.length)
    return (
      <>
        <PageHeader title="Write a postcard" back="/postcards" />
        <p className="text-fg/70">Postcards go to people you’ve shared a group with. Invite someone to a group first, and once they’ve joined you can send them one.</p>
        <Link href="/groups/new" className={`mt-6 ${primaryButtonClass}`}>
          Start a group
        </Link>
      </>
    );

  const g = sp.group
    ? await db.group.findFirst({ where: { id: sp.group, deletedAt: null, members: { some: { accountId: me.id } } }, select: { id: true, name: true, type: true, tripPlace: true, tripCountry: true } })
    : null;
  const tz = await getTimeZone();
  const home = (me.homeCountry || visitorRegion(await headers()).country || "IN").toUpperCase();
  const stop = g && g.type === "trip" ? tripStops(g.name, g.tripPlace, g.tripCountry)[0] : undefined;
  const city = stop?.city ?? "";
  const cc = stop?.country ?? "";
  const country = cc ? countryOf(cc)?.name ?? "" : "";
  const abroad = Boolean(cc && cc !== home);

  // The pictures: the trip's own place photos first, then good general ones.
  const general = ["hero", "friends", "sunset", "roadtrip", "dinner", "home"].flatMap((s) => photoSet(s));
  const photos = [...new Set([...(g?.type === "trip" ? placePhotos(g.name, g.tripPlace, 8) : []), ...general])].filter(isSitePhoto).slice(0, 14);
  const words = [...new Set([abroad ? country : city || country, city && country ? `${city}, ${country}` : "", abroad ? city : country, g && g.type !== "trip" ? g.name : ""].filter(Boolean))];
  const kind = g?.type ?? "";
  const front = g?.type === "trip" && photos[0] ? `photo:${photos[0]}` : kind === "pot" ? "print:cards" : kind === "home" || kind === "couple" ? "print:home" : photos[0] ? `photo:${photos[0]}` : "print:beach";
  const stamp = cc ? `c:${cc}` : kind === "pot" ? "t:cards" : kind === "home" || kind === "couple" ? "t:home" : "t:love";
  const allowed = new Set(groups.flatMap((x) => x.people.map((p) => p.id)));
  const to = sp.to && allowed.has(sp.to) ? [sp.to] : [];
  // From a group: its people first.
  const ordered = g ? [...groups.filter((x) => x.id === g.id), ...groups.filter((x) => x.id !== g.id)] : groups;

  return (
    <>
      <link rel="stylesheet" href={POSTCARD_FONTS_URL} precedence="default" />
      <PageHeader title="Write a postcard" back={g ? `/groups/${g.id}` : "/postcards"} />
      {sp.error && <ErrorNote>{sp.error}</ErrorNote>}
      <Composer
        groupId={g?.id ?? ""}
        groups={ordered}
        photos={photos}
        words={words}
        defaults={{ front, words: words[0] ?? "", stamp, place: city || country || g?.name || "Loopin", to }}
        myName={me.name}
        date={postDate(new Date(), tz)}
      />
    </>
  );
}
