import type { TripPhase } from "../countdown";

// Home's stories: the moments in your groups, not the numbers. A trip coming
// up (or happening now), last night's card game, a group that just got all
// square, a collection filling up, a trip from a year ago, a fresh Wrapped.
// Each story is 4–6 slides you tap through (photos of the place, a few
// playful numbers, the crew), with one thing to do next. Pure, so it can be tested.

export type StoryKind = "trip" | "pot" | "square" | "collect" | "memory" | "wrapped";
export type Tone = "sun" | "coral" | "sky" | "pink" | "lilac" | "mint";
// One slide: a full photo with words, a bold poster, or a short list.
export type Frame =
  | { kind: "photo"; photo: string; kicker?: string; head: string; line?: string }
  | { kind: "art"; art: StoryKind; kicker?: string; head: string; line?: string } // designed artwork (card night, collection…) instead of a photo
  | { kind: "poster"; tone: Tone; kicker: string; big: string; line?: string }
  | { kind: "list"; tone: Tone; kicker: string; rows: { label: string; value?: string; good?: boolean; bad?: boolean; share?: number }[]; line?: string };

export type Story = {
  id: string; // stable for "seen" (changes when the story changes, e.g. the day count)
  kind: StoryKind;
  label: string; // under the little picture: "Goa", "Diwali night"
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
  trips: ({ id: string; name: string; phase: TripPhase; people: number; crew?: string[]; mood?: "beach" | "hills" | "city" | "any"; today?: { spent: string; count: number; top?: string; biggest?: { what: string; amount: string } } } & Pic)[];
  games: { id: string; groupId: string; name: string; winner: string; won: string; youWon?: string; finishedAt: Date; table?: { name: string; net: string; up: boolean; even: boolean; share: number }[]; pays?: string[]; toSettle?: string; photos?: string[] }[];
  squared: ({ id: string; name: string; at: Date; spent?: string; payments?: number; people?: number } & Pic)[];
  collections: { id: string; code: string; title: string; paid: number; people: number; in?: string; target?: string; paidNames?: string[]; dueNames?: string[] }[];
  memories: ({ id: string; name: string; years: number; people: number; days: number; spent?: string; crew?: string[] } & Pic)[];
  wrapped: ({ id: string; name: string; endedDaysAgo: number; spent?: string; topCategory?: string } & Pic)[];
};

const place = (name: string) => name.replace(/\s+trip$/i, "").trim() || name;

// A playful line for each stage of the countdown.
function tripLine(p: TripPhase, people: number): string {
  if (p.kind === "today") return "Bags packed? It starts today ✈️";
  if (p.kind === "during") return p.day === p.of ? "Last day. Make it count 🌅" : `Day ${p.day} of ${p.of}. Keep the receipts coming`;
  if (p.kind === "before" && p.days === 1) return "Tomorrow! Charge your phone 🔋";
  if (p.kind === "before" && p.days <= 7) return `${people} of you, ${p.days} sleeps to go`;
  if (p.kind === "before" && p.days <= 30) return "Start the packing list";
  return "Mark it in your calendar";
}

// Little captions for the place's photos, by the kind of trip.
const CAPTIONS: Record<"beach" | "hills" | "city" | "any", [string, string][]> = {
  beach: [
    ["Forecast", "100% chance of flip-flops 🩴"],
    ["Packing list", "Sunscreen. More sunscreen. A hat you'll lose."],
    ["Golden hour", "Somebody's taking 400 photos of this sunset"],
    ["Plot twist", "The beach shack is the fancy dinner"],
  ],
  hills: [
    ["Forecast", "Cold enough for two hoodies 🧣"],
    ["Packing list", "Warm socks. Maggi. A speaker for the drive."],
    ["Spotted", "Chai at 2,000 metres hits different ☕"],
    ["Plot twist", "Nobody packed the charger"],
  ],
  city: [
    ["Forecast", "High chance of street food 🌮"],
    ["Packing list", "Comfy shoes. You will walk 20,000 steps."],
    ["After dark", "The city looks better at night. So do the bills."],
    ["Plot twist", "Someone gets lost. It's always the same someone"],
  ],
  any: [
    ["Forecast", "Good times, with a chance of receipts 🧾"],
    ["Packing list", "Charger, passport, snacks. In that order."],
    ["Spotted", "The group chat, already planning outfits"],
    ["Plot twist", "Loopin keeps the maths. You keep the memories"],
  ],
};

