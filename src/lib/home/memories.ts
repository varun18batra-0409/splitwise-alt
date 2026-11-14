// Home's "Your memories" card: the most recent trip that has moments THIS person may see, as a small collage.
// Pure. Every moment goes through canSeeMoment (src/lib/moments-access.ts) here, again, whatever the loader already filtered:
// a moment the viewer can't see is never counted and its photo address never leaves this function.
import { canSeeMoment, type MomentFacts, type MomentViewer } from "../moments-access";
import { daysBetween, placeOf } from "../countdown";

export type MemoryTrip = {
  groupId: string;
  name: string;
  start: string; // "2026-11-03"
  end?: string | null;
  viewer: MomentViewer;
  moments: (MomentFacts & { id: string })[];
};

export type HomeMemories = { groupId: string; title: string; line: string; thumbs: string[]; count: number; href: string };

// "12 moments from 5 days", "1 moment from 3 days", "4 moments" (a one-day trip says no days).
export function memoriesLine(count: number, days: number): string {
  return `${count} ${count === 1 ? "moment" : "moments"}${days > 1 ? ` from ${days} days` : ""}`;
}

export const MEMORY_THUMBS = 3;

export function pickMemories(trips: MemoryTrip[], today: string, thumbOf: (id: string) => string): HomeMemories | null {
  const found = trips
    .filter((t) => t.start && t.start <= today) // started: nothing to relive before the trip
    .map((t) => ({ t, seen: t.moments.filter((m) => canSeeMoment(t.viewer, m)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)) }))
    .filter((x) => x.seen.length > 0)
    // The most recent trip (by its last day), then the one with the newest moment.
    .sort((a, b) => (b.t.end || b.t.start).localeCompare(a.t.end || a.t.start) || b.seen[0].createdAt.getTime() - a.seen[0].createdAt.getTime() || a.t.groupId.localeCompare(b.t.groupId));
  const top = found[0];
  if (!top) return null;
  const days = top.t.end ? daysBetween(top.t.start, top.t.end) + 1 : 1;
  return {
    groupId: top.t.groupId,
    title: `Relive ${placeOf(top.t.name)}`,
    line: memoriesLine(top.seen.length, days),
    thumbs: top.seen.slice(0, MEMORY_THUMBS).map((m) => thumbOf(m.id)),
    count: top.seen.length,
    href: `/groups/${top.t.groupId}?tab=memories`,
  };
}
