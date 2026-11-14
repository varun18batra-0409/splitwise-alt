import { db } from "./db";
import { blockedEitherWay } from "./blocks";
import { buildPassport, type PassportTrip } from "./passport";
import { beenCards } from "./passport-cards";
import { countryOf } from "./geo";
import { dayKey } from "./dates";
import { tripDays } from "./moments-text";

// The Memories tab of a group: its moments by day, the trip's passport stamp, and the postcards you sent or got from this group.
// No money anywhere on it. Pure helpers first (tested with hand-worked dates), then the one loader that reads postcards.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""}`;

// ---- Moments by day ----
export type DayGroup<T> = { key: string; label: string; cards: T[] };

// The day a moment belongs to: the day it was taken (if the person said), else the day it was added in the viewer's time zone.
export function momentDay(c: { takenOn: string; createdAt: Date }, tz: string): string {
  return c.takenOn || dayKey(c.createdAt, tz);
}

// Days with the moments in them. A day inside the trip reads "Day 4 · 11 Oct"; any other day (or a trip with no dates) reads "20 Oct".
// While the trip is on (or still to come) the newest day is first; once the trip is over, Day 1 comes first and each day runs in the
// order things happened. `today` is the viewer's day ("2026-10-11"); `tripEnd` empty counts the trip as one day.
export function dayGroups<T extends { takenOn: string; createdAt: Date }>(cards: T[], tripStart: string, tripEnd: string, tz: string, today: string): DayGroup<T>[] {
  const days = tripDays(tripStart, tripEnd);
  const over = days.length > 0 && today > days[days.length - 1];
  const by = new Map<string, T[]>();
  for (const c of cards) {
    const k = momentDay(c, tz);
    by.set(k, [...(by.get(k) ?? []), c]);
  }
  const keys = [...by.keys()].sort((a, b) => (over ? a.localeCompare(b) : b.localeCompare(a)));
  return keys.map((key) => {
    const i = days.indexOf(key);
    const list = [...by.get(key)!].sort((a, b) => (over ? a.createdAt.getTime() - b.createdAt.getTime() : b.createdAt.getTime() - a.createdAt.getTime()));
    return { key, label: i >= 0 ? `Day ${i + 1} · ${shortDay(key)}` : shortDay(key), cards: list };
  });
}

// ---- The trip's stamp ----
export type TripStamp = { title: string; stampText: string; dates: string; days: number; reliveHref: string };

// This trip's passport stamp, from today's passport helpers (buildPassport and beenCards): "THAILAND / MAY 2026" with its dates and days and the
// Relive trip link. Null for a trip with no dates, one that hasn't started, or one this person left before it began (they didn't go).
export function tripStampCard(
  group: { id: string; name: string; tripStart: string; tripEnd: string; tripPlace: string; tripCountry: string; memberCount: number },
  home: string,
  today: string,
  leftAt: Date | null = null,
): TripStamp | null {
  if (!group.tripStart) return null;
  if (leftAt && leftAt.toISOString().slice(0, 10) < group.tripStart) return null;
  const trip: PassportTrip = { groupId: group.id, name: group.name, start: group.tripStart, end: group.tripEnd, place: group.tripPlace, country: group.tripCountry, people: group.memberCount };
  const passport = buildPassport([trip], [], home, today);
  const card = beenCards(passport, {}, today).cards.find((c) => c.kind === "trip" && c.groupId === group.id);
  if (!card) return null;
  const country = countryOf(card.code)?.name ?? card.title;
  const when = `${MONTHS[Number(group.tripStart.slice(5, 7)) - 1] ?? ""} ${group.tripStart.slice(0, 4)}`;
  return { title: card.title, stampText: `${country} / ${when}`.toUpperCase(), dates: card.dates, days: card.days, reliveHref: card.reliveHref ?? `/groups/${group.id}/report` };
}

// ---- Postcards sent or received from this group ----
type CardFacts = { fromId: string; toId: string };

// Mirrors canViewPostcard (src/lib/blocks.ts) for a whole list at once: the sender always sees their own; the person it went to doesn't
// once either of them has blocked the other, even for a card sent before the block. Someone else's postcard is never visible.
export function postcardVisible(me: string, card: CardFacts, blocked: ReadonlySet<string>): boolean {
  if (card.fromId !== me && card.toId !== me) return false;
  if (card.fromId === me) return true;
  return !blocked.has(card.fromId);
}

export type GroupPostcard = {
  id: string;
  direction: "sent" | "received";
  who: string; // the other person's first name
  sealedUntil: Date | null; // a received card that is still sealed: nothing else of it is shown
  row: Awaited<ReturnType<typeof db.postcard.findMany>>[number] | null; // null while sealed
};

export async function loadGroupPostcards(accountId: string, groupId: string, now = new Date()): Promise<GroupPostcard[]> {
  if (!accountId || !groupId) return [];
  // Taken out of the group: no memories, postcards included.
  const member = await db.member.findFirst({ where: { groupId, accountId, removedAt: null }, select: { id: true } });
  if (!member) return [];
  const [rows, blocked] = await Promise.all([
    db.postcard.findMany({ where: { groupId, OR: [{ fromId: accountId }, { toId: accountId }] }, orderBy: { createdAt: "desc" }, take: 60 }),
    blockedEitherWay(accountId),
  ]);
  const seen = rows.filter((r) => postcardVisible(accountId, r, blocked));
  const otherIds = [...new Set(seen.map((r) => (r.fromId === accountId ? r.toId : r.fromId)))];
  const people = otherIds.length ? await db.account.findMany({ where: { id: { in: otherIds } }, select: { id: true, name: true } }) : [];
  const first = new Map(people.map((a) => [a.id, a.name.trim().split(/\s+/)[0] || "A friend"]));
  return seen.map((r) => {
    const sent = r.fromId === accountId;
    const sealed = !sent && r.opensAt !== null && r.opensAt > now;
    return { id: r.id, direction: sent ? "sent" : "received", who: first.get(sent ? r.toId : r.fromId) ?? "A friend", sealedUntil: sealed ? r.opensAt : null, row: sealed ? null : r };
  });
}
