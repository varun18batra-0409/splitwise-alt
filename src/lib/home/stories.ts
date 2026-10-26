import type { TripPhase } from "../countdown";

// Home's stories: the moments in your groups, not the numbers. A trip coming
// up (or happening now), last night's card game, a group that just got all
// square, a collection filling up, a trip from a year ago. Each one is a card
// you tap through, with one thing to do next. Pure, so it can be tested.

export type StoryKind = "trip" | "pot" | "square" | "collect" | "memory" | "wrapped";
export type Story = {
  id: string; // stable for "seen" (changes when the story changes, e.g. the day count)
  kind: StoryKind;
  label: string; // under the little picture: "Goa", "Diwali night"
  headline: string; // big on the card
  line: string; // the handwritten line under it
  cta: string;
  href: string;
  photo?: string; // a destination photo
  cover?: { kind: string; src?: string }; // the group's own picture
  emoji: string; // when there's no picture
  at: number; // when it happened (for ordering)
};

export type StoryInput = {
  now: Date;
  trips: { id: string; name: string; phase: TripPhase; photo?: string; cover?: { kind: string; src?: string }; people: number }[];
  games: { id: string; groupId: string; name: string; winner: string; won: string; youWon?: string; finishedAt: Date }[];
  squared: { id: string; name: string; at: Date; cover?: { kind: string; src?: string }; photo?: string }[];
  collections: { id: string; code: string; title: string; paid: number; people: number }[];
  memories: { id: string; name: string; years: number; people: number; days: number; photo?: string; cover?: { kind: string; src?: string } }[];
  wrapped: { id: string; name: string; endedDaysAgo: number; photo?: string; cover?: { kind: string; src?: string } }[];
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
      photo: t.photo,
      cover: t.cover,
      emoji: "✈️",
      // Happening now first, then the soonest.
      at: now + (p.kind === "before" ? -p.days * 3_600_000 : 86_400_000),
    });
  }
  for (const w of i.wrapped) {
    out.push({ id: `wrapped-${w.id}`, kind: "wrapped", label: place(w.name), headline: `${place(w.name)}, wrapped`, line: "Who paid most, the biggest night and more", cta: "Watch it", href: `/groups/${w.id}/wrapped`, photo: w.photo, cover: w.cover, emoji: "🎬", at: now - w.endedDaysAgo * 86_400_000 + 3_600_000 });
  }
  for (const g of i.games) {
    if (now - g.finishedAt.getTime() > 3 * 86_400_000) continue;
    out.push({
      id: `pot-${g.id}`,
      kind: "pot",
      label: g.name.length > 14 ? `${g.name.slice(0, 13)}…` : g.name,
      headline: g.youWon ? `You won ${g.youWon} 🏆` : g.winner ? `${g.winner} won ${g.won}` : "Everyone broke even",
      line: g.name,
      cta: "See who pays whom",
      href: `/groups/${g.groupId}/pot/${g.id}`,
      emoji: "🃏",
      at: g.finishedAt.getTime(),
    });
  }
  for (const s of i.squared) {
    if (now - s.at.getTime() > 3 * 86_400_000) continue;
    out.push({ id: `square-${s.id}-${s.at.getTime()}`, kind: "square", label: place(s.name), headline: `${place(s.name)} is all square`, line: "Nobody owes anybody. Nice one 🎉", cta: "Share it", href: `/groups/${s.id}/square`, photo: s.photo, cover: s.cover, emoji: "🎉", at: s.at.getTime() });
  }
  for (const c of i.collections) {
    if (c.people === 0) continue;
    out.push({
      id: `collect-${c.id}-${c.paid}`,
      kind: "collect",
      label: c.title.length > 14 ? `${c.title.slice(0, 13)}…` : c.title,
      headline: c.paid === c.people ? `${c.title}: everyone’s in` : `${c.title}: ${c.paid} of ${c.people} paid`,
      line: c.paid === c.people ? "Time to close it" : c.paid === 0 ? "Share the link to get it going" : "Nearly there. A nudge might help",
      cta: "Open the collection",
      href: `/c/${c.code}`,
      emoji: "🪙",
      at: now - 2 * 86_400_000,
    });
  }
  for (const m of i.memories) {
    out.push({
      id: `memory-${m.id}-${m.years}`,
      kind: "memory",
      label: place(m.name),
      headline: `${m.years === 1 ? "A year" : `${m.years} years`} ago: ${place(m.name)}`,
      line: `${m.people} of you${m.days > 1 ? `, ${m.days} days` : ""}. Remember that? 🌴`,
      cta: "Relive it",
      href: `/groups/${m.id}?tab=activity`,
      photo: m.photo,
      cover: m.cover,
      emoji: "📸",
      at: now - 86_400_000,
    });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 12);
}
