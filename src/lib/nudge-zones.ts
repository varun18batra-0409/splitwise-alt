import { db } from "./db";
import { NUDGE_LAST_HOUR, cleanTimeZone, isNudgeHour, localDays, localHour } from "./local-time";

// Who gets a nudge when, by their own time zone.
//
// - A person's zone is their account's, else the one saved for them in that group
//   (both come from the phone: see saveTimeZone). Nobody who has not sent one yet
//   changes: they stay on the old per-group, India-time path ("legacy").
// - Someone with a zone is sent a nudge only between 06:00 and 22:00 their time,
//   and each send is recorded for that person and that local day.

// The switch-over: on the day this goes live, the morning run (old code) may already have sent a group
// its nudge under the old per-group record. Only records written before the new code first ran count:
// "zones-live" is written once, by the first run that reaches here, and keeps that moment.
// Records the new code writes for people with no zone yet (the old path) come after it, so they never
// stop someone with a zone from getting theirs. No date to set by hand.
export const ZONES_LIVE_KEY = "zones-live";

//
// The moment is written as just before the first run's own start (`now`, the time the cron began), not the real
// write time: the first run's own old-path records are stamped with `now`, so they must count as "after".
// (Never later than the real clock, so a `now` that is ahead of it cannot push the moment into the future.)
export async function zonesLiveAt(now: Date = new Date()): Promise<Date> {
  const found = await db.notifyLog.findUnique({ where: { key: ZONES_LIVE_KEY }, select: { createdAt: true } });
  if (found) return found.createdAt;
  const at = new Date(Math.min(now.getTime(), Date.now()) - 1);
  try {
    return (await db.notifyLog.create({ data: { key: ZONES_LIVE_KEY, state: "done", createdAt: at }, select: { createdAt: true } })).createdAt;
  } catch {
    // Another run wrote it at the same moment: read theirs.
    return (await db.notifyLog.findUniqueOrThrow({ where: { key: ZONES_LIVE_KEY }, select: { createdAt: true } })).createdAt;
  }
}

// The old (no-zone) path writes "<old key>:sent:<member id>" for each person it actually sent to (markSentByOldPath).
// That is how we know, later the same day, that someone who has since sent their zone has already had it.
const sentMarkKey = (oldKey: string, memberId: string) => `${oldKey}:sent:${memberId}`;

export async function markSentByOldPath(oldKey: string, memberIds: string[], now: Date = new Date()): Promise<void> {
  for (const id of new Set(memberIds)) {
    await db.notifyLog.create({ data: { key: sentMarkKey(oldKey, id), state: "done", createdAt: now } }).catch(() => undefined); // already marked
  }
}

// True if this person must not be sent this nudge again, because
//  - the old per-group record for it was finished by the old code (before the switch-over), or
//  - (when `memberId` is given) the old path really sent it to this person that day, and they have a zone only now.
// Someone the old path never sent to (not in the group yet, already on their own zone, or at night when it ran)
// has no mark, so nobody's nudge is lost.
export async function coveredByOldRecord(oldKey: string, now: Date = new Date(), memberId?: string): Promise<boolean> {
  const row = await db.notifyLog.findUnique({ where: { key: oldKey }, select: { state: true, createdAt: true } });
  if (row?.state === "done" && row.createdAt < (await zonesLiveAt(now))) return true;
  if (!memberId) return false;
  return !!(await db.notifyLog.findUnique({ where: { key: sentMarkKey(oldKey, memberId) }, select: { key: true } }));
}

// member id -> zone ("" = not known). Never throws (a failure reads as "not known", i.e. today's behaviour).
export async function zonesOf(memberIds: string[], now: Date = new Date()): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(memberIds)];
  if (!ids.length) return out;
  try {
    await zonesLiveAt(now); // mark the switch-over before this run sends anything (see coveredByOldRecord)
    const members = await db.member.findMany({ where: { id: { in: ids } }, select: { id: true, timeZone: true, accountId: true } });
    const accountIds = [...new Set(members.map((m) => m.accountId).filter((a): a is string => !!a))];
    const accounts = accountIds.length ? await db.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, timeZone: true } }) : [];
    const accountZone = new Map(accounts.map((a) => [a.id, cleanTimeZone(a.timeZone) ?? ""]));
    for (const m of members) out.set(m.id, (m.accountId ? accountZone.get(m.accountId) : "") || cleanTimeZone(m.timeZone) || "");
  } catch {
    /* keep everyone on the old path */
  }
  return out;
}

// `ahead` = the local day of their next daytime: today, or tomorrow once today's 22:00 has passed. A person skipped
// for night is waited for on that day (so a run later is told there is something to send).
export type ZonedPerson = { id: string; tz: string; yesterday: string; today: string; tomorrow: string; daytime: boolean; ahead: string };

// Splits people into those with no zone yet (old path) and those with one (with their own days and whether it is daytime for them now).
export function splitByZone(memberIds: string[], zones: Map<string, string>, now: Date): { legacy: string[]; zoned: ZonedPerson[] } {
  const legacy: string[] = [];
  const zoned: ZonedPerson[] = [];
  for (const id of memberIds) {
    const tz = zones.get(id) ?? "";
    if (!tz) legacy.push(id);
    else {
      const days = localDays(now, tz);
      zoned.push({ id, tz, ...days, daytime: isNudgeHour(now, tz), ahead: localHour(now, tz) >= NUDGE_LAST_HOUR ? days.tomorrow : days.today });
    }
  }
  return { legacy, zoned };
}

// Saves a zone sent by a phone: to the signed-in account (if any) and to this phone's people in their groups
// (only those still in them: someone who has left or been removed is not touched).
// Returns false (and saves nothing) for anything that is not a real zone name.
//
// Rolling back or redeploying older code is safe: the old code ignores the zone columns and the
// per-person records, and goes back to one nudge per group on India time. People who got a per-person nudge that
// day may then get the group's nudge once more that day; nothing is lost.
export async function saveTimeZone(raw: unknown, accountId: string | null, memberIds: string[], _now: Date = new Date()): Promise<boolean> {
  const tz = cleanTimeZone(raw);
  if (!tz) return false;
  const ids = [...new Set(memberIds)].filter((x) => typeof x === "string" && x).slice(0, 500);
  if (ids.length) {
    const here = { id: { in: ids }, leftAt: null, removedAt: null };
    await db.member.updateMany({ where: { ...here, NOT: { timeZone: tz } }, data: { timeZone: tz } });
  }
  if (accountId) await db.account.updateMany({ where: { id: accountId, NOT: { timeZone: tz } }, data: { timeZone: tz } });
  return true;
}