function tripFrames(t: StoryInput["trips"][number]): Frame[] {
  const p = t.phase;
  const where = place(t.name);
  const photos = t.photos?.length ? t.photos : t.photo ? [t.photo] : [];
  const caps = CAPTIONS[t.mood ?? "any"];
  const photo = (k: number, kicker: string | undefined, head: string, line?: string): Frame | null => (photos.length ? { kind: "photo", photo: photos[k % photos.length], kicker, head, line } : null);
  const crew: Frame | null = t.crew && t.crew.length > 1 ? { kind: "list", tone: "sky", kicker: "The crew", rows: t.crew.slice(0, 8).map((n) => ({ label: n })), line: t.crew.length > 8 ? `and ${t.crew.length - 8} more` : `${t.crew.length} of you. Dangerous.` } : null;
  const out: (Frame | null)[] = [];
  if (p.kind === "before") {
    out.push(photo(0, p.days === 1 ? "Tomorrow" : `In ${p.days} days`, where, tripLine(p, t.people)));
    out.push({ kind: "poster", tone: "sun", kicker: p.days === 1 ? "Sleeps to go" : "Sleeps to go", big: String(p.days), line: p.days <= 3 ? "Not that anyone's counting 👀" : "Someone has a countdown on their lock screen" });
    out.push(photo(1, caps[0][0], caps[0][1]));
    out.push(crew);
    out.push(photo(2, caps[1][0], caps[1][1]));
    out.push(photo(3, caps[2][0], caps[2][1], "Add bookings now, sort the money later"));
  } else {
    const d = t.today;
    out.push(photo(0, p.kind === "today" ? "Today" : `Day ${p.kind === "during" ? p.day : 1}`, p.kind === "today" ? `${where} starts today` : `${where}, day ${p.kind === "during" ? p.day : 1}`, tripLine(p, t.people)));
    out.push(
      d && d.count > 0
        ? { kind: "poster", tone: "coral", kicker: "Spent today", big: d.spent, line: `${d.count} ${d.count === 1 ? "expense" : "expenses"} so far. The night is young.` }
        : { kind: "poster", tone: "coral", kicker: "Spent today", big: "Nothing", line: "Suspiciously quiet… 👀" },
    );
    if (d?.top) out.push({ kind: "poster", tone: "mint", kicker: "Carrying the team today", big: d.top, line: "Somebody buy them a drink 🍹" });
    out.push(photo(1, caps[2][0], caps[2][1]));
    if (d?.biggest) out.push({ kind: "poster", tone: "pink", kicker: "Biggest bill today", big: d.biggest.amount, line: d.biggest.what });
    out.push(crew);
    out.push(photo(2, caps[3][0], caps[3][1], "Add it now, settle it later"));
  }
  const frames = out.filter((f): f is Frame => Boolean(f)).slice(0, 6);
  return frames.length ? frames : [{ kind: "poster", tone: "sky", kicker: where, big: p.kind === "before" ? `${p.days} days` : "Today", line: tripLine(p, t.people) }];
}

