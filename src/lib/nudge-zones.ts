import { db } from "./db";
import { cleanTimeZone, isNudgeHour, localDays } from "./local-time";

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

export async function zonesLiveAt(): Promise<Date> {
  const found = await db.notifyLog.findUnique({ where: { key: ZONES_LIVE_KEY }, select: { createdAt: true } });
  if (found) return found.createdAt;
  try {
    return (await db.notifyLog.create({ data: { key: ZONES_LIVE_KEY, state: "done" }, select: { createdAt: true } })).createdAt;
  } catch {
    // Another run wrote it at the same moment: read theirs.
    return (await db.notifyLog.findUniqueOrThrow({ where: { key: ZONES_LIVE_KEY }, select: { createdAt: true } })).createdAt;
  }
}

// True if the old per-group record for this nudge was finished by the old code (before the switch-over).
export async function coveredByOldRecord(oldKey: string): Promise<boolean> {
  const row = await db.notifyLog.findUnique({ where: { key: oldKey }, select: { state: true, createdAt: true } });
  if (row?.state !== "done") return false;
  return row.createdAt < (await zonesLiveAt());
}

// member id -> zone ("" = not known). Never throws (a failure reads as "not known", i.e. today's behaviour).
export async function zonesOf(memberIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(memberIds)];
  if (!ids.length) return out;
  try {
    await zonesLiveAt(); // mark the switch-over before this run sends anything (see coveredByOldRecord)
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

export type ZonedPerson = { id: string; tz: string; yesterday: string; today: string; tomorrow: string; daytime: boolean };

// Splits people into those with no zone yet (old path) and those with one (with their own days and whether it is daytime for them now).
export function splitByZone(memberIds: string[], zones: Map<string, string>, now: Date): { legacy: string[]; zoned: ZonedPerson[] } {
  const legacy: string[] = [];
  const zoned: ZonedPerson[] = [];
  for (const id of memberIds) {
    const tz = zones.get(id) ?? "";
    if (!tz) legacy.push(id);
    else zoned.push({ id, tz, ...localDays(now, tz), daytime: isNudgeHour(now, tz) });
  }
  return { legacy, zoned };
}

// Saves a zone sent by a phone: to the signed-in account (if any) and to this phone's people in their groups.
// Returns false (and saves nothing) for anything that is not a real zone name.
export async function saveTimeZone(raw: unknown, accountId: string | null, memberIds: string[]): Promise<boolean> {
  const tz = cleanTimeZone(raw);
  if (!tz) return false;
  if (accountId) await db.account.updateMany({ where: { id: accountId, NOT: { timeZone: tz } }, data: { timeZone: tz } });
  const ids = [...new Set(memberIds)].filter((x) => typeof x === "string" && x).slice(0, 500);
  if (ids.length) await db.member.updateMany({ where: { id: { in: ids }, NOT: { timeZone: tz } }, data: { timeZone: tz } });
  return true;
}
