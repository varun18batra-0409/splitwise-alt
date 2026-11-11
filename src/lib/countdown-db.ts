import { db } from "./db";
import { claimJob, finishJob, sendPushTo } from "./push";
import { JOINED } from "./membership";
import { dayKey, DEFAULT_TIME_ZONE } from "./dates";
import { addDays } from "./local-time";
import { coveredByOldRecord, splitByZone, zonesOf } from "./nudge-zones";
import { NUDGE_DAYS, afterTripNudge, countdownNudge, daysBetween, placeOf } from "./countdown";

// The daily job (morning, India time): nudges to everyone in a trip 60, 45, 30,
// 14, 7, 3 and 1 days before it starts, on the morning itself, and the day after it
// ends (settle up). Each trip gets each nudge once, even if the job runs twice.
// People whose phone has told us its time zone get these on their own days and only in their
// daytime (06:00-22:00 there), once per person per local day; everyone else keeps the trip's India-time claim.
// `legacy: false` = it is night in India: only people with a zone of their own are sent to.
export async function sendTripCountdowns(now = new Date(), stop: () => boolean = () => false, opts: { legacy?: boolean } = {}) {
  const legacyOk = opts.legacy !== false;
  const today = dayKey(now, DEFAULT_TIME_ZONE);
  const lastDay = addDays(today, Math.max(...NUDGE_DAYS) + 1);
  // A day either side of India's, so people a few hours ahead of or behind it are found too.
  const trips = await db.group.findMany({
    where: { type: "trip", deletedAt: null, closed: false, tripStart: { gte: addDays(today, -1), lte: lastDay } },
    select: { id: true, name: true, tripStart: true, members: { where: { leftAt: null, ...JOINED }, select: { id: true } } },
  });
  const yesterday = addDays(today, -1);
  const ended = await db.group.findMany({
    where: {
      type: "trip",
      deletedAt: null,
      closed: false,
      expenses: { some: { deletedAt: null } },
      OR: [{ tripEnd: { in: [addDays(yesterday, -1), yesterday, addDays(yesterday, 1)] } }, { tripEnd: "", tripStart: { in: [addDays(yesterday, -1), yesterday, addDays(yesterday, 1)] } }],
    },
    select: { id: true, name: true, tripStart: true, tripEnd: true, members: { where: { leftAt: null, ...JOINED }, select: { id: true } } },
  });
  const zones = await zonesOf([...trips, ...ended].flatMap((g) => g.members.map((m) => m.id)), now);
  let sent = 0;
  let deferred = false;
  for (const g of trips) {
    const { legacy, zoned } = splitByZone(g.members.map((m) => m.id), zones, now);
    const left = daysBetween(today, g.tripStart);
    const body = countdownNudge(g, left);
    if (body && legacy.length) {
      if (stop()) { deferred = true; break; }
      const key = `countdown:${g.id}:${g.tripStart}:${left}`;
      if (legacyOk && (await claimJob(key, now))) {
        sent += await sendPushTo(legacy, { title: left === 0 ? `${placeOf(g.name)} day!` : g.name, body, url: `/groups/${g.id}`, tag: `countdown:${g.id}` });
        await finishJob(key);
      }
    }
    for (const p of zoned) {
      // At night, look at the day of their next daytime, so a later run is asked for (see ZonedPerson.ahead).
      const days = daysBetween(p.daytime ? p.today : p.ahead, g.tripStart);
      const text = countdownNudge(g, days);
      if (!text) continue;
      if (!p.daytime) { deferred = true; continue; }
      if (stop()) { deferred = true; break; }
      const oldKey = `countdown:${g.id}:${g.tripStart}:${days}`;
      const key = `${oldKey}:m:${p.id}`;
      if (await coveredByOldRecord(oldKey, now, p.id)) continue;
      if (!(await claimJob(key, now))) continue;
      sent += await sendPushTo([p.id], { title: days === 0 ? `${placeOf(g.name)} day!` : g.name, body: text, url: `/groups/${g.id}`, tag: `countdown:${g.id}` });
      await finishJob(key);
    }
  }
  // The day after a trip ends: "Back from Goa? Settle up in one tap" (only for trips where something was spent).
  for (const g of ended) {
    const endDay = g.tripEnd || g.tripStart;
    const { legacy, zoned } = splitByZone(g.members.map((m) => m.id), zones, now);
    if (endDay === yesterday && legacy.length) {
      if (stop()) { deferred = true; break; }
      const key = `countdown-after:${g.id}:${yesterday}`;
      if (legacyOk && (await claimJob(key, now))) {
        sent += await sendPushTo(legacy, { title: g.name, body: afterTripNudge(g), url: `/groups/${g.id}/settle`, tag: `countdown:${g.id}` });
        await finishJob(key);
      }
    }
    for (const p of zoned) {
      if (endDay !== addDays(p.daytime ? p.today : p.ahead, -1)) continue;
      if (!p.daytime) { deferred = true; continue; }
      if (stop()) { deferred = true; break; }
      const oldKey = `countdown-after:${g.id}:${p.yesterday}`;
      const key = `${oldKey}:m:${p.id}`;
      if (await coveredByOldRecord(oldKey, now, p.id)) continue;
      if (!(await claimJob(key, now))) continue;
      sent += await sendPushTo([p.id], { title: g.name, body: afterTripNudge(g), url: `/groups/${g.id}/settle`, tag: `countdown:${g.id}` });
      await finishJob(key);
    }
  }
  return { trips: trips.length, ended: ended.length, sent, deferred };
}

