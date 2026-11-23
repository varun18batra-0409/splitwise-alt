import { tripEmoji, type TripPhase } from "../countdown";
import { placeSlot } from "../places";
import { seedNum, storyLines } from "./story-lines";
import { lineForPhoto } from "./photo-tags";
import { countsLine } from "../collect-rules";

// Home's stories: the moments in your groups, not the numbers. A trip coming
// up (or happening now), last night's card game, a group that just got all
// square, a collection filling up, a trip from a year ago, a fresh Wrapped.
// Each story is 4–6 slides you tap through (photos of the place, a few
// playful numbers, the crew), with one thing to do next. Pure, so it can be tested.

export type StoryKind = "trip" | "pot" | "square" | "collect" | "memory" | "wrapped" | "moment";
export type Tone = "sun" | "coral" | "sky" | "pink" | "lilac" | "mint";
// One slide: a full photo with words, a bold poster, or a short list.
export type Frame =
  | { kind: "photo"; photo: string; kicker?: string; head: string; line?: string; calm?: boolean } // calm: a person's own words (a moment), set smaller and plain
  | { kind: "art"; art: StoryKind; kicker?: string; head: string; line?: string } // designed artwork (card night, collection…) instead of a photo
  | { kind: "poster"; tone: Tone; kicker: string; big: string; line?: string; photo?: string } // photo: the place's picture behind the words, under a dark layer
  | { kind: "list"; tone: Tone; kicker: string; rows: { label: string; value?: string; good?: boolean; bad?: boolean; share?: number }[]; line?: string };

export type Story = {
  id: string; // stable for "seen" (changes when the story changes, e.g. the day count)
  kind: StoryKind;
  label: string; // the full name: "Goa", "Teacher’s Day gift" (the viewer's header, and the full name for screen readers)
  short: string; // under the little picture on Home: the story's kind and group in a few words ("Goa", "Game night", "Collection")
  headline: string; // the story in one line (also read out to screen readers)
  line: string;
  cta: string;
  href: string;
  photo?: string; // the little picture on Home
  cover?: { kind: string; src?: string }; // the group's own picture
  art?: StoryKind; // designed artwork for the little picture, when there's no photo
  emoji: string; // when there's no picture
  big?: string; // the poster's big words when there's no picture ("3 days", "2/5")
  frames: Frame[];
  at: number; // when it happened (for ordering)
};

type Pic = { photo?: string; photos?: string[]; cover?: { kind: string; src?: string } };
export type StoryInput = {
  now: Date;
  home?: string; // the viewer's own country (ISO code): trips at home don't say "new stamp" or "learn the local word"
  trips: ({ id: string; name: string; phase: TripPhase; people: number; couple?: boolean; month?: number; stop?: { city?: string; country?: string; countryName?: string; flag?: string }; crew?: string[]; mood?: "beach" | "hills" | "city" | "any"; today?: { spent: string; count: number; top?: string; biggest?: { what: string; amount: string } } } & Pic)[];
  games: { id: string; groupId: string; name: string; winner: string; won: string; youWon?: string; finishedAt: Date; table?: { name: string; net: string; up: boolean; even: boolean; share: number }[]; pays?: string[]; toSettle?: string; photos?: string[] }[];
  squared: ({ id: string; name: string; at: Date; spent?: string; payments?: number; people?: number } & Pic)[];
  collections: { id: string; code: string; title: string; paid: number; checked?: number; people: number; in?: string; reported?: string; target?: string; paidNames?: string[]; reportedNames?: string[]; dueNames?: string[] }[];
  memories: ({ id: string; name: string; years: number; people: number; days: number; spent?: string; crew?: string[] } & Pic)[];
  wrapped: ({ id: string; name: string; endedDaysAgo: number; spent?: string; topCategory?: string } & Pic)[];
  // New moments in a trip group (the last 3 days, only ones this person may see: src/lib/moments-db.ts loadMomentStoryGroups).
  // `frames` newest first; `thumb` is the small copy, `full` the photo.
  moments?: { groupId: string; groupName: string; newestId: string; at: Date; frames: { id: string; thumb: string; full: string; kicker: string; head: string; line: string }[] }[];
};

const place = (name: string) => name.replace(/\s+trip$/i, "").trim() || name;

