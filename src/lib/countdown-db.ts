import { db } from "./db";
import { claimOnce, sendPushTo } from "./push";
import { dayKey, DEFAULT_TIME_ZONE } from "./dates";
import { NUDGE_DAYS, afterTripNudge, countdownNudge, daysBetween, placeOf } from "./countdown";

// The daily job (morning, India time): nudges to everyone in a trip 60, 45, 30,
// 14, 7, 3 and 1 days before it starts, on the morning itself, and the day after it
// ends (settle up). Each trip gets each nudge once, even if the job runs twice.
export async function sendTripCountdowns(now = new Date()) {
  const today = dayKey(now, DEFAULT_TIME_ZONE);
  const lastDay = dayKey(new Date(now.getTime() + Math.max(...NUDGE_DAYS) * 86_400_000), DEFAULT_TIME_ZONE);
  const trips = await db.group.findMany({
    where: { type: "trip", deletedAt: null, closed: false, tripStart: { gte: today, lte: lastDay } },
    select: { id: true, name: true, tripStart: true, members: { where: { leftAt: null }, select: { id: true } } },
  });
  let sent = 0;
  for (const g of trips) {
    const left = daysBetween(today, g.tripStart);
    const body = countdownNudge(g, left);
    if (!body || !(await claimOnce(`countdown:${g.id}:${g.tripStart}:${left}`))) continue;
    sent += await sendPushTo(
      g.members.map((m) => m.id),
      { title: left === 0 ? `${placeOf(g.name)} day!` : g.name, body, url: `/groups/${g.id}`, tag: `countdown:${g.id}` },
    );
  }
  // The day after a trip ends: "Back from Goa? Settle up in one tap" (only for trips where something was spent).
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000), DEFAULT_TIME_ZONE);
  const ended = await db.group.findMany({
    where: {
      type: "trip",
      deletedAt: null,
      closed: false,
      expenses: { some: { deletedAt: null } },
      OR: [{ tripEnd: yesterday }, { tripEnd: "", tripStart: yesterday }],
    },
    select: { id: true, name: true, members: { where: { leftAt: null }, select: { id: true } } },
  });
  for (const g of ended) {
    if (!(await claimOnce(`countdown-after:${g.id}:${yesterday}`))) continue;
    sent += await sendPushTo(
      g.members.map((m) => m.id),
      { title: g.name, body: afterTripNudge(g), url: `/groups/${g.id}/settle`, tag: `countdown:${g.id}` },
    );
  }
  return { trips: trips.length, ended: ended.length, sent };
}
