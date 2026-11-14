// Which photo goes on the stub of Home's money pass. Pure: the page hands in what it knows, this only chooses.
//
// The order (the first one that gives a photo wins):
//  a) money in a TRIP group: the trip where you owe the most (a side with nothing owed: where you're owed the most; a tie goes to
//     the trip with the most spending). A DIFFERENT photo of that trip's place than its polaroid cover: the first of its place
//     photos that is not the cover.
//  b) no trip money, but money in a flat or a couple: a warm home interior photo (the drawn home picture stays as the last
//     fallback: the caller gets null and keeps the group's own cover).
//  c) no trip and no flat money (all square, or only other kinds of groups): a country you've visited (newest first), then one
//     on your Want to go list, then
//  d) a good general travel photo.
// Never a photo in `avoid` (every polaroid cover on Home), so the stub never repeats the group's picture below it.

export type PassGroup = {
  id: string;
  type: string; // "trip" | "home" | "couple" | ...
  iOwe: boolean; // you pay someone here (even when no exchange rate lets the amount be counted)
  isOwed: boolean; // someone pays you here
  owe: number; // how much, in the common currency (0 when unknown): only used to rank
  owed: number;
  spend: number; // the group's total spending (common currency): the tie-break, "the largest expense"
  photos: string[]; // the place's photos (placePhotos), trips only
  cover?: string; // the photo this group's polaroid shows, when it shows a place photo
};

export type PassPhotoSource = "trip" | "flat" | "visited" | "want" | "general";
export type PassPhoto = { src: string; source: PassPhotoSource; groupId?: string };

export function passPhoto(x: {
  side: "owe" | "owed" | null; // the pass's side; null = the one card (what you owe first, else what you're owed)
  groups: PassGroup[]; // groups with money between you and someone
  avoid: string[]; // the photos already shown as polaroid covers
  interiors: string[]; // home interior photos (the "home" mood slots)
  visited: string[]; // country codes, newest first
  want: string[]; // country codes, newest first
  general: string[]; // general travel photos
  countryPhoto: (code: string) => string | null;
}): PassPhoto | null {
  const no = new Set(x.avoid);
  const sideOf = (g: PassGroup, s: "owe" | "owed") => (s === "owe" ? g.iOwe : g.isOwed);
  const amountOf = (g: PassGroup, s: "owe" | "owed") => (s === "owe" ? g.owe : g.owed);

  // The groups this pass is about, on its side. The one card: what you owe, and only if that is nothing, what you're owed.
  const sides: ("owe" | "owed")[] = x.side ? [x.side] : ["owe", "owed"];
  let side: "owe" | "owed" | null = null;
  let pool: PassGroup[] = [];
  for (const s of sides) {
    pool = x.groups.filter((g) => sideOf(g, s));
    if (pool.length) {
      side = s;
      break;
    }
  }

  if (side) {
    const s = side;
    const trips = pool
      .filter((g) => g.type === "trip")
      .sort((a, b) => amountOf(b, s) - amountOf(a, s) || b.spend - a.spend || a.id.localeCompare(b.id));
    for (const g of trips) {
      const src = g.photos.find((p) => p !== g.cover && !no.has(p));
      if (src) return { src, source: "trip", groupId: g.id };
    }
    if (trips.length === 0 && pool.some((g) => g.type === "home" || g.type === "couple")) {
      const src = x.interiors.find((p) => !no.has(p));
      return src ? { src, source: "flat" } : null; // null: the group's own (drawn home) picture
    }
  }

  for (const [list, source] of [[x.visited, "visited"], [x.want, "want"]] as const) {
    for (const code of list) {
      const src = x.countryPhoto(code);
      if (src && !no.has(src)) return { src, source };
    }
  }
  const src = x.general.find((p) => !no.has(p));
  return src ? { src, source: "general" } : null;
}