// The words that every trip story has in the same place. Each has a few versions: the version moves on day by day, and two trips on the
// same Home at the same stage get different ones (22 Nov: "never the same words in two live stories").
export const STAGE_LINES = {
  far: ["Mark it in your calendar", "Plenty of time. Book the good stuff early.", "Somebody start the group chat", "Leave approved? Good. Now the tickets."],
  month: ["Start the packing list", "Who's booking what? Add it to Loopin.", "Sort the bookings, then the outfits", "Make a list. Lose the list. Make another."],
  week: (people: number, days: number) => [`${people} of you, ${days} sleeps to go`, `${days} sleeps. Somebody's already packed.`, `${days} more days. The group chat is buzzing.`],
  tomorrow: ["Tomorrow! Charge your phone 🔋", "Tomorrow! Power bank charged? 🔋", "Tomorrow! Phone, charger, power bank 🔋"],
  today: ["Bags packed? It starts today ✈️", "Today's the day. Don't miss the ride ✈️", "It starts today. Tickets handy? ✈️"],
  during: ["Keep the receipts coming", "Add today's spends before bed", "Who's buying breakfast?"],
  last: ["Last day. Make it count 🌅", "Last day. One more sunset? 🌅", "Last day. Settle up on the way home 🌅"],
  posterSoon: ["Not that anyone's counting 👀", "But who's counting? 👀", "Not that we're excited 👀"],
  posterLater: ["Time to start packing", "The countdown is on", "Plenty of time. Or is there?"],
  bookings: ["Add bookings now, sort the money later", "Paid for something? Add it while you remember", "Every booking in Loopin, no maths later"],
  addIt: ["Add it now, settle it later", "Snap the bill, add it now", "Add it before anyone forgets who paid"],
  crew: (n: number) => [`${n} of you. Dangerous.`, `${n} of you. One group chat.`, `${n} of you. Many opinions.`],
  spent: ["The night is young.", "Still counting.", "And the day's not over."],
  quiet: ["Suspiciously quiet… 👀", "Nothing yet. Suspicious 👀", "A quiet day. Or a forgetful one? 👀"],
  top: ["Somebody buy them a drink 🍹", "Next round's on everyone else 🍹", "Window seat and a drink for them 🍹"],
};
const one = (list: string[], v: number) => list[((v % list.length) + list.length) % list.length];

// A playful line for each stage of the countdown (`v` picks the version).
function tripLine(p: TripPhase, people: number, v = 0): string {
  if (p.kind === "today") return one(STAGE_LINES.today, v);
  if (p.kind === "during") return p.day === p.of ? one(STAGE_LINES.last, v) : `Day ${p.day} of ${p.of}. ${one(STAGE_LINES.during, v)}`;
  if (p.kind === "before" && p.days === 1) return one(STAGE_LINES.tomorrow, v);
  if (p.kind === "before" && p.days <= 7) return one(STAGE_LINES.week(people, p.days), v);
  if (p.kind === "before" && p.days <= 30) return one(STAGE_LINES.month, v);
  return one(STAGE_LINES.far, v);
}

// The countdown slide: the trip's own photo behind the number (when there is one), "Sleeps to Manali", and a line that says what to do.
export function countdownPoster(days: number, where: string, photo?: string, v = 0): Frame {
  return { kind: "poster", tone: "sun", kicker: `${days === 1 ? "Sleep" : "Sleeps"} to ${where}`, big: String(days), line: one(days <= 3 ? STAGE_LINES.posterSoon : STAGE_LINES.posterLater, v), ...(photo ? { photo } : {}) };
}

// A number that goes up by one each day of a trip's countdown and stay (the lines move on with it).
const dayNumber = (p: TripPhase) => (p.kind === "before" ? 100 - p.days : p.kind === "today" ? 100 : p.kind === "during" ? 100 + p.day : 0);

