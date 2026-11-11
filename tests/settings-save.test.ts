import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { markupFromForm, saveAllSettings, settingsSnapshot, type SettingsForm, type SettingsWas } from "@/lib/settings-save";
import { changeGroupCurrency } from "@/lib/group-changes";
import { eraseGroups } from "@/lib/purge";
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

// ---- Round 2: the form carries what it was drawn with; one transaction; section-specific messages ----
// Every test below makes its own group and people (nothing is shared with the tests above).

const made: string[] = [];
afterAll(async () => {
  await eraseGroups(made);
});

async function mk(type: string, names: string[], weights: number[] = []) {
  const stamp = Date.now();
  const g = await db.group.create({
    data: {
      name: `Round2 ${type}`,
      currency: "INR",
      type,
      inviteCode: `r2-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
      members: { create: names.map((n, i) => ({ name: n, claimedAt: new Date(), createdAt: new Date(stamp - (names.length - i) * 1000), splitWeight: weights[i] ?? 100 })) },
    },
  });
  made.push(g.id);
  const ids = Object.fromEntries((await db.member.findMany({ where: { groupId: g.id } })).map((m) => [m.name, m.id])) as Record<string, string>;
  return { id: g.id, ids };
}
const load = (id: string) => db.group.findUniqueOrThrow({ where: { id }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
const count = (id: string, kind?: string) => db.groupEvent.count({ where: { groupId: id, ...(kind ? { kind } : {}) } });
const weightOf = async (id: string) => Object.fromEntries((await load(id)).members.map((m) => [m.name, m.splitWeight]));

// What the page sends when nothing was touched (every box as drawn), plus the changes on top.
function pageForm(was: SettingsWas, over: Partial<SettingsForm> & { weights?: Record<string, string> } = {}): SettingsForm {
  const { weights, ...rest } = over;
  const preset = ["0", "200", "300", "400"].includes(was.markup!);
  return {
    name: was.name,
    markup: preset ? was.markup : "custom",
    customMarkup: preset ? "" : String(Number(was.markup) / 100),
    secondaryCurrency: was.secondaryCurrency,
    currency: was.currency,
    cover: was.cover,
    sharing: { type: was.type!, weights: weights ?? { ...was.weights } },
    notify: { all: !JSON.parse(was.notify!).off, expenses: true, edits: true, payments: true, people: true },
    was,
    ...rest,
  };
}
const drawn = async (id: string) => {
  const g = await load(id);
  return settingsSnapshot(g, g.members);
};

describe("Save never undoes what someone else changed meanwhile", () => {
  it("Ravi sets Meera to 1.5 after Asha opened the page; Asha changes only the cover: Meera stays 1.5 and nothing says costs were re-shared", async () => {
    const g = await mk("other", ["Asha", "Ravi", "Meera"]);
    const was = await drawn(g.id); // Asha opens Settings: everyone 1 share
    expect(was.weights).toEqual({ [g.ids.Asha]: "1", [g.ids.Ravi]: "1", [g.ids.Meera]: "1" });
    // Ravi's own Save, in between.
    const ravi = await saveAllSettings(g.id, g.ids.Ravi, pageForm(was, { weights: { ...was.weights, [g.ids.Meera]: "1.5" } }), today);
    expect(ravi.ok).toBe(true);
    expect((await weightOf(g.id)).Meera).toBe(150);
    expect(await count(g.id, "split_changed")).toBe(1);
    // Asha saves her (older) page with only the cover changed.
    const r = await saveAllSettings(g.id, g.ids.Asha, pageForm(was, { cover: "city" }), today);
    expect(r.ok).toBe(true);
    expect((await load(g.id)).cover).toBe("city");
    expect((await weightOf(g.id)).Meera).toBe(150); // Ravi's change is still there
    expect(await count(g.id, "split_changed")).toBe(1); // no second "changed how costs are shared"
    expect(await count(g.id, "group_renamed")).toBe(0);
  });

  it("if Asha also changed the shares, her Save is refused with Ravi's name, and nothing of hers is saved", async () => {
    const g = await mk("other", ["Asha", "Ravi", "Meera"]);
    const was = await drawn(g.id);
    await saveAllSettings(g.id, g.ids.Ravi, pageForm(was, { weights: { ...was.weights, [g.ids.Meera]: "1.5" } }), today);
    const r = await saveAllSettings(g.id, g.ids.Asha, pageForm(was, { name: "Asha's new name", weights: { ...was.weights, [g.ids.Meera]: "2" } }), today);
    expect(r).toEqual({ ok: false, error: "Ravi changed how costs are shared while you were editing. Check and save again.", code: "conflict" });
    const after = await load(g.id);
    expect(after.name).toBe("Round2 other"); // not renamed
    expect((await weightOf(g.id)).Meera).toBe(150);
    expect(await count(g.id, "group_renamed")).toBe(0);
  });

  it("someone else renamed the group; I changed only the card fee: their name stays. If I renamed it too, my Save is refused", async () => {
    const g = await mk("other", ["Asha", "Ravi"]);
    const was = await drawn(g.id);
    await saveAllSettings(g.id, g.ids.Ravi, { name: "Ravi's name" }, today);
    const fee = await saveAllSettings(g.id, g.ids.Asha, pageForm(was, { markup: "400" }), today);
    expect(fee.ok).toBe(true);
    const mid = await load(g.id);
    expect(mid.name).toBe("Ravi's name");
    expect(mid.cardMarkupBp).toBe(400);
    const clash = await saveAllSettings(g.id, g.ids.Asha, pageForm(was, { name: "Asha's name", markup: "0" }), today);
    expect(clash).toMatchObject({ ok: false, code: "conflict", error: "Ravi changed the group name while you were editing. Check and save again." });
    expect((await load(g.id)).cardMarkupBp).toBe(400); // nothing of that Save went in
  });

  it("a couple split of 1:2 (drawn as 33 / 67) survives a plain rename exactly", async () => {
    const g = await mk("couple", ["Asha", "Ravi"], [100, 200]);
    const was = await drawn(g.id);
    expect(was.weights).toEqual({ [g.ids.Asha]: "33", [g.ids.Ravi]: "67" });
    const r = await saveAllSettings(g.id, g.ids.Asha, pageForm(was, { name: "Us, renamed", settle: { reminders: false, settleDay: 0, settleMin: "" } }), today);
    expect(r.ok).toBe(true);
    expect((await load(g.id)).name).toBe("Us, renamed");
    expect(await weightOf(g.id)).toEqual({ Asha: 100, Ravi: 200 }); // not 33 / 67
    expect(await count(g.id, "split_changed")).toBe(0);
    // Without the drawn values (an older form) the boxes would have been rewritten; that is what `was` prevents.
    const legacy = await saveAllSettings(g.id, g.ids.Asha, { sharing: { type: "couple", weights: { [g.ids.Asha]: "33", [g.ids.Ravi]: "67" } } }, today);
    expect(legacy.ok).toBe(true);
    expect(await weightOf(g.id)).toEqual({ Asha: 33, Ravi: 67 });
  });
});

describe("All or nothing", () => {
  it("a refused shares step leaves the name and the card fee (written earlier in the same Save) unchanged", async () => {
    const g = await mk("other", ["Asha", "Ravi"]);
    const r = await saveAllSettings(g.id, g.ids.Asha, { name: "Should not stick", markup: "300", sharing: { type: "other", weights: { [g.ids.Ravi]: "abc" } } }, today);
    expect(r).toMatchObject({ ok: false, error: "Enter shares like 1 or 1.5 (up to 20)." });
    const after = await load(g.id);
    expect(after.name).toBe("Round2 other");
    expect(after.cardMarkupBp).not.toBe(300);
    expect(await count(g.id)).toBe(0);
  });

  it("a refused settle-up minimum rolls back the name written just before it", async () => {
    const g = await mk("home", ["Asha", "Ravi"]);
    const r = await saveAllSettings(g.id, g.ids.Asha, { name: "Nope", sharing: { type: "home", weights: { [g.ids.Ravi]: "2" } }, settle: { reminders: true, settleDay: 5, settleMin: "abc" } }, today);
    expect(r).toMatchObject({ ok: false, error: "Enter the smallest amount as a number, like 50." });
    expect((await load(g.id)).name).toBe("Round2 home");
    expect((await weightOf(g.id)).Ravi).toBe(100);
    expect(await count(g.id)).toBe(0);
  });
});

describe("Who may save", () => {
  it("someone who left changes nothing", async () => {
    const g = await mk("other", ["Asha", "Ravi"]);
    await db.member.update({ where: { id: g.ids.Ravi }, data: { leftAt: new Date() } });
    const r = await saveAllSettings(g.id, g.ids.Ravi, { name: "From a leaver" }, today);
    expect(r).toEqual({ ok: false, error: "You left this group. Rejoin it to make changes." });
    expect((await load(g.id)).name).toBe("Round2 other");
  });

  it("someone from another group changes nothing", async () => {
    const g = await mk("other", ["Asha"]);
    const other = await mk("other", ["Stranger"]);
    const r = await saveAllSettings(g.id, other.ids.Stranger, { name: "From outside" }, today);
    expect(r).toEqual({ ok: false, error: "Only people in this group can change it." });
    expect((await load(g.id)).name).toBe("Round2 other");
  });

  it("a member who isn't the admin saves a plain edit with the currency box as drawn (unchanged), and a changed currency is still refused", async () => {
    const g = await mk("other", ["Asha", "Ravi"]);
    const was = await drawn(g.id);
    const ok = await saveAllSettings(g.id, g.ids.Ravi, pageForm(was, { name: "Ravi renamed" }), today);
    expect(ok.ok).toBe(true);
    const no = await saveAllSettings(g.id, g.ids.Ravi, pageForm(was, { currency: "USD" }), today);
    expect(no).toMatchObject({ ok: false, code: "admin" });
    expect((await load(g.id)).currency).toBe("INR");
  });
});

describe("Messages say which part is wrong", () => {
  it("an unsupported second currency says to pick from the list, not 'Give the group a name'", async () => {
    const g = await mk("other", ["Asha"]);
    const r = await saveAllSettings(g.id, g.ids.Asha, { secondaryCurrency: "ZZZ" }, today);
    expect(r).toEqual({ ok: false, error: "Pick a currency from the list.", code: "currency" });
  });

  it("an empty name still says to name the group", async () => {
    const g = await mk("other", ["Asha"]);
    const r = await saveAllSettings(g.id, g.ids.Asha, { name: "   " }, today);
    expect(r).toEqual({ ok: false, error: "Give the group a name.", code: "name" });
  });
});

describe("Currency step uses what was just saved", () => {
  it("empty flat: a new minimum of 50 and INR to JPY in one Save asks for the rate (the minimum is money), then converts it: 50 rupees at 2 is 100 yen", async () => {
    const g = await mk("home", ["Asha", "Ravi"]);
    const r = await saveAllSettings(g.id, g.ids.Asha, { currency: "JPY", settle: { reminders: false, settleDay: 0, settleMin: "50" } }, today);
    // Before the fix the old minimum (0) was checked, the group looked empty and the rate was silently taken as 1.
    expect(r).toMatchObject({ ok: true, convertTo: "JPY" });
    let after = await load(g.id);
    expect(after.currency).toBe("INR"); // waits for the confirmed rate
    expect(after.settleMin).toBe(5000); // saved as entered: 50.00 rupees in paise
    const c = await changeGroupCurrency(g.id, g.ids.Asha, "JPY", "2");
    expect(c.ok).toBe(true);
    after = await load(g.id);
    expect(after.currency).toBe("JPY");
    expect(after.settleMin).toBe(100); // 50 x 2 = 100 yen (yen have no decimals)
  });
});
