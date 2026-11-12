import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { billBadge, billHold } from "@/lib/home/bills";
import { billStatuses, runBillsForGroup } from "@/lib/home/bills-db";

// The state chip on each bill: Needs amount (orange) / Due today (gold) / Recorded (green) / Paused (grey),
// and nothing at all for a bill that is simply coming later. A bill due on the 1st; today is 1 Nov 2026 in the bill's time zone.

const tz = "Asia/Kolkata";
const nov1 = new Date("2026-11-01T06:00:00Z"); // 11:30 on 1 Nov in India
const f = { nature: "varies", status: "upcoming" as const, due: "2026-11-01", payerId: "a", reason: "", recordedThisMonth: false, tz, now: nov1 };

describe("billBadge", () => {
  it("not added yet, due today: Due today (gold)", () => {
    expect(billBadge(f)).toEqual({ id: "due-today", label: "Due today", tone: "gold" });
  });
  it("added this month: Recorded (green), even though the next one is a month away", () => {
    expect(billBadge({ ...f, recordedThisMonth: true, due: "2026-12-01" })).toEqual({ id: "recorded", label: "Recorded", tone: "green" });
  });
  it("a bill that varies and waits for its amount: Needs amount (orange)", () => {
    expect(billBadge({ ...f, status: "waiting" })).toEqual({ id: "needs-amount", label: "Needs amount", tone: "orange" });
  });
  it("a fixed bill held for a split problem is Needs a fix (orange), not Needs amount; a varies bill held for the same is too", () => {
    const fix = { id: "needs-fix", label: "Needs a fix", tone: "orange" };
    expect(billBadge({ ...f, nature: "fixed", status: "waiting", reason: "someone in the split has left" })).toEqual(fix);
    expect(billBadge({ ...f, nature: "varies", status: "waiting", reason: "someone in the split has left" })).toEqual(fix);
    expect(billBadge({ ...f, nature: "varies", status: "waiting", reason: "" })?.id).toBe("needs-amount");
  });
  it("a fixed or daily bill waiting with nothing wrong is Add it (not Needs a fix); a varies bill is still Needs amount", () => {
    const add = { id: "needs-add", label: "Add it", tone: "orange" };
    expect(billBadge({ ...f, nature: "fixed", status: "waiting", reason: "" })).toEqual(add);
    expect(billBadge({ ...f, nature: "daily", status: "waiting", reason: "" })).toEqual(add);
    expect(billHold({ nature: "fixed", reason: "", payerId: "a" })).toBe("add");
    expect(billHold({ nature: "varies", reason: "", payerId: "a" })).toBe("amount");
    expect(billHold({ nature: "fixed", reason: "group closed", payerId: "a" })).toBe("fix");
    expect(billHold({ nature: "fixed", reason: "", payerId: null })).toBe("payer");
  });
  it("waiting with nobody to pay it (the payer left): Needs a payer (orange)", () => {
    expect(billBadge({ ...f, status: "waiting", payerId: null, reason: "payer left" })).toEqual({ id: "needs-payer", label: "Needs a payer", tone: "orange" });
  });
  it("paused: Paused (grey), whatever else is true", () => {
    expect(billBadge({ ...f, status: "paused", due: "", recordedThisMonth: true })).toEqual({ id: "paused", label: "Paused", tone: "grey" });
  });
  it("due on the 15th: no chip", () => {
    expect(billBadge({ ...f, due: "2026-11-15" })).toBeNull();
  });
  it("'today' is the bill's own today: 00:30 on 1 Nov in India is still 31 Oct in Los Angeles", () => {
    const edge = new Date("2026-10-31T19:00:00Z");
    expect(billBadge({ ...f, now: edge })?.id).toBe("due-today");
    expect(billBadge({ ...f, now: edge, tz: "America/Los_Angeles" })).toBeNull();
  });
});

describe("billStatuses knows if this month's is recorded", () => {
  let groupId = "", you = "";
  beforeAll(async () => {
    const g = await db.group.create({ data: { name: "Badge flat", type: "home", currency: "INR", inviteCode: `badge-${Date.now()}`, members: { create: [{ name: "You" }, { name: "Asha" }] } }, include: { members: true } });
    groupId = g.id;
    you = g.members.find((m) => m.name === "You")!.id;
  });
  afterAll(async () => {
    await db.group.delete({ where: { id: groupId } }).catch(() => {});
  });

  it("Rent on the 1st: Due today before the job runs, Recorded after; Electricity (varies) Needs amount; a paused bill is Paused", async () => {
    await db.bill.create({ data: { groupId, name: "Rent", nature: "fixed", amount: 3000000, day: 1, startMonth: "2026-11", payer: you, tz } });
    await db.bill.create({ data: { groupId, name: "Electricity", nature: "varies", amount: 242000, day: 1, startMonth: "2026-11", payer: you, tz } });
    await db.bill.create({ data: { groupId, name: "Gym", nature: "fixed", amount: 100000, day: 1, startMonth: "2026-11", payer: you, tz, paused: true } });
    await db.bill.create({ data: { groupId, name: "Wi-Fi", nature: "fixed", amount: 120000, day: 15, startMonth: "2026-11", payer: you, tz } });
    const chip = async (name: string) => {
      const s = (await billStatuses(groupId, nov1)).find((x) => x.bill.name === name)!;
      return billBadge({ nature: s.bill.nature, status: s.status, due: s.due, payerId: s.payerId, reason: s.reason, recordedThisMonth: s.recordedThisMonth, tz: s.bill.tz, now: nov1 })?.id ?? null;
    };
    expect(await chip("Rent")).toBe("due-today");
    expect(await chip("Wi-Fi")).toBeNull();
    expect(await chip("Gym")).toBe("paused");
    await runBillsForGroup(groupId, nov1);
    expect(await chip("Rent")).toBe("recorded");
    expect(await chip("Electricity")).toBe("needs-amount");
    expect(await chip("Wi-Fi")).toBeNull();
  });

  it("a waiting run whose saved reason is a save error (not one the code can work out again) stays Needs a fix, never Add it; an out-of-date known reason is recomputed", async () => {
    const wait = async (name: string, reason: string) => {
      const bill = await db.bill.create({ data: { groupId, name, nature: "fixed", amount: 50000, day: 1, startMonth: "2026-11", payer: you, tz } });
      await db.billRun.create({ data: { billId: bill.id, period: "2026-11", status: "waiting", reason } });
      const s = (await billStatuses(groupId, nov1)).find((x) => x.bill.name === name)!;
      return { s, id: billBadge({ nature: s.bill.nature, status: s.status, due: s.due, payerId: s.payerId, reason: s.reason, recordedThisMonth: s.recordedThisMonth, tz, now: nov1 })?.id };
    };
    const err = await wait("Save error bill", "Amount is too large");
    expect(err.s.reason).toBe("Amount is too large");
    expect(err.id).toBe("needs-fix");
    const stale = await wait("Stale bill", "someone in the split has left"); // the split is fine now: nothing wrong any more
    expect(stale.s.reason).toBe("");
    expect(stale.id).toBe("needs-add");
  });
});
