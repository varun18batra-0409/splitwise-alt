import { db } from "./db";
import { claimOnce, sendPushTo } from "./push";
import { dayKey, DEFAULT_TIME_ZONE } from "./dates";
import { NUDGE_DAYS, countdownNudge, daysBetween, placeOf } from "./countdown";

// The daily job (morning, India time): a nudge to everyone in a trip a month,
// a week and a day before it starts, and on the morning itself. Each trip gets
// each nudge once, even if the job runs twice.
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
  return { trips: trips.length, sent };
}
