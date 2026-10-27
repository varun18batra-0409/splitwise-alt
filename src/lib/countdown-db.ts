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

// The day-end pulse (evening, India time): for each trip happening today with
// something spent today, one playful line to everyone in it. Once a day per trip.
export async function sendDayPulse(now = new Date()) {
  const { pulseText } = await import("./pulse");
  const { spentAmount, payersOf } = await import("./payers");
  const today = dayKey(now, DEFAULT_TIME_ZONE);
  const trips = await db.group.findMany({
    where: { type: "trip", deletedAt: null, closed: false, tripStart: { lte: today, not: "" } },
    select: { id: true, name: true, currency: true, tripStart: true, tripEnd: true, members: { where: { leftAt: null }, select: { id: true, name: true } } },
  });
  let sent = 0;
  for (const g of trips) {
    const end = g.tripEnd || g.tripStart;
    if (end < today) continue;
    const since = new Date(now.getTime() - 20 * 3_600_000);
    const expenses = await db.expense.findMany({ where: { groupId: g.id, deletedAt: null, kind: "expense", createdAt: { gte: since } } });
    const todays = expenses.filter((e) => dayKey(e.spentAt ?? e.createdAt, DEFAULT_TIME_ZONE) === today);
    if (!todays.length || !(await claimOnce(`pulse:${g.id}:${today}`))) continue;
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
  }
  return { sent };
}

// Memory lane (morning): "A year ago today: Goa" to everyone who went.
export async function sendMemoryLane(now = new Date()) {
  const { memoryText } = await import("./pulse");
  const today = dayKey(now, DEFAULT_TIME_ZONE);
  const md = today.slice(4); // "-10-27"
  const trips = await db.group.findMany({
    where: { type: "trip", deletedAt: null, tripStart: { endsWith: md, lt: `${today.slice(0, 4)}-01-01` } },
    select: { id: true, name: true, tripStart: true, tripEnd: true, members: { where: { leftAt: null }, select: { id: true } } },
  });
  let sent = 0;
  for (const g of trips) {
    const years = Number(today.slice(0, 4)) - Number(g.tripStart.slice(0, 4));
    if (years < 1 || !(await claimOnce(`memory:${g.id}:${today}`))) continue;
    const body = memoryText({ place: placeOf(g.name), years, people: g.members.length, days: g.tripEnd ? daysBetween(g.tripStart, g.tripEnd) + 1 : 1 });
    sent += await sendPushTo(g.members.map((m) => m.id), { title: `📸 ${g.name}`, body, url: `/groups/${g.id}/wrapped`, tag: `memory:${g.id}` });
  }
  return { sent };
}