// `used` is shared by every story on the Home, so no two live stories show the same line; `v` is this trip's version of the fixed words.
function tripFrames(t: StoryInput["trips"][number], used: Set<string>, v: number, home?: string): Frame[] {
  const p = t.phase;
  const where = place(t.name);
  const photos = t.photos?.length ? t.photos : t.photo ? [t.photo] : [];
  const day = dayNumber(p);
  // Lines for this place, this kind of trip and this crew; they take turns day by day, written for the place, not the photo.
  const caps = storyLines({ month: t.month, place: placeSlot(`${t.name} ${t.stop?.city ?? ""}`), placeText: `${t.name} ${t.stop?.city ?? ""}`, home, couple: t.couple, country: t.stop?.country, countryName: t.stop?.countryName, flag: t.stop?.flag, city: t.stop?.city, mood: t.mood, people: t.people, seed: t.id, day, step: p.kind === "before" ? 2 : 1, avoid: used, n: 8 });
  // A slide's words: the place's own lines on most slides, and on the middle one a line that fits its photo when we know what's in it
  // (a sunset line on a sunset). Never a line that is already on this story or another live story.
  const fromCaps = () => caps.find((c) => !used.has(c[1])) ?? null;
  const fromPhoto = (src?: string, k = 0) => (src ? lineForPhoto(src, seedNum(t.id) + day + k, used) : null);
  const cap = (k: number, photoIndex?: number): [string, string] => {
    const src = photoIndex != null && photos.length ? photos[photoIndex % photos.length] : undefined;
    const c = (k % 2 === 1 ? fromPhoto(src, k) ?? fromCaps() : fromCaps() ?? fromPhoto(src, k)) ?? caps[k % Math.max(1, caps.length)] ?? ["Trip mode", where];
    used.add(c[1]);
    return c;
  };
  const photo = (k: number, kicker: string | undefined, head: string, line?: string): Frame | null => (photos.length ? { kind: "photo", photo: photos[k % photos.length], kicker, head, line } : null);
  const crew: Frame | null = t.crew && t.crew.length > 1 ? { kind: "list", tone: "sky", kicker: "The crew", rows: t.crew.slice(0, 8).map((n) => ({ label: n })), line: t.crew.length > 8 ? `and ${t.crew.length - 8} more` : one(STAGE_LINES.crew(t.crew.length), v) } : null;
  const out: (Frame | null)[] = [];
  if (p.kind === "before") {
    out.push(photo(0, p.days === 1 ? "Tomorrow" : `In ${p.days} days`, where, tripLine(p, t.people, v)));
    out.push(countdownPoster(p.days, where, photos[0], v));
    { const c = cap(0, 1); out.push(photo(1, c[0], c[1])); }
    out.push(crew);
    { const c = cap(1, 2); out.push(photo(2, c[0], c[1])); }
    { const c = cap(2, 3); out.push(photo(3, c[0], c[1], one(STAGE_LINES.bookings, v))); }
  } else {
    const d = t.today;
    // The day is said once: "Goa · day 2 of 5", with the playful line under it (no "Day 2" label above, no "Day 2 of 5" repeated below).
    out.push(
      p.kind === "during"
        ? photo(0, undefined, `${where} · day ${p.day} of ${p.of}`, p.day === p.of ? one(STAGE_LINES.last, v).replace(/ 🌅$/, "") : one(STAGE_LINES.during, v))
        : photo(0, p.kind === "today" ? "Today" : "Day 1", p.kind === "today" ? `${where} starts today` : `${where}, day 1`, tripLine(p, t.people, v)),
    );
    out.push(
      d && d.count > 0
        ? { kind: "poster", tone: "coral", kicker: "Spent today", big: d.spent, line: `${d.count} ${d.count === 1 ? "expense" : "expenses"} so far. ${one(STAGE_LINES.spent, v)}` }
        : { kind: "poster", tone: "coral", kicker: "Spent today", big: "Nothing", line: one(STAGE_LINES.quiet, v) },
    );
    if (d?.top) out.push({ kind: "poster", tone: "mint", kicker: "Carrying the team today", big: d.top, line: one(STAGE_LINES.top, v) });
    { const c = cap(0, 1); out.push(photo(1, c[0], c[1])); }
    if (d?.biggest) out.push({ kind: "poster", tone: "pink", kicker: "Biggest bill today", big: d.biggest.amount, line: d.biggest.what });
    out.push(crew);
    { const c = cap(1, 2); out.push(photo(2, c[0], c[1], one(STAGE_LINES.addIt, v))); }
  }
  const frames = out.filter((f): f is Frame => Boolean(f)).slice(0, 6);
  return frames.length ? frames : [{ kind: "poster", tone: "sky", kicker: where, big: p.kind === "before" ? `${p.days} days` : "Today", line: tripLine(p, t.people, v) }];
}

