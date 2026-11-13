import { db } from "./db";
import { dayKey } from "./dates";
import { countryOf } from "./geo";
import { blockedEitherWay } from "./blocks";
import { loadPassport } from "./passport-db";
import { passportShared } from "./passport";
import { CATEGORIES, allows } from "./account-notify";
import { parseNotify, NOTIFY_KINDS } from "./notify-prefs";
import type { MyDataExtra } from "./csv";
import { loadMyMoments } from "./moments-db";

// What "Download my data" adds to the groups' expenses and payments: postcards, passport, collections, the moments you added and notification settings.
// Text only. Nothing from other people beyond the names that are on your own cards. The privacy page lists exactly this.
type A = { id: string; homeCountry: string; places: string; passportShare: string; passportChoiceAt: Date | null; notifyPrefs: string; collectPush: boolean; timeZone: string };

export async function loadMyDataExtra(account: A, memberships: Record<string, string>, groupNames: Record<string, string>, now: Date, tz: string): Promise<Required<MyDataExtra>> {
  // Postcards: the ones you sent, and the ones you were sent that are open (a sealed card you haven't been able to read is not in the file).
  // People who blocked you or whom you blocked are left out, the same as in your postcards list.
  const hidden = [...(await blockedEitherWay(account.id))];
  const cards = await db.postcard.findMany({
    where: { OR: [{ fromId: account.id }, { toId: account.id, fromId: { notIn: hidden }, OR: [{ opensAt: null }, { opensAt: { lte: now } }] }] },
    orderBy: { createdAt: "asc" },
    take: 1000,
    select: { fromId: true, toId: true, words: true, message: true, place: true, createdAt: true },
  });
  const people = await db.account.findMany({ where: { id: { in: [...new Set(cards.flatMap((c) => [c.fromId, c.toId]))] } }, select: { id: true, name: true } });
  const nameOf = new Map(people.map((p) => [p.id, p.name.trim()]));
  const postcards = cards.map((c) => {
    const sent = c.fromId === account.id;
    return { createdAt: c.createdAt, sent, other: nameOf.get(sent ? c.toId : c.fromId) || "A friend", words: c.words, message: c.message, place: c.place };
  });

  // Passport: your places and countries (no money, groups or people).
  const p = await loadPassport(account, "", dayKey(now, tz));
  const passport = {
    home: p.home ? countryOf(p.home)?.name ?? p.home : "",
    sharing: passportShared(account) ? "People you share a group with" : "Only you",
    countries: p.index.map((r) => ({ name: r.name, trips: r.trips, places: r.cities, byHand: r.byHand })),
  };

  // Collections you organise, and collections you are on the list of (your own line only).
  const [organised, mine] = await Promise.all([
    db.collection.findMany({ where: { accountId: account.id, deletedAt: null }, orderBy: { createdAt: "asc" }, take: 500, include: { entries: { select: { status: true } } } }),
    db.collectionEntry.findMany({
      where: { accountId: account.id, collection: { deletedAt: null, accountId: { not: account.id } } },
      orderBy: { createdAt: "asc" },
      take: 500,
      select: { status: true, amount: true, collection: { select: { title: true, currency: true, amount: true, dueDate: true, closedAt: true } } },
    }),
  ]);
  const YOURS: Record<string, string> = { due: "Not paid yet", paid: "You said you paid", confirmed: "Paid and checked" };
  const collections = [
    ...organised.map((c) => ({
      organiser: true, title: c.title, currency: c.currency, amount: c.amount, dueDate: c.dueDate, status: c.closedAt ? "Closed" : "Open",
      people: c.entries.length, paid: c.entries.filter((e) => e.status !== "due").length, checked: c.entries.filter((e) => e.status === "confirmed").length, yours: "",
    })),
    ...mine.map((e) => ({
      organiser: false, title: e.collection.title, currency: e.collection.currency, amount: e.collection.amount, dueDate: e.collection.dueDate,
      status: e.collection.closedAt ? "Closed" : "Open", people: 0, paid: 0, checked: 0, yours: YOURS[e.status] ?? e.status,
    })),
  ];

  // Notification settings: your account's choices, then your phone notifications in each group.
  const settings: { setting: string; where: string; status: string }[] = [
    { setting: "Collection notifications", where: "Phone", status: account.collectPush ? "On" : "Off" },
  ];
  for (const cat of CATEGORIES) {
    for (const it of cat.push) settings.push({ setting: it.label, where: "Phone", status: allows(account.notifyPrefs, "push", it.id) ? "On" : "Off" });
    for (const it of cat.email) settings.push({ setting: it.label, where: "Email", status: allows(account.notifyPrefs, "email", it.id) ? "On" : "Off" });
  }
  const ids = Object.values(memberships);
  const rows = ids.length ? await db.member.findMany({ where: { id: { in: ids } }, select: { id: true, groupId: true, notify: true } }) : [];
  for (const m of rows.sort((a, b) => (groupNames[a.groupId] ?? "").localeCompare(groupNames[b.groupId] ?? ""))) {
    const n = parseNotify(m.notify);
    const off = NOTIFY_KINDS.filter((k) => !n[k.id]).map((k) => k.label.toLowerCase());
    settings.push({ setting: `Phone notifications in ${groupNames[m.groupId] ?? "a group"}`, where: "Phone", status: n.off ? "Off" : off.length ? `On, except ${off.join(", ")}` : "On" });
  }
  // Moments you added: your own words only, with a link to where you can open each in the app (photos are not in the file, like postcards).
  const moments = (await loadMyMoments(account.id)).map((m) => ({ createdAt: m.createdAt, group: m.group, caption: m.caption, day: m.day, link: `/groups/${m.groupId}/moments/${m.id}` }));
  return { postcards, passport, collections, settings, moments };
}
