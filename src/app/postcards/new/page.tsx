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
import { POSTCARD_FONTS_URL, RARE, isSitePhoto, openRareStamps, postDate } from "@/lib/postcards/catalog";
import { postcardPeople } from "@/lib/postcards/people";
import { Composer } from "./Composer";

export const metadata = { title: "Write a postcard", robots: { index: false } };

// Write a postcard. From a group, it starts from that trip: its place photos, "Greetings from Goa"
// (or the country, for a trip abroad), the country's stamp and the people in it.
export default async function NewPostcardPage({ searchParams }: { searchParams: Promise<{ group?: string; to?: string; from?: string; error?: string }> }) {
  const sp = await searchParams;
  const back = `/postcards/new?${new URLSearchParams({ ...(sp.group ? { group: sp.group } : {}), ...(sp.to ? { to: sp.to } : {}), ...(sp.from ? { from: sp.from } : {}) })}`;
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

  // Sending a card again: one you sent, with everything it had (pick new people for it).
  const again = sp.from ? await db.postcard.findFirst({ where: { id: sp.from, fromId: me.id } }) : null;
  if (again && !sp.group && again.groupId) sp.group = again.groupId;
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
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  const rare = openRareStamps(now).map((id) => {
    const [mm, dd] = RARE[id.slice(2)].to.split("-").map(Number);
    let y = now.getFullYear();
    if (new Date(y, mm - 1, dd) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) y++;
    return { id, until: fmt.format(new Date(y, mm - 1, dd)) };
  });
  let address: string[] | undefined;
  try {
    address = again ? (JSON.parse(again.address) as unknown[]).map(String).slice(0, 3) : undefined;
  } catch {
    address = undefined;
  }
  const reused = again
    ? {
        from: again.id,
        front: again.front,
        words: again.words,
        stamp: again.stamp,
        lettering: again.lettering,
        tone: again.tone,
        look: again.look,
        wordsAt: again.wordsAt,
        wordsSize: again.wordsSize,
        touches: again.touches,
        message: again.message,
        hand: again.hand,
        paper: again.paper,
        ink: again.ink,
        address: address ? ["", address[1] ?? "", address[2] ?? ""] : undefined,
        ownPhoto: again.front === "own" && again.photoId ? { id: again.photoId, url: `/api/postcard-photo/${again.photoId}` } : undefined,
      }
    : {};
  // From a group: its people first.
  const ordered = g ? [...groups.filter((x) => x.id === g.id), ...groups.filter((x) => x.id !== g.id)] : groups;

  return (
    <>
      <link rel="stylesheet" href={POSTCARD_FONTS_URL} precedence="default" />
      <PageHeader title={again ? "Send it again" : "Write a postcard"} back={again ? `/postcards/${again.id}` : g ? `/groups/${g.id}` : "/postcards"} />
      {sp.error && <ErrorNote>{sp.error}</ErrorNote>}
      <Composer
        groupId={g?.id ?? ""}
        groups={ordered}
        photos={photos}
        words={words}
        rare={rare}
        defaults={{ front, words: words[0] ?? "", stamp, place: again?.place || city || country || g?.name || "Loopin", to, ...reused }}
        myName={me.name}
        date={postDate(new Date(), tz)}
      />
    </>
  );
}
