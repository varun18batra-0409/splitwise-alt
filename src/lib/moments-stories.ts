import type { Frame, Story } from "./home/stories";
import type { MomentCard } from "./moments-db";

// The circles at the top of "Our moments": the trip (everything from the last 7 days), then one circle per person who added
// something in that time. Tapping opens the same full-screen viewer as Home's stories. Pure.
const WEEK = 7 * 86_400_000;
const place = (name: string) => name.replace(/\s+trip$/i, "").trim() || name;

export function momentPageStories(cards: MomentCard[], groupId: string, groupName: string, now = new Date()): Story[] {
  const recent = cards.filter((c) => now.getTime() - c.createdAt.getTime() <= WEEK); // newest first
  if (!recent.length) return [];
  const frame = (c: MomentCard): Frame => ({ kind: "photo", photo: c.full, kicker: c.authorIsMe ? "You added a moment" : `${c.authorName} added a moment`, head: c.caption, line: c.day || undefined, calm: true });
  const make = (idKey: string, label: string, list: MomentCard[]): Story => ({
    id: `mp-${groupId}-${idKey}-${list[0].id}`,
    kind: "moment",
    label,
    short: label,
    headline: `${list.length} ${list.length === 1 ? "moment" : "moments"} this week`,
    line: "",
    cta: "Open it",
    href: `/groups/${groupId}/moments/${list[0].id}`,
    photo: list[0].thumb,
    emoji: "📸",
    frames: list.slice(0, 6).map(frame),
    at: list[0].createdAt.getTime(),
  });
  const out: Story[] = [make("trip", place(groupName), recent)];
  const seen = new Set<string>();
  for (const c of recent) {
    if (seen.has(c.authorName)) continue;
    seen.add(c.authorName);
    out.push(make(`by-${out.length}`, c.authorName, recent.filter((x) => x.authorName === c.authorName)));
  }
  return out;
}