export function buildStories(i: StoryInput): Story[] {
  const out: Story[] = [];
  const now = i.now.getTime();
  const used = new Set<string>(); // every line already on a live trip story
  // The version of the fixed words: today's date plus the trip's place in the row, so live trips always get different versions
  // (up to 3 trips at once) and every trip moves on to the next version tomorrow.
  const today = Math.floor(now / 86_400_000);
  let nth = 0;
  for (const t of i.trips) {
    const p = t.phase;
    if (p.kind === "after" || (p.kind === "before" && p.days > 60)) continue;
    const v = today + nth++;
    const head = p.kind === "before" ? (p.days === 1 ? `${place(t.name)} tomorrow` : `${place(t.name)} in ${p.days} days`) : p.kind === "today" ? `${place(t.name)} starts today` : `${place(t.name)}, day ${p.day}`;
    const key = p.kind === "before" ? `b${p.days}` : p.kind === "during" ? `d${p.day}` : "t";
    out.push({
      id: `trip-${t.id}-${key}`,
      kind: "trip",
      label: place(t.name),
      short: place(t.name),
      headline: head,
      line: tripLine(p, t.people, v),
      cta: p.kind === "before" ? "Open the trip" : "Add an expense",
      href: p.kind === "before" ? `/groups/${t.id}` : `/groups/${t.id}/add`,
      photo: t.photos?.[0] ?? t.photo,
      cover: t.cover,
      emoji: "✈️",
      big: p.kind === "before" ? (p.days === 1 ? "Tomorrow" : `${p.days} days`) : p.kind === "today" ? "Today" : `Day ${p.day}`,
      frames: tripFrames(t, used, v, i.home),
      // Happening now first, then the soonest.
      at: now + (p.kind === "before" ? -p.days * 3_600_000 : 86_400_000),
    });
  }
  for (const w of i.wrapped) {
    const photos = w.photos?.length ? w.photos : w.photo ? [w.photo] : [];
    const frames: Frame[] = [
      ...(photos[0] ? [{ kind: "photo", photo: photos[0], kicker: "Just in", head: `${place(w.name)}, wrapped`, line: "The trip, told in slides" } as Frame] : []),
      ...(w.spent ? [{ kind: "poster", tone: "sun", kicker: "Together you spent", big: w.spent, line: "Was it worth it? Discuss." } as Frame] : []),
      ...(w.topCategory ? [{ kind: "poster", tone: "coral", kicker: "Most of it went on", big: w.topCategory, line: "No regrets. Mostly." } as Frame] : []),
      { kind: "poster", tone: "lilac", kicker: "Also inside", big: "Awards", line: "Who's the Banker? Who's the Snack Lord? Find out." },
      ...(photos[1] ? [{ kind: "photo", photo: photos[1], kicker: "Ready when you are", head: "Watch the whole thing", line: "Then share it to the group" } as Frame] : []),
    ];
    out.push({ id: `wrapped-${w.id}`, kind: "wrapped", label: place(w.name), short: "Wrapped", headline: `${place(w.name)}, wrapped`, line: "Who paid most, the biggest night and more", cta: "Watch it", href: `/groups/${w.id}/wrapped`, photo: photos[0], cover: w.cover, emoji: "🎬", big: "Wrapped", frames, at: now - w.endedDaysAgo * 86_400_000 + 3_600_000 });
  }
  for (const g of i.games) {
    if (now - g.finishedAt.getTime() > 3 * 86_400_000) continue;
    const headline = g.youWon ? `You came out ahead by ${g.youWon}` : g.winner ? `${g.winner} came out ahead by ${g.won}` : "Everyone broke even";
    // Game nights get their own artwork (green felt, gold, the cards), never a stock photo.
    const frames: Frame[] = [
      { kind: "art", art: "pot", kicker: g.name, head: g.youWon ? `You came out ahead by ${g.youWon}` : g.winner ? `${g.winner} came out ahead` : "Everyone broke even", line: g.youWon ? "Drinks are on you, apparently" : g.winner ? `${g.won} up. Insufferable now.` : "Nobody up. Nobody down. Suspicious." },
      ...(g.table && g.table.length > 1 ? [{ kind: "list", tone: "mint", kicker: "The table", rows: g.table.slice(0, 8).map((r) => ({ label: r.name, value: r.net, good: r.up && !r.even, bad: !r.up && !r.even, share: r.share })) } as Frame] : []),
      ...(g.pays && g.pays.length ? [{ kind: "list", tone: "sun", kicker: "Who pays whom", rows: g.pays.slice(0, 6).map((l) => ({ label: l })), line: g.pays.length > 6 ? `and ${g.pays.length - 6} more` : "Square up, everyone" } as Frame] : []),
      { kind: "poster", tone: g.toSettle ? "coral" : "sky", kicker: g.toSettle ? "Still to settle" : "Settled", big: g.toSettle ?? "All square ✓", line: g.toSettle ? "Mark it paid in the game" : "Clean books. Respect." },
      { kind: "art", art: "pot", kicker: "Next time", head: "Same table, next week?", line: "Bring snacks. And your game face." },
    ];
    out.push({
      id: `pot-${g.id}`,
      kind: "pot",
      short: "Game night",
      label: g.name.length > 14 ? `${g.name.slice(0, 13)}…` : g.name,
      headline,
      line: g.name,
      cta: "See who pays whom",
      href: `/groups/${g.groupId}/pot/${g.id}`,
      art: "pot",
      emoji: "🃏",
      big: g.youWon ?? (g.won || "Even"),
      frames,
      at: g.finishedAt.getTime(),
    });
  }
  for (const s of i.squared) {
    if (now - s.at.getTime() > 3 * 86_400_000) continue;
    const photos = s.photos?.length ? s.photos : s.photo ? [s.photo] : [];
    const frames: Frame[] = [
      photos[0] ? { kind: "photo", photo: photos[0], kicker: "Breaking news", head: `${place(s.name)} is all square`, line: "Nobody owes anybody. Nice one 🎉" } : { kind: "art", art: "square", kicker: "Breaking news", head: `${place(s.name)} is all square`, line: "Nobody owes anybody. Nice one." },
      ...(s.spent ? [{ kind: "poster", tone: "sun", kicker: "Spent together", big: s.spent, line: s.people ? `Split ${s.people} ways, without a single fight*` : "Without a single fight*" } as Frame] : []),
      ...(s.payments ? [{ kind: "poster", tone: "sky", kicker: "Payments it took", big: String(s.payments), line: "*that we know of" } as Frame] : []),
      ...(photos[1] ? [{ kind: "photo", photo: photos[1], kicker: "Bragging rights", head: "Share it with the group", line: "Friendships: intact ✓" } as Frame] : []),
    ];
    out.push({ id: `square-${s.id}-${s.at.getTime()}`, kind: "square", label: place(s.name), short: place(s.name), headline: `${place(s.name)} is all square`, line: "Nobody owes anybody. Nice one 🎉", cta: "Share it", href: `/groups/${s.id}/square`, photo: photos[0], cover: s.cover, art: "square", emoji: "🎉", big: "All square", frames, at: s.at.getTime() });
  }
  for (const c of i.collections) {
    if (c.people === 0) continue;
    // "Everyone's in" only once the organiser has checked every payment; people saying they paid is not the same thing.
    const checked = c.checked ?? 0;
    const all = checked === c.people;
    const counts = countsLine({ paidCount: c.paid, people: c.people, checked });
    const frames: Frame[] = [
      { kind: "art", art: "collect", kicker: c.title, head: all ? "Everyone’s in" : c.paid === 0 ? "No one yet" : `${c.paid} of ${c.people} say they’ve paid`, line: all ? "Time to close it" : c.paid === 0 ? "Who’s going first?" : "The jar is filling up" },
      ...(c.in && c.target ? [{ kind: "poster", tone: "coral", kicker: "Checked", big: c.in, line: `of ${c.target}${c.reported ? ` · ${c.reported} says paid` : ""}` } as Frame] : []),
      ...((c.paidNames?.length || c.reportedNames?.length || c.dueNames?.length)
        ? [{ kind: "list", tone: "mint", kicker: "Roll call", rows: [...(c.paidNames ?? []).slice(0, 5).map((n) => ({ label: n, value: "Checked ✓", good: true })), ...(c.reportedNames ?? []).slice(0, 5).map((n) => ({ label: n, value: "Says paid", good: false })), ...(c.dueNames ?? []).slice(0, 5).map((n) => ({ label: n, value: "Not yet", bad: true }))], line: (c.dueNames?.length ?? 0) > 0 ? "A gentle nudge might help" : "Legends, all of them" } as Frame]
        : []),
    ];
    out.push({
      id: `collect-${c.id}-${c.paid}-${checked}`,
      kind: "collect",
      short: "Collection",
      label: c.title.length > 14 ? `${c.title.slice(0, 13)}…` : c.title,
      headline: all ? `${c.title}: everyone’s in` : `${c.title}: ${counts}`,
      line: all ? "Time to close it" : c.paid === 0 ? "Share the link to get it going" : "Nearly there. A nudge might help",
      cta: "Open the collection",
      href: `/c/${c.code}`,
      art: "collect",
      emoji: "🪙",
      big: `${checked}/${c.people}`,
      frames,
      at: now - 2 * 86_400_000,
    });
  }
  for (const m of i.memories) {
    const photos = m.photos?.length ? m.photos : m.photo ? [m.photo] : [];
    const ago = m.years === 1 ? "A year ago" : `${m.years} years ago`;
    const mark = tripEmoji(m.name); // the trip's own emoji (a palm only for a beach), not always 🌴
    const solo = m.people <= 1; // the head count is people still in the group: one person is "Just you", never "1 of you"
    const together = solo ? "Just you" : `${m.people} of you`;
    const frames: Frame[] = [
      photos[0] ? { kind: "photo", photo: photos[0], kicker: `${ago} today`, head: place(m.name), line: `Remember this? ${mark}` } : { kind: "poster", tone: "coral", kicker: `${ago} today`, big: place(m.name), line: `Remember this? ${mark}` },
      { kind: "poster", tone: "sun", kicker: "The trip", big: `${m.days} ${m.days === 1 ? "day" : "days"}`, line: `${together}. Zero regrets.` },
      ...(m.spent ? [{ kind: "poster", tone: "pink", kicker: "Spent together", big: m.spent, line: "Money well spent, obviously" } as Frame] : []),
      ...(m.crew && m.crew.length > 1 ? [{ kind: "list", tone: "sky", kicker: "Who was there", rows: m.crew.slice(0, 8).map((n) => ({ label: n })), line: "Time for a sequel?" } as Frame] : []),
      ...(photos[1] ? [{ kind: "photo", photo: photos[1], kicker: "Same time next year?", head: "Plan the sequel", line: "The group chat is waiting" } as Frame] : []),
    ];
    out.push({
      id: `memory-${m.id}-${m.years}`,
      kind: "memory",
      label: place(m.name),
      short: m.years === 1 ? "A year ago" : `${m.years} yrs ago`,
      headline: `${ago}: ${place(m.name)}`,
      line: `${together}${m.days > 1 ? `, ${m.days} days` : ""}. Remember that? ${mark}`,
      cta: "Relive it",
      href: `/groups/${m.id}?tab=activity`,
      photo: photos[0],
      cover: m.cover,
      emoji: "📸",
      big: m.years === 1 ? "1 year" : `${m.years} years`,
      frames,
      at: now - 86_400_000,
    });
  }
  // Moments: one story per group. Its id has the newest moment in it, so the circle lights up again when another one arrives.
  // The words are the person's own caption and day only: nothing is ever written about someone's photo.
  for (const mo of i.moments ?? []) {
    if (!mo.frames.length) continue;
    const n = mo.frames.length;
    out.push({
      id: `moment-${mo.groupId}-${mo.newestId}`,
      kind: "moment",
      label: place(mo.groupName),
      short: place(mo.groupName), // the group's name under the circle, never the same word on every one
      headline: mo.frames[0].kicker,
      line: n === 1 ? "A new moment" : `${n} new moments`,
      cta: "See our moments",
      href: `/groups/${mo.groupId}/moments`,
      photo: mo.frames[0].thumb,
      emoji: "📸",
      frames: mo.frames.map((f): Frame => ({ kind: "photo", photo: f.full, kicker: f.kicker, head: f.head, line: f.line || undefined, calm: true })),
      at: mo.at.getTime(),
    });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 12);
}
