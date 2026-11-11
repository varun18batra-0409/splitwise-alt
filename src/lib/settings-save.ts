import { db } from "./db";
import { cleanCover, coverOf } from "./covers";
import { countryOf } from "./geo";
import { pickAdmin } from "./group-admin";
import { changeGroupCurrency, hasOtherMoney, loadOtherMoney, updateGroupBasics } from "./group-changes";
import { sharingInputs } from "./group-types";
import { setTripDates, updateSharing } from "./group-setup";
import { saveSettleRulesFor } from "./home/bill-setup";
import type { Db } from "./events";
import { LEFT_ERROR } from "./active";
import { isSupportedCurrency, parsePercent, toInputAmount } from "./money";
import { parseNotify } from "./notify-prefs";

// Group settings: ONE Save for the whole page (Basics, card fees, how you share,
// settle-up rules and my own notification choices).
//
// All or nothing: every part is checked and written inside ONE database transaction, so if any
// part is refused nothing at all is saved. A changed currency is carried out afterwards, on the
// confirm-rate step (or straight away on an empty group), because converting needs its own rate.
//
// Never undo other people's changes: the page carries the values it was drawn with (`was`).
//  - a part I didn't touch (submitted = drawn) is left exactly as it is now, even if someone
//    else changed it meanwhile;
//  - a part I changed, which someone else also changed meanwhile, refuses the whole Save;
//  - a part only I changed is written.
// Without `was` (older callers) every part sent is written if it differs from what is saved.

export type SettingsWas = {
  name?: string;
  markup?: string; // basis points as text, "300"
  secondaryCurrency?: string;
  currency?: string;
  tripStart?: string;
  tripEnd?: string;
  tripPlace?: string;
  tripCountry?: string;
  cover?: string;
  type?: string;
  weights?: Record<string, string>; // as shown in the boxes (shares, or a couple's percents)
  reminders?: boolean;
  settleDay?: number;
  settleMin?: string;
  notify?: string; // JSON of my notification choices
};

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
  was?: SettingsWas; // what the page showed when it was drawn
};

export type SettingsResult =
  | { ok: true; eventId?: string; convertTo?: string } // convertTo: go to the confirm-rate step
  | { ok: false; error: string; code?: "markup" | "name" | "admin" | "currency" | "conflict" };

export function markupFromForm(choice: string, custom: string): number | null {
  if (choice === "custom") {
    const bp = parsePercent(custom);
    return bp === null || bp > 2000 ? null : bp;
  }
  return ["0", "200", "300", "400"].includes(choice) ? Number(choice) : null;
}

type GroupLike = {
  id: string;
  name: string;
  type: string;
  currency: string;
  cardMarkupBp: number;
  secondaryCurrency: string;
  tripStart: string;
  tripEnd: string;
  tripPlace: string;
  tripCountry: string;
  cover: string;
  coverAt: Date | null;
  reminders: boolean;
  settleDay: number;
  settleMin: number;
};
type MemberLike = { id: string; leftAt: Date | null; splitWeight: number };

// What the Settings page shows right now (also what it carries as `was`).
export function settingsSnapshot(g: GroupLike, members: MemberLike[], notifyJson?: string | null): SettingsWas {
  const active = members.filter((m) => !m.leftAt);
  const shown = sharingInputs(g.type, active.map((m) => m.splitWeight));
  return {
    name: g.name,
    markup: String(g.cardMarkupBp),
    secondaryCurrency: g.secondaryCurrency,
    currency: g.currency,
    tripStart: g.tripStart,
    tripEnd: g.tripEnd,
    tripPlace: g.tripPlace,
    tripCountry: g.tripCountry,
    cover: coverOf(g),
    type: g.type,
    weights: Object.fromEntries(active.map((m, i) => [m.id, shown[i]])),
    reminders: g.type === "home" ? g.reminders : false,
    settleDay: g.settleDay,
    settleMin: g.settleMin ? toInputAmount(g.settleMin, g.currency) : "",
    notify: JSON.stringify(parseNotify(notifyJson)),
  };
}

// Reads the hidden `was` field; anything odd means "no information" (the older, plain behaviour).
export function parseWas(raw: string): SettingsWas | undefined {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as SettingsWas) : undefined;
  } catch {
    return undefined;
  }
}

type Verdict = "skip" | "write" | "conflict";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// wasValue undefined = no information: write what was sent.
function verdict(wasValue: unknown, submitted: unknown, current: unknown): Verdict {
  if (wasValue === undefined) return "write";
  if (same(submitted, wasValue)) return "skip";
  return same(current, wasValue) ? "write" : "conflict";
}

// Stops the transaction (so everything rolls back) with the answer to give.
class Stop extends Error {
  constructor(public result: SettingsResult) {
    super("settings save stopped");
  }
}
const stop = (error: string, code?: Extract<SettingsResult, { ok: false }>["code"]): never => {
  throw new Stop({ ok: false, error, ...(code ? { code } : {}) });
};