// The day-end pulse (evening, India time): for each trip happening today with
// something spent today, one playful line to everyone in it. Once a day per trip.
export async function sendDayPulse(now = new Date(), stop: () => boolean = () => false) {
  const { pulseText } = await import("./pulse");
  const { spentAmount, payersOf } = await import("./payers");
  const today = dayKey(now, DEFAULT_TIME_ZONE);
  const trips = await db.group.findMany({
    where: { type: "trip", deletedAt: null, closed: false, tripStart: { lte: today, not: "" } },
    select: { id: true, name: true, currency: true, tripStart: true, tripEnd: true, members: { where: { leftAt: null, ...JOINED }, select: { id: true, name: true } } },
  });
  let sent = 0;
  let deferred = false;
  for (const g of trips) {
    if (stop()) { deferred = true; break; }
    const end = g.tripEnd || g.tripStart;
    if (end < today) continue;
    const since = new Date(now.getTime() - 20 * 3_600_000);
    const expenses = await db.expense.findMany({ where: { groupId: g.id, deletedAt: null, kind: "expense", createdAt: { gte: since } } });
    const todays = expenses.filter((e) => dayKey(e.spentAt ?? e.createdAt, DEFAULT_TIME_ZONE) === today);
    const key = `pulse:${g.id}:${today}`;
    if (!todays.length || !(await claimJob(key, now))) continue;
    const spent = todays.reduce((s, e) => s + spentAmount(e), 0);
    const paid = new Map<string, number>();
    for (const e of todays) for (const p of payersOf(e)) paid.set(p.memberId, (paid.get(p.memberId) ?? 0) + p.amount);
    const [topId, topAmt] = [...paid].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    const body = pulseText({
      place: placeOf(g.name),
      day: daysBetween(g.tripStart, today) + 1,
      of: daysBetween(g.tripStart, end) + 1,
      spent,
      currency: g.currency,
      count: todays.length,
      topPayer: g.members.find((m) => m.id === topId)?.name.split(" ")[0],
      topShare: spent ? topAmt / spent : 0,
    });
    sent += await sendPushTo(g.members.map((m) => m.id), { title: `🌙 ${g.name}`, body, url: `/groups/${g.id}?tab=activity`, tag: `pulse:${g.id}` });
    await finishJob(key);
  }
  return { sent, deferred };
}

// Memory lane (morning): "A year ago today: Goa" to everyone who went. In each person's own daytime and
// on their own date once their phone has told us its zone (see sendTripCountdowns).
export async function sendMemoryLane(now = new Date(), stop: () => boolean = () => false, opts: { legacy?: boolean } = {}) {
  const legacyOk = opts.legacy !== false;
  const { memoryText } = await import("./pulse");
  const today = dayKey(now, DEFAULT_TIME_ZONE);
  const days = [addDays(today, -1), today, addDays(today, 1)];
  const trips = await db.group.findMany({
    where: { type: "trip", deletedAt: null, OR: days.map((d) => ({ tripStart: { endsWith: d.slice(4) } })), tripStart: { lt: `${days[2].slice(0, 4)}-01-01` } },
    select: { id: true, name: true, tripStart: true, tripEnd: true, members: { where: { leftAt: null, ...JOINED }, select: { id: true } } },
  });
  const zones = await zonesOf(trips.flatMap((g) => g.members.map((m) => m.id)), now);
  let sent = 0;
  let deferred = false;
  const lineFor = (g: (typeof trips)[number], day: string, people: number) => {
    const years = Number(day.slice(0, 4)) - Number(g.tripStart.slice(0, 4));
    if (years < 1 || !g.tripStart.endsWith(day.slice(4))) return null;
    return { title: `📸 ${g.name}`, body: memoryText({ place: placeOf(g.name), years, people, days: g.tripEnd ? daysBetween(g.tripStart, g.tripEnd) + 1 : 1 }), url: `/groups/${g.id}/wrapped`, tag: `memory:${g.id}` };
  };
  for (const g of trips) {
    if (stop()) { deferred = true; break; }
    const { legacy, zoned } = splitByZone(g.members.map((m) => m.id), zones, now);
    const line = legacy.length ? lineFor(g, today, g.members.length) : null;
    const key = `memory:${g.id}:${today}`;
    if (line && legacyOk && (await claimJob(key, now))) {
      sent += await sendPushTo(legacy, line);
      await finishJob(key);
    }
    for (const p of zoned) {
      const own = lineFor(g, p.daytime ? p.today : p.ahead, g.members.length);
      if (!own) continue;
      if (!p.daytime) { deferred = true; continue; }
      const oldKey = `memory:${g.id}:${p.today}`;
      const personKey = `${oldKey}:m:${p.id}`;
      if (await coveredByOldRecord(oldKey, now, p.id)) continue;
      if (!(await claimJob(personKey, now))) continue;
      sent += await sendPushTo([p.id], own);
      await finishJob(personKey);
    }
  }
  return { sent, deferred };
}