export function buildStories(i: StoryInput): Story[] {
  const out: Story[] = [];
  const now = i.now.getTime();
  for (const t of i.trips) {
    const p = t.phase;
    if (p.kind === "after" || (p.kind === "before" && p.days > 60)) continue;
    const head = p.kind === "before" ? (p.days === 1 ? `${place(t.name)} tomorrow` : `${place(t.name)} in ${p.days} days`) : p.kind === "today" ? `${place(t.name)} starts today` : `${place(t.name)}, day ${p.day}`;
    const key = p.kind === "before" ? `b${p.days}` : p.kind === "during" ? `d${p.day}` : "t";
    out.push({
      id: `trip-${t.id}-${key}`,
      kind: "trip",
      label: place(t.name),
      headline: head,
      line: tripLine(p, t.people),
      cta: p.kind === "before" ? "Open the trip" : "Add an expense",
      href: p.kind === "before" ? `/groups/${t.id}` : `/groups/${t.id}/add`,
      photo: t.photos?.[0] ?? t.photo,
      cover: t.cover,
      emoji: "✈️",
      big: p.kind === "before" ? (p.days === 1 ? "Tomorrow" : `${p.days} days`) : p.kind === "today" ? "Today" : `Day ${p.day}`,
      frames: tripFrames(t),
      // Happening now first, then the soonest.
      at: now + (p.kind === "before" ? -p.days * 3_600_000 : 86_400_000),
    });
  }
  for (const w of i.wrapped) {
    const photos = w.photos?.length ? w.photos : w.photo ? [w.photo] : [];
    const frames: Frame[] = [
      ...(photos[0] ? [{ kind: "photo", photo: photos[0], kicker: "Just in", head: `${place(w.name)}, wrapped`, line: "The trip, told in slides" } as Frame] : []),
      ...(w.spent ? [{ kind: "poster", tone: "sun", kicker: "Together you spent", big: w.spent, line: "Worth every rupee? Discuss." } as Frame] : []),
      ...(w.topCategory ? [{ kind: "poster", tone: "coral", kicker: "Most of it went on", big: w.topCategory, line: "No regrets. Mostly." } as Frame] : []),
      { kind: "poster", tone: "lilac", kicker: "Also inside", big: "Awards", line: "Who's the Banker? Who's the Snack Lord? Find out." },
      ...(photos[1] ? [{ kind: "photo", photo: photos[1], kicker: "Ready when you are", head: "Watch the whole thing", line: "Then share it to the group" } as Frame] : []),
    ];
    out.push({ id: `wrapped-${w.id}`, kind: "wrapped", label: place(w.name), headline: `${place(w.name)}, wrapped`, line: "Who paid most, the biggest night and more", cta: "Watch it", href: `/groups/${w.id}/wrapped`, photo: photos[0], cover: w.cover, emoji: "🎬", big: "Wrapped", frames, at: now - w.endedDaysAgo * 86_400_000 + 3_600_000 });
  }
  for (const g of i.games) {
    if (now - g.finishedAt.getTime() > 3 * 86_400_000) continue;
    const headline = g.youWon ? `You won ${g.youWon}` : g.winner ? `${g.winner} won ${g.won}` : "Everyone broke even";
    // Card nights get their own artwork (green felt, gold, the cards), never a stock photo.
    const frames: Frame[] = [
      { kind: "art", art: "pot", kicker: g.name, head: g.youWon ? `You won ${g.youWon}` : g.winner ? `${g.winner} took the pot` : "Everyone broke even", line: g.youWon ? "Drinks are on you, apparently" : g.winner ? `${g.won} richer. Insufferable now.` : "Nobody won. Nobody lost. Suspicious." },
      ...(g.table && g.table.length > 1 ? [{ kind: "list", tone: "mint", kicker: "The table", rows: g.table.slice(0, 8).map((r) => ({ label: r.name, value: r.net, good: r.up && !r.even, bad: !r.up && !r.even, share: r.share })) } as Frame] : []),
      ...(g.pays && g.pays.length ? [{ kind: "list", tone: "sun", kicker: "Who pays whom", rows: g.pays.slice(0, 6).map((l) => ({ label: l })), line: g.pays.length > 6 ? `and ${g.pays.length - 6} more` : "Pay up, card sharks" } as Frame] : []),
      { kind: "poster", tone: g.toSettle ? "coral" : "sky", kicker: g.toSettle ? "Still to settle" : "Settled", big: g.toSettle ?? "All square ✓", line: g.toSettle ? "Mark it paid in the game" : "Clean books. Respect." },
      { kind: "art", art: "pot", kicker: "Next time", head: "Same table, next week?", line: "Bring snacks. And your poker face." },
    ];
    out.push({
      id: `pot-${g.id}`,
      kind: "pot",
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
    out.push({ id: `square-${s.id}-${s.at.getTime()}`, kind: "square", label: place(s.name), headline: `${place(s.name)} is all square`, line: "Nobody owes anybody. Nice one 🎉", cta: "Share it", href: `/groups/${s.id}/square`, photo: photos[0], cover: s.cover, art: "square", emoji: "🎉", big: "All square", frames, at: s.at.getTime() });
  }
  for (const c of i.collections) {
    if (c.people === 0) continue;
    const all = c.paid === c.people;
    const frames: Frame[] = [
      { kind: "art", art: "collect", kicker: c.title, head: all ? "Everyone’s in" : `${c.paid} of ${c.people} paid`, line: all ? "Time to close it" : c.paid === 0 ? "Who’s going first?" : "The jar is filling up" },
      ...(c.in && c.target ? [{ kind: "poster", tone: "coral", kicker: "Collected", big: c.in, line: `of ${c.target}` } as Frame] : []),
      ...((c.paidNames?.length || c.dueNames?.length)
        ? [{ kind: "list", tone: "mint", kicker: "Roll call", rows: [...(c.paidNames ?? []).slice(0, 5).map((n) => ({ label: n, value: "Paid ✓", good: true })), ...(c.dueNames ?? []).slice(0, 5).map((n) => ({ label: n, value: "Not yet", bad: true }))], line: (c.dueNames?.length ?? 0) > 0 ? "A gentle nudge might help" : "Legends, all of them" } as Frame]
        : []),
    ];
    out.push({
      id: `collect-${c.id}-${c.paid}`,
      kind: "collect",
      label: c.title.length > 14 ? `${c.title.slice(0, 13)}…` : c.title,
      headline: all ? `${c.title}: everyone’s in` : `${c.title}: ${c.paid} of ${c.people} paid`,
      line: all ? "Time to close it" : c.paid === 0 ? "Share the link to get it going" : "Nearly there. A nudge might help",
      cta: "Open the collection",
      href: `/c/${c.code}`,
      art: "collect",
      emoji: "🪙",
      big: `${c.paid}/${c.people}`,
      frames,
      at: now - 2 * 86_400_000,
    });
  }
  for (const m of i.memories) {
    const photos = m.photos?.length ? m.photos : m.photo ? [m.photo] : [];
    const ago = m.years === 1 ? "A year ago" : `${m.years} years ago`;
    const frames: Frame[] = [
      photos[0] ? { kind: "photo", photo: photos[0], kicker: `${ago} today`, head: place(m.name), line: "Remember this? 🌴" } : { kind: "poster", tone: "coral", kicker: `${ago} today`, big: place(m.name), line: "Remember this? 🌴" },
      { kind: "poster", tone: "sun", kicker: "The trip", big: `${m.days} ${m.days === 1 ? "day" : "days"}`, line: `${m.people} of you. Zero regrets.` },
      ...(m.spent ? [{ kind: "poster", tone: "pink", kicker: "Spent together", big: m.spent, line: "Money well spent, obviously" } as Frame] : []),
      ...(m.crew && m.crew.length > 1 ? [{ kind: "list", tone: "sky", kicker: "Who was there", rows: m.crew.slice(0, 8).map((n) => ({ label: n })), line: "Time for a sequel?" } as Frame] : []),
      ...(photos[1] ? [{ kind: "photo", photo: photos[1], kicker: "Same time next year?", head: "Plan the sequel", line: "The group chat is waiting" } as Frame] : []),
    ];
    out.push({
      id: `memory-${m.id}-${m.years}`,
      kind: "memory",
      label: place(m.name),
      headline: `${ago}: ${place(m.name)}`,
      line: `${m.people} of you${m.days > 1 ? `, ${m.days} days` : ""}. Remember that? 🌴`,
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
  return out.sort((a, b) => b.at - a.at).slice(0, 12);
}