const THINGS = {
  name: { words: "the group name", kinds: ["group_renamed"] },
  markup: { words: "the card fee", kinds: ["markup_changed"] },
  secondary: { words: "the second currency", kinds: ["display_currency_changed"] },
  currency: { words: "the group currency", kinds: ["currency_changed"] },
  dates: { words: "the trip dates", kinds: ["trip_dates_set"] },
  place: { words: "where the trip went", kinds: [] as string[] },
  cover: { words: "the picture", kinds: [] as string[] },
  sharing: { words: "how costs are shared", kinds: ["split_changed"] },
  settle: { words: "the settle-up rules", kinds: ["bill_changed"] },
};

async function conflict(tx: Db, groupId: string, actorId: string, thing: keyof typeof THINGS): Promise<never> {
  const t = THINGS[thing];
  let who = "Someone";
  if (t.kinds.length) {
    const e = await tx.groupEvent.findFirst({ where: { groupId, kind: { in: t.kinds }, NOT: { actorId } }, orderBy: { createdAt: "desc" }, select: { actorId: true } });
    const m = e ? await tx.member.findUnique({ where: { id: e.actorId }, select: { name: true } }) : null;
    if (m?.name) who = m.name;
  }
  return stop(`${who} changed ${t.words} while you were editing. Check and save again.`, "conflict");
}

export async function saveAllSettings(groupId: string, actorId: string, f: SettingsForm, today: string): Promise<SettingsResult> {
  let committed: { eventId?: string; wantedCurrency: string; currencyWrite: boolean };
  try {
    committed = await db.$transaction((tx) => saveInside(tx, groupId, actorId, f, today), { timeout: 20000, maxWait: 10000 });
  } catch (e) {
    if (e instanceof Stop) return e.result;
    throw e;
  }
  let lastEventId = committed.eventId;

  // ---- Currency: after the rest is safely saved. ----
  if (committed.currencyWrite) {
    // Read again now: the minimum just saved above counts as money held in the group.
    const fresh = await db.group.findUnique({ where: { id: groupId }, select: { currency: true, settleMin: true, _count: { select: { expenses: true, payments: true } } } });
    if (fresh && fresh.currency !== committed.wantedCurrency) {
      // With money already in the group (bills, budgets, goals, a deposit or card games count too), confirm the rate first.
      if (fresh._count.expenses + fresh._count.payments > 0 || hasOtherMoney(await loadOtherMoney(groupId, fresh.settleMin))) {
        return { ok: true, eventId: lastEventId, convertTo: committed.wantedCurrency };
      }
      const c = await changeGroupCurrency(groupId, actorId, committed.wantedCurrency, "1");
      if (!c.ok) return c;
      if (c.eventId) lastEventId = c.eventId;
    }
  }
  return { ok: true, eventId: lastEventId };
}

