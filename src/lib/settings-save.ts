import { db } from "./db";
import { hasLeft, LEFT_ERROR } from "./active";
import { cleanCover } from "./covers";
import { countryOf } from "./geo";
import { isGroupAdmin } from "./group-admin";
import { changeGroupCurrency, hasOtherMoney, loadOtherMoney, updateGroupBasics } from "./group-changes";
import { setTripDates, updateSharing } from "./group-setup";
import { saveSettleRulesFor } from "./home/bill-setup";
import { isSupportedCurrency, parsePercent } from "./money";
import { parseNotify } from "./notify-prefs";

// Group settings: ONE Save for the whole page (Basics, card fees, how you share,
// settle-up rules and my own notification choices).
//
// Order: (1) check everything, writing nothing; (2) write the parts that really
// changed, each logged on its own as before; (3) a changed currency is only
// carried out on the confirm-rate step (or straight away on an empty group).
// Currency stays for the person who looks after the group; notification choices
// are always the saver's own.

export type SettingsForm = {
  name?: string;
  markup?: string; // "0" | "200" | "300" | "400" | "custom"
  customMarkup?: string;
  secondaryCurrency?: string;
  currency?: string;
  tripDates?: { start: string; end: string }; // only sent for trips
  tripPlace?: { place: string; country: string };
  cover?: string;
  sharing?: { type: string; weights: Record<string, string> }; // only when the section was on the page
  settle?: { reminders: boolean; settleDay: number; settleMin: string }; // homes and couples only
  notify?: { all: boolean; expenses: boolean; edits: boolean; payments: boolean; people: boolean };
};

export type SettingsResult =
  | { ok: true; eventId?: string; convertTo?: string } // convertTo: go to the confirm-rate step
  | { ok: false; error: string; code?: "markup" | "name" | "admin" | "currency" };

export function markupFromForm(choice: string, custom: string): number | null {
  if (choice === "custom") {
    const bp = parsePercent(custom);
    return bp === null || bp > 2000 ? null : bp;
  }
  return ["0", "200", "300", "400"].includes(choice) ? Number(choice) : null;
}

export async function saveAllSettings(groupId: string, actorId: string, f: SettingsForm, today: string): Promise<SettingsResult> {
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { members: { select: { id: true } }, _count: { select: { expenses: true, payments: true } } },
  });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can change it." };
  if (await hasLeft(groupId, actorId)) return { ok: false, error: LEFT_ERROR };

  // ---- 1. Check everything first. Nothing is written until all of it is fine. ----
  const markupBp = f.markup === undefined ? undefined : markupFromForm(f.markup, f.customMarkup ?? "");
  if (markupBp === null) return { ok: false, error: "Enter a markup between 0% and 20%, like 3.5.", code: "markup" };

  const wantedCurrency = f.currency ?? group.currency;
  const currencyChanged = wantedCurrency !== group.currency;
  if (currencyChanged) {
    if (!(await isGroupAdmin(groupId, actorId))) return { ok: false, error: "Only the person who started the group can do that.", code: "admin" };
    if (!isSupportedCurrency(wantedCurrency)) return { ok: false, error: "Pick a currency from the list.", code: "currency" };
  }

  const basics = { name: f.name ?? group.name, markupBp, secondaryCurrency: f.secondaryCurrency ?? group.secondaryCurrency };
  const b = await updateGroupBasics(groupId, actorId, basics, { dryRun: true });
  if (!b.ok) return { ok: false, error: b.error, code: "name" };
  if (group.type === "trip" && f.tripDates) {
    const t = await setTripDates(groupId, actorId, f.tripDates.start, f.tripDates.end, today, { dryRun: true });
    if (!t.ok) return t;
  }
  if (f.sharing) {
    const s = await updateSharing(groupId, actorId, f.sharing, { dryRun: true });
    if (!s.ok) return s;
  }
  const settleApplies = !!f.settle && (group.type === "home" || group.type === "couple");
  if (settleApplies) {
    const r = await saveSettleRulesFor(groupId, actorId, f.settle!, { dryRun: true });
    if (!r.ok) return r;
  }

  // ---- 2. Write what changed. ----
  let lastEventId: string | undefined;
  const keep = (r: { ok: true; eventId?: string }) => {
    if (r.eventId) lastEventId = r.eventId;
  };
  const w1 = await updateGroupBasics(groupId, actorId, basics);
  if (!w1.ok) return w1;
  keep(w1);
  if (group.type === "trip" && f.tripDates) {
    const w = await setTripDates(groupId, actorId, f.tripDates.start, f.tripDates.end, today);
    if (!w.ok) return w;
    keep(w);
  }
  if (group.type === "trip" && f.tripPlace) {
    const tripPlace = f.tripPlace.place.replace(/\s+/g, " ").trim().slice(0, 80);
    const tc = f.tripPlace.country.toUpperCase();
    const tripCountry = countryOf(tc) ? tc : "";
    if (tripPlace !== group.tripPlace || tripCountry !== group.tripCountry) await db.group.update({ where: { id: groupId }, data: { tripPlace, tripCountry } });
  }
  // The picture is just for looks: saved as it is, no history entry.
  if (f.cover !== undefined) {
    const cover = cleanCover(f.cover, group.type, Boolean(group.coverAt));
    if (cover !== group.cover) await db.group.update({ where: { id: groupId }, data: { cover } });
  }
  // Settle rules before sharing: the sharing step can change the group type.
  if (settleApplies) {
    const w = await saveSettleRulesFor(groupId, actorId, f.settle!);
    if (!w.ok) return w;
  }
  if (f.sharing) {
    const w = await updateSharing(groupId, actorId, f.sharing);
    if (!w.ok) return w;
    keep(w);
  }
  // Just for me; written only if it differs from what is saved.
  if (f.notify) {
    const mine = await db.member.findUnique({ where: { id: actorId }, select: { notify: true } });
    const was = parseNotify(mine?.notify);
    const next = { off: !f.notify.all, expenses: f.notify.expenses, edits: f.notify.edits, payments: f.notify.payments, people: f.notify.people };
    if (JSON.stringify(was) !== JSON.stringify(next)) await db.member.update({ where: { id: actorId }, data: { notify: JSON.stringify(next) } });
  }

  // ---- 3. Currency. ----
  if (currencyChanged) {
    // With money already in the group (bills, budgets, goals, a deposit or card games count too), confirm the rate first.
    if (group._count.expenses + group._count.payments > 0 || hasOtherMoney(await loadOtherMoney(groupId, group.settleMin))) {
      return { ok: true, eventId: lastEventId, convertTo: wantedCurrency };
    }
    const c = await changeGroupCurrency(groupId, actorId, wantedCurrency, "1");
    if (!c.ok) return c;
    keep(c);
  }
  return { ok: true, eventId: lastEventId };
}
