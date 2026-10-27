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
  [/\b(dubai|abu ?dhabi|uae|emirates)\b/i, "place-dubai"],
  [/\b(manali|kasol|himachal|shimla|kullu|dharamshala|mcleodganj)\b/i, "place-manali"],
  [/\b(ladakh|leh|zanskar|pangong|spiti|nubra)\b/i, "place-ladakh"],
  [/\b(kerala|alleppey|alappuzha|munnar|kochi|cochin|varkala|wayanad|kumarakom)\b/i, "place-kerala"],
  [/\b(singapore)\b/i, "place-singapore"],
  [/\b(maldives)\b/i, "place-maldives"],
  [/\b(vietnam|hanoi|ha ?long|da ?nang|saigon|ho chi minh|hoi ?an)\b/i, "place-vietnam"],
  [/\b(sri ?lanka|colombo|kandy|galle|ceylon)\b/i, "place-srilanka"],
  [/\b(japan|tokyo|kyoto|osaka|hokkaido)\b/i, "place-japan"],
  [/\b(london|england|uk|scotland|edinburgh)\b/i, "place-london"],
  [/\b(jaipur|rajasthan|udaipur|jodhpur|jaisalmer|pushkar)\b/i, "place-jaipur"],
  [/\b(nepal|kathmandu|pokhara|everest|annapurna)\b/i, "place-nepal"],
  [/\b(andaman|havelock|port ?blair|neil island)\b/i, "place-andaman"],
  [/\b(rishikesh|haridwar|uttarakhand|mussoorie|auli)\b/i, "place-rishikesh"],
  [/\b(new ?york|nyc|manhattan|brooklyn)\b/i, "place-newyork"],
  [/\b(santorini|greece|mykonos|athens|greek)\b/i, "place-santorini"],
  [/\b(bhutan|thimphu|paro|punakha)\b/i, "place-bhutan"],
  [/\b(meghalaya|shillong|cherrapunji|dawki|northeast)\b/i, "place-meghalaya"],
  [/\b(switzerland|swiss|zurich|interlaken|zermatt|lucerne)\b/i, "place-switzerland"],
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
  "🚗": ["cover-road"],
  "✈️": ["cover-road", "cover-friends"],
};

const have = photos as Record<string, { src: string } | undefined>;

// Which picture (the downloaded file's address), or null when none is there.
export function placePhoto(tripName: string): { slot: string; src: string } | null {
  const tries = [...PLACES.filter(([re]) => re.test(tripName)).map(([, slot]) => slot), ...(MOOD[tripEmoji(tripName)] ?? []), "cover-friends"];
  for (const slot of tries) {
    const src = have[slot]?.src;
    if (src) return { slot, src };
  }
  return null;
}

// Which slot a name points at, before checking the download (for tests).
export function placeSlot(tripName: string): string | null {
  return PLACES.find(([re]) => re.test(tripName))?.[1] ?? null;
}

// Every picture of a slot that downloaded: the slot itself, then slot-2, slot-3…
export function photoSet(slot: string): string[] {
  const out: string[] = [];
  for (const k of [slot, ...Array.from({ length: 8 }, (_, i) => `${slot}-${i + 2}`)]) {
    const src = have[k]?.src;
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
