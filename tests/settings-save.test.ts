import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { markupFromForm, saveAllSettings } from "@/lib/settings-save";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import { parseNotify } from "@/lib/notify-prefs";
import { currencyLine } from "@/lib/currency-line";

// Settings has ONE Save. It checks every part first and writes nothing if any part is wrong; it only
// logs the parts that really changed; the currency is for the person who looks after the group
// (and goes through the confirm-the-rate step when the group already holds money); notification
// choices are always the saver's own.

let groupId = "";
let asha = "", ravi = "";
const today = "2026-11-11";

const events = (kind?: string) => db.groupEvent.count({ where: { groupId, ...(kind ? { kind } : {}) } });
const group = () => db.group.findUniqueOrThrow({ where: { id: groupId } });

beforeAll(async () => {
  const now = new Date();
  const g = await db.group.create({
    data: {
      name: "Goa",
      currency: "INR",
      type: "other",
      inviteCode: `set-${Date.now()}`,
      members: { create: [{ name: "Asha", claimedAt: now, createdAt: new Date(now.getTime() - 2000) }, { name: "Ravi", claimedAt: now, createdAt: new Date(now.getTime() - 1000) }] },
    },
    include: { members: true },
  });
  groupId = g.id;
  asha = g.members.find((m) => m.name === "Asha")!.id;
  ravi = g.members.find((m) => m.name === "Ravi")!.id;
});

afterAll(async () => {
  await db.groupEvent.deleteMany({ where: { groupId } });
  await db.expenseShare.deleteMany({ where: { expense: { groupId } } });
  await db.expense.deleteMany({ where: { groupId } });
  await db.member.deleteMany({ where: { groupId } });
  await db.group.delete({ where: { id: groupId } });
});

describe("the one Save", () => {
  it("reads the card fee: presets, custom, and refuses nonsense", () => {
    expect(markupFromForm("300", "")).toBe(300);
    expect(markupFromForm("custom", "3.5")).toBe(350);
    expect(markupFromForm("custom", "55")).toBeNull(); // over 20%
    expect(markupFromForm("custom", "abc")).toBeNull();
    expect(markupFromForm("999", "")).toBeNull();
  });

  it("a bad card fee saves nothing, not even the new name", async () => {
    const r = await saveAllSettings(groupId, asha, { name: "Goa renamed", markup: "custom", customMarkup: "55" }, today);
    expect(r).toMatchObject({ ok: false, code: "markup" });
    expect((await group()).name).toBe("Goa");
    expect(await events()).toBe(0);
  });

  it("bad shares save nothing either (the name stays, no history)", async () => {
    const r = await saveAllSettings(groupId, asha, { name: "Goa renamed", sharing: { type: "other", weights: { [asha]: "abc" } } }, today);
    expect(r.ok).toBe(false);
    expect((await group()).name).toBe("Goa");
    expect(await events()).toBe(0);
  });

  it("someone who doesn't look after the group can't change the currency, and nothing else of theirs is saved either", async () => {
    const r = await saveAllSettings(groupId, ravi, { name: "Ravi's name", currency: "USD" }, today);
    expect(r).toMatchObject({ ok: false, code: "admin" });
    const g = await group();
    expect(g.currency).toBe("INR");
    expect(g.name).toBe("Goa");
  });

  it("the person who looks after it saves name, card fee, second currency and their notifications together; each change is logged once", async () => {
    const r = await saveAllSettings(
      groupId,
      asha,
      { name: "Goa 2026", markup: "300", customMarkup: "", secondaryCurrency: "USD", currency: "INR", notify: { all: true, expenses: true, edits: true, payments: false, people: true } },
      today,
    );
    expect(r.ok).toBe(true);
    const g = await group();
    expect(g).toMatchObject({ name: "Goa 2026", cardMarkupBp: 300, secondaryCurrency: "USD", currency: "INR" });
    expect(await events("group_renamed")).toBe(1);
    expect(await events("markup_changed")).toBe(1);
    expect(await events("display_currency_changed")).toBe(1);
    expect(await events("currency_changed")).toBe(0);
    // Their notification choice is theirs alone.
    const mine = await db.member.findUniqueOrThrow({ where: { id: asha }, select: { notify: true } });
    const his = await db.member.findUniqueOrThrow({ where: { id: ravi }, select: { notify: true } });
    expect(parseNotify(mine.notify).payments).toBe(false);
    expect(parseNotify(his.notify).payments).toBe(true);
  });

  it("saving the same values again logs nothing new", async () => {
    const before = await events();
    const r = await saveAllSettings(groupId, asha, { name: "Goa 2026", markup: "300", secondaryCurrency: "USD", currency: "INR", notify: { all: true, expenses: true, edits: true, payments: false, people: true } }, today);
    expect(r.ok).toBe(true);
    expect(await events()).toBe(before);
  });

  it("a member who isn't the admin can still save everything else, and their own notifications", async () => {
    const r = await saveAllSettings(groupId, ravi, { name: "Goa 2026!", currency: "INR", notify: { all: false, expenses: true, edits: true, payments: true, people: true } }, today);
    expect(r.ok).toBe(true);
    expect((await group()).name).toBe("Goa 2026!");
    expect(parseNotify((await db.member.findUniqueOrThrow({ where: { id: ravi }, select: { notify: true } })).notify).off).toBe(true);
    expect(parseNotify((await db.member.findUniqueOrThrow({ where: { id: asha }, select: { notify: true } })).notify).off).toBe(false);
  });

  it("with no money in the group, a new currency is applied straight away; with money it goes to the confirm-the-rate step", async () => {
    const empty = await saveAllSettings(groupId, asha, { currency: "EUR" }, today);
    expect(empty).toMatchObject({ ok: true });
    expect((empty as { convertTo?: string }).convertTo).toBeUndefined();
    expect((await group()).currency).toBe("EUR");
    expect(await events("currency_changed")).toBe(1);

    // Money now in the group: ₹ is EUR here, one 90.00 dinner shared by two.
    const input: SaveExpenseInput = {
      groupId, name: "Dinner", category: "", amount: "90", currency: "EUR", paidById: asha, forMode: "everyone",
      selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
      markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "",
    };
    const saved = await saveExpense(input, asha, async () => ({ ok: true, rate: "1", date: "2026-11-11" }));
    expect(saved.ok).toBe(true);
    const r = await saveAllSettings(groupId, asha, { name: "Goa final", currency: "GBP" }, today);
    expect(r).toMatchObject({ ok: true, convertTo: "GBP" });
    const g = await group();
    expect(g.name).toBe("Goa final"); // the rest was saved
    expect(g.currency).toBe("EUR"); // the currency waits for the confirmed rate
  });

  it("an unknown currency is refused for the admin too", async () => {
    const r = await saveAllSettings(groupId, asha, { currency: "ZZZ" }, today);
    expect(r).toMatchObject({ ok: false, code: "currency" });
  });

  it("the currency sentence, same words when making a group and in Settings", () => {
    expect(currencyLine("INR")).toBe("Balances in INR; add expenses in any currency.");
    expect(currencyLine("USD")).toBe("Balances in USD; add expenses in any currency.");
  });
});
