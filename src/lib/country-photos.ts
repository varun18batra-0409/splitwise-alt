import { photoSet, placePhotos, placeSlot } from "./places";

// A photo for a country, where we have one, so the passport shows places and not letter codes.
// Slots are downloaded by scripts/fetch-photos.mjs at build. Where no photo downloaded (or the country has no slot) the answer
// is null and the screen draws the passport's own stamp on cream paper instead: never a wrong picture, never an empty box.

// Country code → photo slot. The first group reuses pictures the app already has; the rest are "country-xx" slots.
export const COUNTRY_SLOT: Record<string, string> = {
  TH: "place-thailand", ID: "place-bali", AE: "place-dubai", SG: "place-singapore", MV: "place-maldives", VN: "place-vietnam",
  LK: "place-srilanka", JP: "place-japan", GB: "place-london", NP: "place-nepal", US: "place-newyork", GR: "place-santorini",
  BT: "place-bhutan", CH: "place-switzerland", FR: "cover-paris", IN: "cover-taj",
  ...Object.fromEntries(
    "MY KH LA PH KR CN HK TW TR IT ES PT DE NL BE AT CZ HU HR IS NO SE DK FI IE PL CA MX BR AR PE AU NZ ZA KE TZ EG MA MU SC SA QA OM JO GE AZ UZ KZ"
      .split(" ")
      .map((c) => [c, `country-${c.toLowerCase()}`]),
  ),
};

type Have = Record<string, { src: string } | undefined>;

// The country's photo (an address under /photos), or null. `have` is for tests; the app uses the downloaded set.
export function countryPhoto(code: string, have?: Have): string | null {
  const slot = COUNTRY_SLOT[code.toUpperCase()];
  if (!slot) return null;
  return (have ? photoSet(slot, have) : photoSet(slot))[0] ?? null;
}

// The picture on a Been card.
//  - A trip: the place's photo, then its country's photo, then a mood photo (a beach, a city…).
//  - A country added by hand: only its own country photo; never a mood picture. None: the drawn panel.
export function cardPhoto(c: { kind: "trip" | "hand"; groupName: string; place: string; title: string; cities: string[]; code: string; countryName: string }, have?: Have): string | undefined {
  const slot = placeSlot(`${c.groupName} ${c.place}`) ?? placeSlot(c.title) ?? placeSlot(c.cities.join(" ")) ?? placeSlot(c.countryName);
  if (slot) {
    const own = (have ? photoSet(slot, have) : photoSet(slot))[0];
    if (own) return own;
  }
  const country = countryPhoto(c.code, have);
  if (country) return country;
  if (c.kind === "trip" && !have) return placePhotos(c.groupName, c.place, 1)[0];
  return undefined;
}

// The index page's rows with each country's picture filled in here on the server (the photo list never goes to the phone).
export function withCountryPhotos<T extends { code: string }>(rows: T[]): (T & { photo?: string })[] {
  return rows.map((r) => ({ ...r, photo: countryPhoto(r.code) ?? undefined }));
}
