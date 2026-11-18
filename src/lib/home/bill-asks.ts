import { db } from "../db";
import { claimJob, finishJob, sendPushTo } from "../push";
import { DEFAULT_TIME_ZONE } from "../dates";
import { isNudgeHour } from "../local-time";
import { zonesOf } from "../nudge-zones";
import { payerFor } from "./bills";

// "Electricity is due. Enter the amount when you have the bill." goes to whoever pays, in their daytime (06:00-22:00 where they are;
// India's for someone whose phone hasn't told us its zone). At night nothing is sent and the bill's month stays waiting: sendBillAsks
// (a part of the daily job) asks later. Each (bill month, person) is asked once: the claim key is billask:<run id>:m:<member id>.

export type BillAsk = { name: string; billId: string; groupId: string; period: string };
export const billAskPayload = (a: BillAsk) => ({
  title: `🧾 ${a.name}`,
  body: `${a.name} is due. Enter the amount when you have the bill.`,
  url: `/groups/${a.groupId}/add?bill=${a.billId}&period=${a.period}`,
  tag: `bill-${a.billId}-${a.period}`,
});

// Written once, by the first run that reaches here. Only bill months created after it are asked for again later: the ones already
// waiting when this went live were asked the old way (at once), and must not be asked a second time.
export const BILL_ASKS_LIVE_KEY = "bill-asks-live";
export async function billAsksLiveAt(now: Date = new Date()): Promise<Date> {
  const found = await db.notifyLog.findUnique({ where: { key: BILL_ASKS_LIVE_KEY }, select: { createdAt: true } });
  if (found) return found.createdAt;
  const at = new Date(Math.min(now.getTime(), Date.now()) - 1);
  try {
    return (await db.notifyLog.create({ data: { key: BILL_ASKS_LIVE_KEY, state: "done", createdAt: at }, select: { createdAt: true } })).createdAt;
  } catch {
    return (await db.notifyLog.findUniqueOrThrow({ where: { key: BILL_ASKS_LIVE_KEY }, select: { createdAt: true } })).createdAt;
  }
}

// Ask `payer` now if it is daytime for them. Returns "sent", "night" (not sent: ask again later) or "asked" (they already were).
export async function askBill(runId: string, payer: string, ask: BillAsk, now: Date = new Date(), zone?: string): Promise<"sent" | "night" | "asked"> {
  await billAsksLiveAt(now); // mark the switch-over before the first ask (see billAsksLiveAt)
  const tz = zone ?? (await zonesOf([payer], now)).get(payer) ?? "";
  if (!isNudgeHour(now, tz || DEFAULT_TIME_ZONE)) return "night";
  const key = `billask:${runId}:m:${payer}`;
  if (!(await claimJob(key, now))) return "asked";
  await sendPushTo([payer], billAskPayload(ask), "reminders.bills");
  await finishJob(key);
  return "sent";
}

// The daily job's part: bill months that are waiting for an amount whose payer has not been asked yet (it was night for them).
// `legacy: false` = it is night in India: payers with no zone are left for a later run.
export async function sendBillAsks(now: Date = new Date(), stop: () => boolean = () => false, opts: { legacy?: boolean } = {}) {
  const legacyOk = opts.legacy !== false;
  const live = await billAsksLiveAt(now);
  const from = new Date(Math.max(live.getTime(), now.getTime() - 35 * 86_400_000));
  const runs = await db.billRun.findMany({
    where: { status: "waiting", reason: "", requestKey: "", createdAt: { gte: from }, bill: { nature: "varies", deletedAt: null, paused: false, group: { deletedAt: null, closed: false } } },
    include: { bill: { include: { group: { select: { id: true, members: { select: { id: true, leftAt: true } } } } } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 500,
  });
  const payers = runs.map((r) => payerFor(r.bill, r.period, r.bill.group.members.filter((m) => !m.leftAt).map((m) => m.id)));
  const zones = await zonesOf(payers.filter((p): p is string => !!p), now);
  let sent = 0;
  let deferred = false;
  for (const [i, run] of runs.entries()) {
    const payer = payers[i];
    if (!payer) continue; // nobody to ask (the bill's own "payer left" message covers it)
    if (stop()) { deferred = true; break; }
    const zone = zones.get(payer) ?? "";
    if (!zone && !legacyOk) { deferred = true; continue; }
    const r = await askBill(run.id, payer, { name: run.bill.name, billId: run.bill.id, groupId: run.bill.group.id, period: run.period }, now, zone);
    if (r === "sent") sent++;
    else if (r === "night") deferred = true;
  }
  return { runs: runs.length, sent, deferred };
}
