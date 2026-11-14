import type { Frame, Story } from "./home/stories";
import type { MomentCard } from "./moments-db";

// The circles at the top of "Our moments": the trip (everything from the last 7 days), then one circle per person who added
// something in that time. Tapping opens the same full-screen viewer as Home's stories. Pure.
const WEEK = 7 * 86_400_000;
const place = (name: string) => name.replace(/\s+trip$/i, "").trim() || name;

// `groupPic`: the group's own picture (its place photo or cover). The group circle shows that, never a member's photo, so it is not the
// same picture as the first person's circle next to it. A person's circle shows that person's newest photo.
export type GroupPic = { photo?: string; cover?: { kind: string; src?: string } };

export function momentPageStories(cards: MomentCard[], groupId: string, groupName: string, now = new Date(), groupPic?: GroupPic): Story[] {
  const recent = cards.filter((c) => now.getTime() - c.createdAt.getTime() <= WEEK); // newest first
  if (!recent.length) return [];
  const frame = (c: MomentCard): Frame => ({ kind: "photo", photo: c.full, kicker: c.authorIsMe ? "You added a moment" : `${c.authorName} added a moment`, head: c.caption, line: c.day || undefined, calm: true });
  const make = (idKey: string, label: string, list: MomentCard[], pic?: GroupPic): Story => ({
    id: `mp-${groupId}-${idKey}-${list[0].id}`,
    kind: "moment",
    label,
    short: label,
    headline: `${list.length} ${list.length === 1 ? "moment" : "moments"} this week`,
    line: "",
    cta: "Open it",
    href: `/groups/${groupId}/moments/${list[0].id}`,
    ...(pic ? { photo: pic.photo, cover: pic.cover } : { photo: list[0].thumb }),
    emoji: "📸",
    frames: list.slice(0, 6).map(frame),
    at: list[0].createdAt.getTime(),
  });
  const out: Story[] = [make("trip", place(groupName), recent, groupPic ?? {})];
  const seen = new Set<string>();
  // One circle per person, told apart by who they are (account, else member), not by name: two people both called Sam get two circles.
  const who = (c: MomentCard) => c.authorAccountId || c.authorId;
  for (const c of recent) {
    if (seen.has(who(c))) continue;
    seen.add(who(c));
    out.push(make(`by-${out.length}`, c.authorName, recent.filter((x) => who(x) === who(c))));
  }
  return out;
}