async function saveInside(tx: Db, groupId: string, actorId: string, f: SettingsForm, today: string) {
  const group = await tx.group.findUnique({ where: { id: groupId }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!group || group.deletedAt) return stop("This group no longer exists.");
  const me = group.members.find((m) => m.id === actorId);
  if (!me) return stop("Only people in this group can change it.");
  if (me.leftAt) return stop(LEFT_ERROR);

  const was = f.was;
  const current = settingsSnapshot(group, group.members);
  let lastEventId: string | undefined;
  const keep = (r: { ok: boolean; eventId?: string }) => {
    if (r.eventId) lastEventId = r.eventId;
  };

  // ---- Which parts did I change, and did anyone else change them too? ----
  const markupBp = f.markup === undefined ? undefined : markupFromForm(f.markup, f.customMarkup ?? "");
  if (markupBp === null) return stop("Enter a markup between 0% and 20%, like 3.5.", "markup");

  const vName = f.name === undefined ? "skip" : verdict(was?.name, f.name, current.name);
  const vMarkup = markupBp === undefined ? "skip" : verdict(was?.markup, String(markupBp), current.markup);
  const vSecond = f.secondaryCurrency === undefined ? "skip" : verdict(was?.secondaryCurrency, f.secondaryCurrency, current.secondaryCurrency);
  const vCurrency = f.currency === undefined ? "skip" : verdict(was?.currency, f.currency, current.currency);
  const vDates = !f.tripDates || group.type !== "trip" ? "skip" : verdict(was && was.tripStart !== undefined ? [was.tripStart, was.tripEnd] : undefined, [f.tripDates.start, f.tripDates.end], [current.tripStart, current.tripEnd]);
  const vPlace = !f.tripPlace || group.type !== "trip" ? "skip" : verdict(was && was.tripPlace !== undefined ? [was.tripPlace, was.tripCountry] : undefined, [f.tripPlace.place, f.tripPlace.country], [current.tripPlace, current.tripCountry]);
  const vCover = f.cover === undefined ? "skip" : verdict(was?.cover, f.cover, current.cover);

  // Sharing: the type and the boxes are one part. Only people the page showed are compared.
  let vSharing: Verdict = "skip";
  if (f.sharing) {
    if (was?.weights === undefined) vSharing = "write";
    else {
      const ids = Object.keys(was.weights);
      const mineSame = f.sharing.type === was.type && ids.every((id) => f.sharing!.weights[id] === undefined || f.sharing!.weights[id] === was.weights![id]);
      const nowSame = group.type === was.type && ids.every((id) => current.weights![id] === undefined || current.weights![id] === was.weights![id]);
      vSharing = mineSame ? "skip" : nowSame ? "write" : "conflict";
    }
  }
  const settleApplies = !!f.settle && (group.type === "home" || group.type === "couple");
  const vSettle = !settleApplies
    ? "skip"
    : verdict(
        was && was.settleDay !== undefined ? [was.reminders, was.settleDay, was.settleMin] : undefined,
        [group.type === "home" ? f.settle!.reminders : false, f.settle!.settleDay, f.settle!.settleMin.trim()],
        [current.reminders, current.settleDay, current.settleMin],
      );

  if (vName === "conflict") await conflict(tx, groupId, actorId, "name");
  if (vMarkup === "conflict") await conflict(tx, groupId, actorId, "markup");
  if (vSecond === "conflict") await conflict(tx, groupId, actorId, "secondary");
  if (vCurrency === "conflict") await conflict(tx, groupId, actorId, "currency");
  if (vDates === "conflict") await conflict(tx, groupId, actorId, "dates");
  if (vPlace === "conflict") await conflict(tx, groupId, actorId, "place");
  if (vCover === "conflict") await conflict(tx, groupId, actorId, "cover");
  if (vSharing === "conflict") await conflict(tx, groupId, actorId, "sharing");
  if (vSettle === "conflict") await conflict(tx, groupId, actorId, "settle");

  // ---- Currency: for the person who looks after the group. ----
  const wantedCurrency = f.currency ?? group.currency;
  const currencyWrite = vCurrency === "write" && wantedCurrency !== group.currency;
  if (currencyWrite) {
    if (pickAdmin(group.members)?.id !== actorId) return stop("Only the person who started the group can do that.", "admin");
    if (!isSupportedCurrency(wantedCurrency)) return stop("Pick a currency from the list.", "currency");
  }

  // ---- Write what I changed; each part says its own problem if it is refused. ----
  if (vName === "write" || vMarkup === "write" || vSecond === "write") {
    if (vName === "write" && !f.name!.trim().replace(/\s+/g, " ")) return stop("Give the group a name.", "name");
    const sec = f.secondaryCurrency;
    if (vSecond === "write" && sec !== "" && sec !== "none" && !isSupportedCurrency(sec!)) return stop("Pick a currency from the list.", "currency");
    const b = await updateGroupBasics(
      groupId,
      actorId,
      { name: vName === "write" ? f.name : undefined, markupBp: vMarkup === "write" ? (markupBp as number) : undefined, secondaryCurrency: vSecond === "write" ? sec : undefined },
      { tx },
    );
    if (!b.ok) return stop(b.error);
    keep(b);
  }
  if (vDates === "write") {
    const w = await setTripDates(groupId, actorId, f.tripDates!.start, f.tripDates!.end, today, { tx });
    if (!w.ok) return stop(w.error);
    keep(w);
  }
  if (vPlace === "write") {
    const tripPlace = f.tripPlace!.place.replace(/\s+/g, " ").trim().slice(0, 80);
    const tc = f.tripPlace!.country.toUpperCase();
    const tripCountry = countryOf(tc) ? tc : "";
    if (tripPlace !== group.tripPlace || tripCountry !== group.tripCountry) await tx.group.update({ where: { id: groupId }, data: { tripPlace, tripCountry } });
  }
  // The picture is just for looks: saved as it is, no history entry.
  if (vCover === "write") {
    const cover = cleanCover(f.cover!, group.type, Boolean(group.coverAt));
    if (cover !== group.cover) await tx.group.update({ where: { id: groupId }, data: { cover } });
  }
  // Settle rules before sharing: the sharing step can change the group type.
  if (vSettle === "write") {
    const w = await saveSettleRulesFor(groupId, actorId, f.settle!, { tx });
    if (!w.ok) return stop(w.error);
  }
  if (vSharing === "write") {
    const w = await updateSharing(groupId, actorId, f.sharing!, { tx });
    if (!w.ok) return stop(w.error);
    keep(w);
  }
  // Just for me; written only if I changed it and it differs from what is saved.
  if (f.notify) {
    const next = { off: !f.notify.all, expenses: f.notify.expenses, edits: f.notify.edits, payments: f.notify.payments, people: f.notify.people };
    const untouched = was?.notify !== undefined && was.notify === JSON.stringify(next);
    if (!untouched) {
      const mine = await tx.member.findUnique({ where: { id: actorId }, select: { notify: true } });
      if (JSON.stringify(parseNotify(mine?.notify)) !== JSON.stringify(next)) await tx.member.update({ where: { id: actorId }, data: { notify: JSON.stringify(next) } });
    }
  }
  return { eventId: lastEventId, wantedCurrency, currencyWrite };
}
