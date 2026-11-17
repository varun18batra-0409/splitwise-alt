import photos from "../generated/photos.json"; // relative, so the test tools can load it too
import { tripEmoji } from "./countdown";

// The countdown's picture: the destination itself ("Thailand trip" → Maya Bay),
// so it doesn't repeat the group's own photo. Photos are downloaded with the
// app (free Unsplash photos), so trip names never go to an outside service.
// Not a known place → a photo that fits the mood (beach, mountains, city…).

const PLACES: [RegExp, string][] = [
  [/\b(goa|baga|calangute|anjuna|palolem)\b/i, "place-goa"],
  [/\b(thailand|phuket|krabi|bangkok|pattaya|phi ?phi|samui|chiang ?mai|thai)\b/i, "place-thailand"],
  [/\b(bali|ubud|seminyak|indonesia|nusa)\b/i, "place-bali"],
  [/\b(abu ?dhabi)\b/i, "place-abu-dhabi"],
  [/\b(dubai|abu ?dhabi|uae|emirates)\b/i, "place-dubai"],
  [/\b(manali|kasol|himachal|shimla|kullu|dharamshala|mcleodganj)\b/i, "place-manali"],
  [/\b(ladakh|leh|zanskar|pangong|spiti|nubra)\b/i, "place-ladakh"],
  [/\b(kerala|alleppey|alappuzha|munnar|kochi|cochin|varkala|wayanad|kumarakom)\b/i, "place-kerala"],
  [/\b(singapore)\b/i, "place-singapore"],
  [/\b(maldives)\b/i, "place-maldives"],
  [/\b(vietnam|hanoi|ha ?long|da ?nang|saigon|ho chi minh|hoi ?an)\b/i, "place-vietnam"],
  [/\b(sri ?lanka|colombo|kandy|galle|ceylon)\b/i, "place-srilanka"],
  // Kyoto first: its temples are place-kyoto; Tokyo, Osaka, Hokkaido and Japan itself show Tokyo (place-japan).
  [/\b(kyoto)\b/i, "place-kyoto"],
  [/\b(japan|tokyo|osaka|hokkaido)\b/i, "place-japan"],
  [/\b(edinburgh)\b/i, "place-edinburgh"],
  [/\b(london|england|uk|scotland|edinburgh)\b/i, "place-london"],
  [/\b(jaipur|rajasthan|jodhpur|pushkar)\b/i, "place-jaipur"],
  [/\b(nepal|kathmandu|pokhara|everest|annapurna)\b/i, "place-nepal"],
  [/\b(andaman|havelock|port ?blair|neil island)\b/i, "place-andaman"],
  [/\b(rishikesh|haridwar|uttarakhand|auli)\b/i, "place-rishikesh"],
  [/\b(new ?york|nyc|manhattan|brooklyn)\b/i, "place-newyork"],
  [/\b(athens|acropolis)\b/i, "place-athens"],
  [/\b(santorini|greece|mykonos|athens|greek)\b/i, "place-santorini"],
  [/\b(bhutan|thimphu|paro|punakha)\b/i, "place-bhutan"],
  [/\b(meghalaya|shillong|cherrapunji|dawki|northeast)\b/i, "place-meghalaya"],
  [/\b(switzerland|swiss|zurich|interlaken|zermatt|lucerne)\b/i, "place-switzerland"],
  [/\b(amritsar|golden temple)\b/i, "place-amritsar"],
  [/\b(alibaug|alibag|kashid)\b/i, "place-alibaug"],
  [/\b(ahmedabad|gujarat)\b/i, "place-ahmedabad"],
  [/\b(chikmagalur|chikkamagaluru|kudremukh)\b/i, "place-chikmagalur"],
  [/\b(coorg|kodagu|madikeri)\b/i, "place-coorg"],
  [/\b(darjeeling|kalimpong)\b/i, "place-darjeeling"],
  [/\b(delhi|new delhi|ncr|gurgaon|gurugram|noida)\b/i, "place-delhi"],
  [/\b(gokarna|gokarn)\b/i, "place-gokarna"],
  [/\b(hampi)\b/i, "place-hampi"],
  [/\b(hyderabad|secunderabad)\b/i, "place-hyderabad"],
  [/\b(jaisalmer|thar)\b/i, "place-jaisalmer"],
  [/\b(kashmir|srinagar|gulmarg|pahalgam|sonmarg)\b/i, "place-kashmir"],
  [/\b(kodaikanal|kodai)\b/i, "place-kodaikanal"],
  [/\b(kolkata|calcutta)\b/i, "place-kolkata"],
  [/\b(kutch|kachchh|rann)\b/i, "place-kutch"],
  [/\b(lonavala|lonavla|khandala|lavasa|karjat|igatpuri)\b/i, "place-lonavala"],
  [/\b(mahabaleshwar|panchgani)\b/i, "place-mahabaleshwar"],
  [/\b(matheran)\b/i, "place-matheran"],
  [/\b(mumbai|bombay)\b/i, "place-mumbai"],
  [/\b(mussoorie|dehradun|landour)\b/i, "place-mussoorie"],
  [/\b(mysore|mysuru)\b/i, "place-mysore"],
  [/\b(nainital|bhimtal|almora|ranikhet)\b/i, "place-nainital"],
  [/\b(ooty|udhagamandalam|coonoor|nilgiris?)\b/i, "place-ooty"],
  [/\b(pondicherry|puducherry|pondy|auroville)\b/i, "place-pondicherry"],
  [/\b(pune|poona)\b/i, "place-pune"],
  [/\b(sikkim|gangtok|pelling|lachung)\b/i, "place-sikkim"],
  [/\b(udaipur)\b/i, "place-udaipur"],
  [/\b(varanasi|banaras|benares|kashi)\b/i, "place-varanasi"],
  [/\b(corbett|jim corbett|ramnagar)\b/i, "place-corbett"],
  // Top destinations. Every rule uses word edges. No bare "la" (Los Angeles needs its full name), no bare "dc", and "Portland" means Oregon.
  // The wider rules above still come first, so a name with an Indian place keeps its old photo. Specific places come before regions.
  [/\b(san francisco|golden gate|bay area)\b/i, "place-san-francisco"],
  [/\b(los angeles|hollywood|santa monica|malibu)\b/i, "place-los-angeles"],
  [/\b(las vegas|vegas)\b/i, "place-las-vegas"],
  [/\b(miami|south beach)\b/i, "place-miami"],
  [/\b(chicago)\b/i, "place-chicago"],
  [/\b(washington,? d\.?c|d\.c)\b/i, "place-washington-dc"],
  [/\b(boston)\b/i, "place-boston"],
  [/\b(seattle)\b/i, "place-seattle"],
  [/\b(grand canyon)\b/i, "place-grand-canyon"],
  [/\b(yellowstone)\b/i, "place-yellowstone"],
  [/\b(yosemite)\b/i, "place-yosemite"],
  [/\b(moab|arches national park)\b/i, "place-moab-arches"],
  [/\b(maui|lahaina|kaanapali)\b/i, "place-maui"],
  [/\b(honolulu|oahu|waikiki|hawaii)\b/i, "place-honolulu-oahu"],
  [/\b(new orleans|nola)\b/i, "place-new-orleans"],
  [/\b(nashville)\b/i, "place-nashville"],
  [/\b(charleston)\b/i, "place-charleston"],
  [/\b(san diego)\b/i, "place-san-diego"],
  [/\b(orlando|walt disney world)\b(?!['’]s\b)/i, "place-orlando"],
  [/\b(austin)\b(?!['’]s\b)/i, "place-austin"],
  [/\b(zion)\b/i, "place-zion"],
  [/\b(alaska|anchorage|denali)\b/i, "place-alaska"],
  [/\b(napa valley|napa)\b/i, "place-napa"],
  [/\b(lake tahoe|tahoe)\b/i, "place-lake-tahoe"],
  [/\b(aspen)\b/i, "place-aspen"],
  [/\b(philadelphia|philly)\b/i, "place-philadelphia"],
  [/\b(savannah)\b(?!['’]s\b)/i, "place-savannah"],
  [/\b(sedona)\b/i, "place-sedona"],
  [/\b(portland|mt hood|mount hood)\b/i, "place-portland"],
  [/\b(atlanta)\b/i, "place-atlanta"],
  [/\b(houston)\b(?!['’]s\b)/i, "place-houston"],
  [/\b(dallas)\b(?!['’]s\b)/i, "place-dallas"],
  [/\b(phoenix)\b(?!['’]s\b)/i, "place-phoenix"],
  [/\b(niagara)\b/i, "place-niagara"],
  [/\b(big sur)\b/i, "place-big-sur"],
  [/\b(rome|vatican)\b/i, "place-rome"],
  [/\b(venice|venezia)\b/i, "place-venice"],
  [/\b(florence|firenze)\b/i, "place-florence"],
  [/\b(amalfi|positano|sorrento)\b/i, "place-amalfi"],
  [/\b(barcelona)\b/i, "place-barcelona"],
  [/\b(madrid)\b/i, "place-madrid"],
  [/\b(lisbon|lisboa)\b/i, "place-lisbon"],
  [/\b(porto|oporto)\b/i, "place-porto"],
  [/\b(dubrovnik)\b/i, "place-dubrovnik"],
  [/\b(istanbul)\b/i, "place-istanbul"],
  [/\b(cappadocia|goreme)\b/i, "place-cappadocia"],
  [/\b(amsterdam)\b/i, "place-amsterdam"],
  [/\b(prague|praha)\b/i, "place-prague"],
  [/\b(vienna|wien)\b/i, "place-vienna"],
  [/\b(budapest)\b/i, "place-budapest"],
  [/\b(berlin)\b/i, "place-berlin"],
  [/\b(munich|münchen)\b/i, "place-munich"],
  [/\b(iceland|reykjavik)\b/i, "place-iceland"],
  [/\b(copenhagen)\b/i, "place-copenhagen"],
  [/\b(stockholm)\b/i, "place-stockholm"],
  [/\b(norway|oslo|bergen|fjords?|tromso|lofoten)\b/i, "place-norway-fjords"],
  [/\b(doha|qatar)\b/i, "place-doha"],
  [/\b(cairo|giza|pyramids)\b/i, "place-cairo-giza"],
  [/\b(marrakech|marrakesh)\b/i, "place-marrakech"],
  [/\b(cape town)\b/i, "place-cape-town"],
  [/\b(seoul)\b/i, "place-seoul"],
  [/\b(hong ?kong)\b/i, "place-hong-kong"],
  [/\b(kuala lumpur)\b/i, "place-kuala-lumpur"],
  [/\b(sydney)\b(?!['’]s\b)/i, "place-sydney"],
  [/\b(melbourne)\b/i, "place-melbourne"],
  [/\b(queenstown)\b/i, "place-queenstown"],
  [/\b(toronto)\b/i, "place-toronto"],
  [/\b(vancouver)\b/i, "place-vancouver"],
  [/\b(banff|lake louise)\b/i, "place-banff"],
  [/\b(mexico city|cdmx|ciudad de mexico)\b/i, "place-mexico-city"],
  [/\b(cancun|cancún|tulum|playa del carmen|riviera maya)\b/i, "place-cancun-tulum"],
  [/\b(rio de janeiro|rio)\b/i, "place-rio"],
  [/\b(machu picchu|cusco|cuzco|inca trail)\b/i, "place-machu-picchu"],
  [/\b(paris|france)\b/i, "cover-paris"],
  [/\b(agra|taj)\b/i, "cover-taj"],
];

// By the trip's emoji (its mood), when the place isn't one we know.
const MOOD: Record<string, string[]> = {
  "🌴": ["cover-beach"],
  "❄️": ["cover-snow", "cover-mountains"],
  "🏔️": ["cover-mountains", "cover-lake"],
  "🏕️": ["cover-forest", "cover-lake"],
  "💍": ["cover-wedding"],
  "🎶": ["cover-party"],
  "🌆": ["cover-city"],
  // Not a place we know: a road in the Indian hills, or friends together (never the US desert road).
  "🚗": ["cover-road-in", "cover-friends"],
  "✈️": ["cover-friends"],
};

const have = photos as Record<string, { src: string } | undefined>;

// A small stable number from text (the same text always gives the same number), to choose among a place's photos.
function stableHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// One of `list`, chosen by the seed (a group's id): always the same one for the same seed, and different groups usually differ.
export function pickBySeed<T>(list: T[], seed: string): T | undefined {
  return list.length ? list[stableHash(seed) % list.length] : undefined;
}

// Which picture (the downloaded file's address), or null when none is there.
// `seed` (a group's id): the place has several photos, so the group gets one of them by a stable hash of its id, the same one every
// time. Without a seed the place's first photo is used (as before).
export function placePhoto(tripName: string, seed?: string, from: Record<string, { src: string } | undefined> = have): { slot: string; src: string } | null {
  const tries = [...PLACES.filter(([re]) => re.test(tripName)).map(([, slot]) => slot), ...(MOOD[tripEmoji(tripName)] ?? []), "cover-friends"];
  for (const slot of tries) {
    const set = photoSet(slot, from);
    const src = seed ? pickBySeed(set, `${slot}:${seed}`) : set[0];
    if (src) return { slot, src };
  }
  return null;
}

// The real photo a trip's picture (polaroid, ticket stub, countdown thumb, hero) shows instead of drawn art, or undefined.
// The place is read from the name AND "Where to?" (the same text the story ring uses), so "Boys trip" to Manali gets Manali.
//  - the group's own photo, a photo picked on purpose, or "plain": left alone;
//  - no picture chosen: the place photo (a mood or friends photo when the place isn't known, as before);
//  - a drawn picture stored on the group (e.g. the sunset beach): replaced by the photo only when the place is known.
// Flats, couples and game nights are never given one.
export function tripPhotoSrc(g: { name: string; type?: string | null; cover?: string | null; coverAt?: Date | null; tripPlace?: string | null; id?: string }, from?: Record<string, { src: string } | undefined>): string | undefined {
  if (g.type !== "trip") return undefined;
  const text = `${g.name} ${g.tripPlace ?? ""}`;
  const c = g.cover ?? "";
  if (c === "plain" || c.startsWith("photo-") || (c === "own" && g.coverAt)) return undefined;
  if (c === "" || c === "own") return placePhoto(text, g.id, from)?.src;
  return placeSlot(text) ? placePhoto(text, g.id, from)?.src : undefined;
}

// Which slot a name points at, before checking the download (for tests).
export function placeSlot(tripName: string): string | null {
  return PLACES.find(([re]) => re.test(tripName))?.[1] ?? null;
}

// Every picture of a slot that downloaded: the slot itself, then slot-2, slot-3…
// (`from` lets a test hand in its own list of downloaded photos.)
export function photoSet(slot: string, from: Record<string, { src: string } | undefined> = have): string[] {
  const out: string[] = [];
  for (const k of [slot, ...Array.from({ length: 8 }, (_, i) => `${slot}-${i + 2}`)]) {
    const src = from[k]?.src;
    if (src && !out.includes(src)) out.push(src);
  }
  return out;
}

// Up to `max` pictures for a trip's story: the place (from its name or Where to?),
// then pictures that fit its mood, then friends together.
export function placePhotos(tripName: string, place = "", max = 6): string[] {
  const text = `${tripName} ${place}`;
  const slots = [...PLACES.filter(([re]) => re.test(text)).map(([, slot]) => slot), ...(MOOD[tripEmoji(tripName)] ?? []), "cover-friends", "friends", "hero"];
  const out: string[] = [];
  for (const slot of slots) for (const src of photoSet(slot)) if (out.length < max && !out.includes(src)) out.push(src);
  return out;
}

// Pictures for a card night.
export const cardPhotos = () => photoSet("cards");
