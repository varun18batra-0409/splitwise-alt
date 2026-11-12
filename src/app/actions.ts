"use server";

import { SITE_URL } from "@/lib/site";
import { RedirectType } from "next/navigation";

import { cleanCover } from "@/lib/covers";
import { redirect } from "@/lib/fresh-redirect";
import { db } from "@/lib/db";
import { forgetThisPhone, getAccount, getMemberships, getMyMemberId, keepGroupsDropAccount, setMyMemberId, signInAs, signOutOtherPhones } from "@/lib/identity";
import { deleteAccount, requestLoginCode, verifyLoginCode } from "@/lib/auth";
import { allow, clientIp } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { cleanNames, sameName } from "@/lib/names";
import { amountError, isSupportedCurrency, overpayHref, parseAmount, parsePercent } from "@/lib/money";
import { getRate, type RateAnswer } from "@/lib/rate-cache";
import { cleanRateText } from "@/lib/conversion";
import { deletePayment, saveExpense, setExpenseDeleted, setPaymentDeleted, type SaveExpenseInput } from "@/lib/save-expense";
import { removeMembers, undoEvent } from "@/lib/undo";
import { isMemberUsed, renameMember, setMemberLeft } from "@/lib/people";
import { settleAllAndClose } from "@/lib/settle-all";
import { vapidKeys } from "@/lib/push";
import { changeGroupCurrency, hasOtherMoney, loadOtherMoney, updateGroupBasics } from "@/lib/group-changes";
import { logEvent } from "@/lib/events";
import { countryOf } from "@/lib/geo";
import { needsOkFor } from "@/lib/payment-ok";
import { createPayment } from "@/lib/payments";
import { claimKey, cleanKey, fingerprintOf, isDuplicateKey, keyState, previousResult, STALE_KEY_ERROR } from "@/lib/once";
import { safePath } from "@/lib/paths";
import { addRegistered, copyPushTo, inviteByEmail } from "@/lib/invites";
import { savePushFor, validSub } from "@/lib/push-subs";
import { formatMoney } from "@/lib/money";
import { createGroupFor, setTripDates, updateSharing } from "@/lib/group-setup";
import { addWaitingBill } from "@/lib/home/bills-db";
import { checkBudgets } from "@/lib/home/budgets-db";
import { after } from "next/server";
import { getTimeZone } from "@/lib/tz";
import { dayKey } from "@/lib/dates";
import { importSplitwise } from "@/lib/splitwise-import";
import { canRestoreGroup, isGroupAdmin } from "@/lib/group-admin";
import { hasLeft, LEFT_ERROR } from "@/lib/active";
import { parseWas, saveAllSettings } from "@/lib/settings-save";
import { joinExisting, joinNew, newInviteLink, type JoinFail } from "@/lib/join";
import { acceptInvitation, declineInvitation } from "@/lib/invitations";


export async function createGroup(formData: FormData) {
  // Everyone in Loopin has a verified email, so making a group needs an account.
  const account = await getAccount();
  if (!account) redirect(`/signin?${new URLSearchParams({ mode: "signup", back: "/groups/new" })}`);
  // 20 new groups an hour per person; a looser cap per network, since many phones share
  // one address (mobile networks, office and college wifi).
  if (!(await allow(`create-group:${account.id}`, 20, 3600)) || !(await allow(`create-group-ip:${(await originAndIp()).ip}`, 200, 3600))) redirect("/groups/new?error=busy");
  const groupName = String(formData.get("groupName") ?? "").trim().slice(0, 60);
  const yourName = cleanNames([String(formData.get("yourName") ?? account.name ?? "")])[0];
  if (!groupName || !yourName) redirect("/groups/new?error=missing");
  if (!account.name) await db.account.update({ where: { id: account.id }, data: { name: yourName } });
  // The same form sent twice (double tap, slow network) makes one group.
  const rid = cleanKey(formData.get("rid"));
  if (rid) {
    const prev = await previousResult(rid);
    if (prev !== null) redirect(prev ? `/groups/${prev}` : "/");
    const claimed = await db.requestKey.create({ data: { key: rid, result: "" } }).then(() => true, (e) => (isDuplicateKey(e) ? false : Promise.reject(e)));
    if (!claimed) redirect("/");
  }

  // If making the group fails, free the key so trying again works (not a silent trip Home).
  const group = await createGroupFor(account, {
    type: String(formData.get("type") ?? "other"),
    name: groupName,
    yourName,
    currency: String(formData.get("currency") ?? "INR"),
    ratio: Number(formData.get("ratio") ?? 50),
    cover: String(formData.get("cover") ?? ""),
    tripStart: String(formData.get("tripStart") ?? ""),
    tripEnd: String(formData.get("tripEnd") ?? ""),
    tripPlace: String(formData.get("tripPlace") ?? ""),
    tripCountry: String(formData.get("tripCountry") ?? ""),
    photo: photoFrom(formData.get("photo")),
  }).catch(async (err) => {
    if (rid) await db.requestKey.deleteMany({ where: { key: rid, result: "" } }).catch(() => undefined);
    throw err;
  });
  if (rid) await db.requestKey.update({ where: { key: rid }, data: { result: group.id } }).catch(() => undefined);
  const me = group.members[0];
  await setMyMemberId(group.id, me.id);
  await copyPushTo(account.id, me.id);
  // A Pot (card night) goes straight to its first game, where players can be added by name.
  redirect(group.type === "pot" ? `/groups/${group.id}/pot/new?first=1` : `/groups/${group.id}/invite?new=1`);
}

// The photo picked on "New group", made small on the phone and sent as text.
function photoFrom(v: FormDataEntryValue | null): Uint8Array<ArrayBuffer> | undefined {
  if (typeof v !== "string" || !v || v.length > 1_000_000 || !/^[A-Za-z0-9+/=]+$/.test(v)) return undefined;
  return new Uint8Array(Buffer.from(v, "base64"));
}

// "Bring a group over from Splitwise": a new group from Splitwise's exported spreadsheet.
export async function importFromSplitwise(formData: FormData) {
  const account = await getAccount();
  if (!account) redirect(`/signin?${new URLSearchParams({ back: "/import" })}`);
  if (!(await allow(`import:${(await originAndIp()).ip}`, 10, 3600))) redirect(`/import?error=${encodeURIComponent("Lots of imports from here in the last hour. Wait a bit and try again.")}`);
  const r = await importSplitwise(account, {
    text: String(formData.get("csv") ?? ""),
    groupName: String(formData.get("groupName") ?? ""),
    type: String(formData.get("type") ?? "other"),
    me: Number(formData.get("me") ?? -1),
    map: readColumnMap(String(formData.get("map") ?? "")),
    currency: String(formData.get("currency") ?? "") || undefined,
  });
  if (!r.ok) redirect(`/import?error=${encodeURIComponent(r.error)}`);
  await setMyMemberId(r.groupId, r.meMemberId);
  await copyPushTo(account.id, r.meMemberId);
  redirect(`/groups/${r.groupId}?${new URLSearchParams({ imported: `${r.expenses}.${r.payments}.${r.matches === false ? "off" : r.matches ? "ok" : "na"}` })}`);
}

// The column choices sent from the import screen (other apps' files), checked.
function readColumnMap(json: string): import("@/lib/import-formats").ColumnMap | undefined {
  if (!json) return undefined;
  try {
    const m = JSON.parse(json);
    const col = (x: unknown) => (Number.isInteger(x) && (x as number) >= -1 && (x as number) < 200 ? (x as number) : undefined);
    const split = ["everyone", "column", "shares"].includes(m?.split) ? m.split : "everyone";
    const description = col(m?.description), amount = col(m?.amount), paidBy = col(m?.paidBy);
    if (description === undefined || amount === undefined || paidBy === undefined) return undefined;
    return {
      date: col(m?.date) ?? -1,
      description,
      amount,
      paidBy,
      split,
      forCol: col(m?.forCol),
      shareCols: Array.isArray(m?.shareCols) ? (m.shareCols as unknown[]).map(col).filter((x): x is number => x !== undefined && x >= 0).slice(0, 50) : undefined,
      type: col(m?.type),
    };
  } catch {
    return undefined;
  }
}

// ---------- Adding people (never by just typing a name) ----------

async function memberContext(groupId: string) {
  const group = await db.group.findUnique({ where: { id: groupId }, select: { id: true, inviteCode: true, deletedAt: true } });
  if (!group || group.deletedAt) redirect("/");
  const myId = await getMyMemberId(group.id);
  const me = myId ? await db.member.findFirst({ where: { id: myId, groupId: group.id } }) : null;
  if (!me) redirect("/private");
  // Adding and inviting people is for people still in the group.
  if (me.leftAt) redirect(`/groups/${group.id}/people?error=${encodeURIComponent("You left this group. Rejoin it to add or invite people.")}`);
  return { group, me };
}

// Live suggestions while typing in "Add people".
// Add someone who's already on Loopin (in the group at once as a name, and invited).
export async function addPerson(formData: FormData) {
  const { group, me } = await memberContext(String(formData.get("groupId") ?? ""));
  const { origin, ip } = await originAndIp();
  if (!(await allow(`add-person:${ip}`, 60, 3600))) redirect(`/groups/${group.id}/invite?error=${encodeURIComponent("Too many adds from here. Wait a bit.")}`);
  const r = await addRegistered(group.id, me.id, String(formData.get("accountId") ?? ""), origin, { later: (job) => after(job) });
  const q = r.ok ? new URLSearchParams({ invited: JSON.stringify([[r.name, ""]]), ...(r.eventId ? { did: r.eventId } : {}) }) : new URLSearchParams({ error: r.error });
  redirect(`/groups/${group.id}/invite?${q}`);
}

// Invite by email: they are in the group at once as a name, and invited.
export async function invitePeople(formData: FormData) {
  const { group, me } = await memberContext(String(formData.get("groupId") ?? ""));
  const { origin, ip } = await originAndIp();
  if (!(await allow(`invite:${ip}`, 40, 3600))) redirect(`/groups/${group.id}/invite?error=${encodeURIComponent("Too many invites from here. Wait a bit.")}`);
  const r = await inviteByEmail(group.id, me.id, String(formData.get("emails") ?? ""), origin, { later: (job) => after(job) });
  const q = new URLSearchParams();
  if (r.people.length) q.set("invited", JSON.stringify(r.people.map((p) => [p.name, p.email])));
  if (r.bad.length) q.set("error", `Couldn’t invite: ${r.bad.join(", ")}`);
  redirect(`/groups/${group.id}/invite?${q}`);
}

// Joining from an invitation (link, QR, contact message or email). Needs a
// verified email: the join page asks people to sign up first. The rules live in lib/join.ts.
async function joinContext(code: string) {
  const account = await getAccount();
  if (!account) redirect(`/join/${code}`);
  return { account };
}

async function finishJoin(groupId: string, memberId: string, accountId: string, email: string) {
  await db.invite.updateMany({ where: { groupId, email, acceptedAt: null }, data: { acceptedAt: new Date() } });
  await setMyMemberId(groupId, memberId);
  await copyPushTo(accountId, memberId);
  redirect(`/groups/${groupId}`);
}

// Where a refused join goes: the join page says it calmly.
function joinRefused(code: string, r: JoinFail): never {
  redirect(`/join/${code}${r.reason === "removed" ? "?error=removed" : r.reason === "claimed" ? "?error=claimed" : r.reason === "name" ? "?error=name" : ""}`);
}

// "That's me": claim a name someone added before invitations existed.
export async function joinAsExisting(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  const { account } = await joinContext(code);
  const r = await joinExisting(code, account, String(formData.get("memberId") ?? ""));
  if (!r.ok) joinRefused(code, r);
  const group = await db.group.findUnique({ where: { inviteCode: code }, select: { id: true } });
  if (!group) redirect(`/join/${code}`);
  await finishJoin(group.id, r.memberId, account.id, account.email);
}

// Join as yourself (your verified account).
export async function joinAsNew(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  // Generous per network: a whole party can join on one venue's Wi-Fi.
  if (!(await allow(`join:${(await originAndIp()).ip}`, 120, 3600))) redirect(`/join/${code}?error=busy`);
  const { account } = await joinContext(code);
  const r = await joinNew(code, account, String(formData.get("name") ?? ""));
  if (!r.ok) joinRefused(code, r);
  const group = await db.group.findUnique({ where: { inviteCode: code }, select: { id: true } });
  if (!group) redirect(`/join/${code}`);
  await finishJoin(group.id, r.memberId, account.id, account.email);
}

// The Join / Not now buttons on an invitation (Home, Alerts and the group's own screen).
export async function answerInvitation(formData: FormData) {
  const account = await getAccount();
  if (!account) redirect("/signin");
  const key = String(formData.get("key") ?? "").slice(0, 200);
  const join = formData.get("answer") === "join";
  if (join) {
    const r = await acceptInvitation(account, key);
    if (!r.ok) redirect(`/?error=${encodeURIComponent(r.error)}`);
    await setMyMemberId(r.groupId, r.memberId);
    redirect(`/groups/${r.groupId}`);
  }
  await declineInvitation(account, key);
  redirect("/");
}

// Add people → "Make a new invite link": the old link (and email invites not yet accepted) stop working.
export async function makeNewInviteLink(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const myId = await getMyMemberId(groupId);
  if (!myId) redirect("/private");
  const r = await newInviteLink(groupId, myId);
  redirect(`/groups/${groupId}/invite${r.ok ? "?newlink=1" : `?error=${encodeURIComponent(r.error)}`}`);
}

// Saves a new expense — or changes an existing one — then goes back to the group page.
export async function addExpense(
  input: SaveExpenseInput & { again?: boolean; billRun?: { billId: string; period: string }; receiptId?: string; items?: { name: string; amount: number; people: string[] }[] },
): Promise<{ error: string; duplicateOf?: { id: string; description: string; amount: number; by: string; when: string } }> {
  if (!(await allow(`expense:${(await originAndIp()).ip}`, 300, 3600))) return { error: "Too many changes in a short time. Wait a few minutes." };
  // Fetch (and cache) today's rate before saving, so the save itself never waits on the internet.
  const g = await db.group.findUnique({ where: { id: input.groupId }, select: { currency: true } });
  if (g && input.currency !== g.currency && input.rateMode === "auto") await getRate(input.currency, g.currency).catch(() => null);
  const me = await getMyMemberId(input.groupId);
  const requestKey = cleanKey(input.requestKey);
  // The bill's item lines and photo are saved in the same step as the expense: all or nothing
  // (a photo that expired stops the save, and the form keeps what was typed).
  const attach = { items: input.items, receiptId: input.receiptId };
  // "Enter amount" for a waiting bill: the month is claimed as it's saved, so it's added once.
  const result =
    input.billRun && !input.expenseId
      ? await addWaitingBill(input, me, getRate, input.billRun, requestKey, attach)
      : await saveExpense(input, me, getRate, { ignoreDoubleTap: true, requestKey, checkDuplicate: true, attach });
  if (!result.ok) return { error: result.error, duplicateOf: result.duplicateOf };
  // Budgets: a nudge at 80% and when one goes over (after the reply is sent).
  after(() => checkBudgets(input.groupId).catch(() => []));
  // "Save & add another": straight back to a fresh form with the same people and split.
  if (input.again && !input.expenseId) redirect(`/groups/${input.groupId}/add?again=${result.id}`);
  redirect(`/groups/${input.groupId}?tab=activity${result.eventId ? `&did=${result.eventId}` : ""}`);
}

// Delete / restore an expense (any active member can, not only whoever added it). History keeps it.
export async function deleteExpense(formData: FormData) {
  await toggleExpense(formData, true);
}
export async function restoreExpense(formData: FormData) {
  await toggleExpense(formData, false);
}
async function toggleExpense(formData: FormData, deleted: boolean) {
  const groupId = String(formData.get("groupId") ?? "");
  const expenseId = String(formData.get("expenseId") ?? "");
  const r = await setExpenseDeleted(expenseId, await getMyMemberId(groupId), deleted);
  const q = r.ok ? (r.eventId ? `did=${r.eventId}` : "") : `error=${encodeURIComponent(r.error)}`;
  redirect(`/groups/${groupId}?tab=activity&${q}`);
}

// Delete a settle-up payment (any active member can, not only whoever recorded it). History keeps it.
export async function removePayment(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");
  const r = await deletePayment(paymentId, await getMyMemberId(groupId));
  redirect(`/groups/${groupId}?tab=activity&${r.ok ? (r.eventId ? `did=${r.eventId}` : "") : `error=${encodeURIComponent(r.error)}`}`);
}

// Bring back a deleted settle-up payment.
export async function restorePayment(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");
  const r = await setPaymentDeleted(paymentId, await getMyMemberId(groupId), false);
  redirect(`/groups/${groupId}?tab=activity&${r.ok ? (r.eventId ? `did=${r.eventId}` : "") : `error=${encodeURIComponent(r.error)}`}`);
}

// Undo (or redo) any change in a group. `back` says which page to return to.
export async function undoChange(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  const back = String(formData.get("back") ?? "group");
  const r = await undoEvent(eventId, await getMyMemberId(groupId), await getTimeZone());
  const q = r.ok ? `undone=1${r.eventId ? `&did=${r.eventId}` : ""}` : `error=${encodeURIComponent(r.error)}`;
  if (back === "home") redirect(`/?${q}&g=${groupId}`);
  if (back === "people") redirect(`/groups/${groupId}/people?${q}`);
  if (back === "settle") redirect(`/groups/${groupId}/settle?${q}`);
  if (/^pot:[A-Za-z0-9_-]{6,40}$/.test(back)) redirect(`/groups/${groupId}/pot/${back.slice(4)}?${q}`);
  redirect(`/groups/${groupId}?tab=${back === "balances" ? "balances" : "activity"}&${q}`);
}

// Looks up today's exchange rate when a currency is picked (not on every keystroke).
export async function lookupRate(from: string, to: string): Promise<RateAnswer> {
  // A person picking currencies makes a handful of lookups; this only stops a script from using our rate service up.
  if (!(await allow(`rate-ip:${(await originAndIp()).ip}`, 120, 3600))) {
    return { ok: false, reason: "unavailable", message: "Lots of rate lookups from here in the last hour. Enter the rate yourself, or try again later." };
  }
  if (!isSupportedCurrency(from) || !isSupportedCurrency(to)) {
    return { ok: false, reason: "unsupported", message: "That currency isn't supported. Enter the rate yourself." };
  }
  return getRate(from, to);
}

// Group settings: name, currency and foreign card markup. Every change is logged for everyone.
// Settings → "Phone notifications for this group" (just for me).
export async function saveNotifyPrefs(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const myId = await getMyMemberId(groupId);
  const me = myId ? await db.member.findFirst({ where: { id: myId, groupId } }) : null;
  if (!me) redirect("/private");
  const on = (k: string) => formData.get(k) === "on";
  const prefs = { off: !on("all"), expenses: on("expenses"), edits: on("edits"), payments: on("payments"), people: on("people") };
  await db.member.update({ where: { id: me.id }, data: { notify: JSON.stringify(prefs) } });
  redirect(`/groups/${groupId}/settings?saved=notify#notify`);
}

// Settings → "How you share costs".
export async function updateSharingSettings(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const myId = await getMyMemberId(groupId);
  if (!myId) redirect("/private");
  const weights: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("w_")) weights[k.slice(2)] = String(v);
  const r = await updateSharing(groupId, myId, { type: String(formData.get("type") ?? ""), weights });
  if (!r.ok) redirect(`/groups/${groupId}/settings?error=${encodeURIComponent(r.error)}#sharing`);
  redirect(`/groups/${groupId}?saved=settings${r.eventId ? `&did=${r.eventId}` : ""}`);
}

export async function updateGroupSettings(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { members: { select: { id: true, leftAt: true } }, _count: { select: { expenses: true, payments: true } } },
  });
  if (!group) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  if (group.members.find((m) => m.id === myId)?.leftAt) redirect(`/groups/${group.id}/people`); // left: read-only

  const back = `/groups/${group.id}/settings`;

  // Markup: "0" | "200" | "300" | "400" | "custom" (+ customMarkup like "3.5")
  const choice = String(formData.get("markup") ?? "0");
  let markupBp: number | null;
  if (choice === "custom") {
    markupBp = parsePercent(String(formData.get("customMarkup") ?? ""));
  } else {
    markupBp = ["0", "200", "300", "400"].includes(choice) ? Number(choice) : null;
  }
  if (markupBp === null || markupBp > 2000) redirect(`${back}?error=markup`);

  const name = String(formData.get("name") ?? group.name);
  const secondaryCurrency = String(formData.get("secondaryCurrency") ?? group.secondaryCurrency);
  const basics = await updateGroupBasics(group.id, myId, { name, markupBp, secondaryCurrency });
  if (!basics.ok) redirect(`${back}?error=name`);
  // Trip dates (trip groups only): the countdown on Home and the group.
  if (group.type === "trip" && formData.has("tripStart")) {
    const trip = await setTripDates(group.id, myId, String(formData.get("tripStart") ?? ""), String(formData.get("tripEnd") ?? ""), dayKey(new Date(), await getTimeZone()));
    if (!trip.ok) redirect(`${back}?${new URLSearchParams({ error: trip.error })}`);
  }
  // Where the trip went (for the trip passport): as typed, and a country from the list.
  if (group.type === "trip" && formData.has("tripPlace")) {
    const tripPlace = String(formData.get("tripPlace") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    const tc = String(formData.get("tripCountry") ?? "").toUpperCase();
    const tripCountry = countryOf(tc) ? tc : "";
    if (tripPlace !== group.tripPlace || tripCountry !== group.tripCountry) await db.group.update({ where: { id: group.id }, data: { tripPlace, tripCountry } });
  }
  // The picture is just for looks: saved as it is, no history entry.
  if (formData.has("cover")) {
    const cover = cleanCover(String(formData.get("cover")), group.type, Boolean(group.coverAt));
    if (cover !== group.cover) await db.group.update({ where: { id: group.id }, data: { cover } });
  }
  const did = basics.eventId ? `&did=${basics.eventId}` : "";

  const currency = String(formData.get("currency") ?? group.currency);
  if (currency !== group.currency) {
    if (!(await isGroupAdmin(group.id, myId))) redirect(`${back}?error=admin`);
    if (!isSupportedCurrency(currency)) redirect(`${back}?error=currency`);
    // With money already in the group, confirm the conversion rate first.
    // (Bills, budgets, goals, a deposit or card games count as money too.)
    if (group._count.expenses + group._count.payments > 0 || hasOtherMoney(await loadOtherMoney(group.id, group.settleMin))) redirect(`${back}?convert=${currency}`);
    const c = await changeGroupCurrency(group.id, myId, currency, "1", { expectEmpty: true });
    if (!c.ok && c.needsRate) redirect(`${back}?convert=${currency}`);
    if (c.ok && c.eventId) redirect(`/groups/${group.id}?saved=settings&did=${c.eventId}`);
  }
  redirect(`/groups/${group.id}?saved=settings${did}`);
}

// Settings: the ONE Save. Checks everything first, then writes what changed (see lib/settings-save).
export async function saveGroupSettings(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const group = await db.group.findUnique({ where: { id: groupId }, select: { id: true, type: true, members: { select: { id: true, leftAt: true } } } });
  if (!group) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  if (group.members.find((m) => m.id === myId)?.leftAt) redirect(`/groups/${group.id}/people`); // left: read-only
  const back = `/groups/${group.id}/settings`;
  const str = (k: string) => String(formData.get(k) ?? "");
  const weights: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("w_")) weights[k.slice(2)] = String(v);
  const r = await saveAllSettings(
    group.id,
    myId,
    {
      name: formData.has("name") ? str("name") : undefined,
      markup: formData.has("markup") ? str("markup") : undefined,
      customMarkup: str("customMarkup"),
      secondaryCurrency: formData.has("secondaryCurrency") ? str("secondaryCurrency") : undefined,
      currency: formData.has("currency") ? str("currency") : undefined,
      tripDates: formData.has("tripStart") ? { start: str("tripStart"), end: str("tripEnd") } : undefined,
      tripPlace: formData.has("tripPlace") ? { place: str("tripPlace"), country: str("tripCountry") } : undefined,
      cover: formData.has("cover") ? str("cover") : undefined,
      sharing: formData.has("type") ? { type: str("type"), weights } : undefined,
      settle: formData.has("settleDay") ? { reminders: formData.get("reminders") === "on", settleDay: Number(formData.get("settleDay") ?? 0), settleMin: str("settleMin") } : undefined,
      notify: formData.has("notifyForm")
        ? { all: formData.get("all") === "on", expenses: formData.get("expenses") === "on", edits: formData.get("edits") === "on", payments: formData.get("payments") === "on", people: formData.get("people") === "on" }
        : undefined,
      was: formData.has("was") ? parseWas(str("was")) : undefined, // what the page showed: only what you changed is saved
    },
    dayKey(new Date(), await getTimeZone()),
  );
  if (!r.ok) redirect(`${back}?${new URLSearchParams({ error: r.code && r.code !== "conflict" ? r.code : r.error })}`);
  if (r.convertTo) redirect(`${back}?convert=${r.convertTo}`);
  redirect(`/groups/${group.id}?saved=settings${r.eventId ? `&did=${r.eventId}` : ""}`);
}

// Second step of changing the currency: convert everything at the confirmed rate.
export async function convertGroupCurrency(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const currency = String(formData.get("currency") ?? "");
  const rate = cleanRateText(String(formData.get("rate") ?? ""));
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  if (!(await isGroupAdmin(group.id, myId))) redirect(`/groups/${group.id}/settings?error=admin`);
  const r = await changeGroupCurrency(group.id, myId, currency, rate);
  if (!r.ok) redirect(`/groups/${group.id}/settings?convert=${currency}&error=${encodeURIComponent(r.error)}`);
  redirect(`/groups/${group.id}?saved=settings${r.eventId ? `&did=${r.eventId}` : ""}`);
}

// Records that one person paid another back (from Smart Settle's "They’ve paid me" / "I’ve paid").
// This is only a record — the app never moves real money.
export async function recordPayment(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const fromId = String(formData.get("fromId") ?? "");
  const toId = String(formData.get("toId") ?? "");
  const amount = Number(formData.get("amount") ?? 0);

  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group) redirect("/");
  const ids = group.members.map((m) => m.id);
  const myId = await getMyMemberId(group.id);
  if (!myId || !ids.includes(myId)) redirect("/private");
  if (await hasLeft(group.id, myId)) redirect(`/groups/${group.id}?tab=balances&error=${encodeURIComponent(LEFT_ERROR)}`);
  if (!ids.includes(fromId) || !ids.includes(toId) || fromId === toId) redirect(`/groups/${group.id}?tab=balances`);
  if (group.closed || group.deletedAt) redirect(`/groups/${group.id}`);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2_000_000_000) redirect(`/groups/${group.id}?tab=balances`);

  const key = cleanKey(formData.get("rid"));
  const fp = fingerprintOf("pay", group.id, fromId, toId, amount);
  const ks = await keyState(key, fp);
  if (ks.state === "stale") redirect(`/groups/${group.id}?tab=balances&error=${encodeURIComponent(STALE_KEY_ERROR)}`);
  if (ks.state === "done" || (!key && (await isDoubleTap(group.id, fromId, toId, amount, myId)))) redirect(`/groups/${group.id}?tab=balances&paid=1`);
  const names = await db.member.findMany({ where: { id: { in: [fromId, toId] } }, select: { id: true, name: true, accountId: true, claimedAt: true } });
  const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? "Someone";
  let did = "";
  try {
   did = await db.$transaction(async (tx) => {
    const p = await createPayment(tx, { groupId: group.id, fromId, toId, amount, createdById: myId, needsOk: needsOkFor(names.find((n) => n.id === toId), myId) });
    await claimKey(tx, key, p.id, fp);
    return logEvent(tx, {
      groupId: group.id,
      actorId: myId,
      kind: "payment_recorded",
      text: paymentText(myId, fromId, toId, nameOf(fromId), nameOf(toId), formatMoney(amount, group.currency)),
      paymentId: p.id,
      undo: { type: "payment_delete", paymentId: p.id },
    });
   });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
  }
  redirect(`/groups/${group.id}?tab=balances&paid=1${did ? `&did=${did}` : ""}`);
}

// Close a group (hide it from the main list, stop new expenses) or reopen it.
export async function setGroupClosed(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const closed = formData.get("closed") === "1";
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group || group.deletedAt) redirect("/"); // a deleted group is not closed or reopened
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  if (await hasLeft(group.id, myId)) redirect(`/groups/${group.id}?error=${encodeURIComponent(LEFT_ERROR)}`);

  let did = "";
  if (group.closed !== closed) {
    did = await db.$transaction(async (tx) => {
      await tx.group.update({ where: { id: group.id }, data: { closed, closedAt: closed ? new Date() : null } });
      return logEvent(tx, {
        groupId: group.id,
        actorId: myId,
        kind: closed ? "group_closed" : "group_reopened",
        text: closed ? "closed the group" : "reopened the group",
        undo: { type: "group_set", data: { closed: group.closed, closedAt: group.closedAt ? group.closedAt.toISOString() : null } },
      });
    });
  }
  redirect(closed ? `/?closed=1${did ? `&did=${did}&g=${group.id}` : ""}` : `/groups/${group.id}${did ? `?did=${did}` : ""}`);
}

// Smart Settle across groups: records each group's part of a combined settle-up.
// Every part is re-checked against that group's current Smart Settle first.
export async function settleAcrossGroups(formData: FormData) {
  let parts: { groupId: string; fromId: string; toId: string; amount: number }[] = [];
  try {
    const raw = JSON.parse(String(formData.get("parts") ?? "[]"));
    if (Array.isArray(raw)) {
      // The same part twice would record the same payment twice.
      const seen = new Set<string>();
      parts = raw.filter((p) => {
        const k = `${p?.groupId}|${p?.fromId}|${p?.toId}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
  } catch {
    redirect("/settle?settle=error");
  }
  const key = cleanKey(formData.get("rid"));
  const fp = fingerprintOf("settle-across", ...parts.map((p) => `${p?.groupId}|${p?.fromId}|${p?.toId}|${p?.amount}`).sort());
  const ks = await keyState(key, fp);
  if (ks.state === "stale") redirect("/settle?settle=stale");
  if (ks.state === "done") redirect("/settle?settle=done");
  const { loadGroup } = await import("@/lib/group-data");
  const memberships = await getMemberships();
  const checked: { groupId: string; fromId: string; toId: string; amount: number; currency: string; names: Map<string, string>; needsOk: boolean }[] = [];

  for (const p of parts) {
    const myId = memberships[String(p.groupId)];
    const data = myId ? await loadGroup(String(p.groupId), { events: false }) : null;
    if (!data || !myId) redirect("/settle?settle=error");
    if (data.group.deletedAt || data.group.closed || (await hasLeft(data.group.id, myId))) redirect("/settle?settle=changed");
    const ok = data.transfers.some((t) => t.from === p.fromId && t.to === p.toId && t.amount === p.amount) && (p.fromId === myId || p.toId === myId);
    if (!ok) redirect("/settle?settle=changed"); // balances moved since the page loaded
    checked.push({ ...p, currency: data.group.currency, names: new Map(data.group.members.map((m) => [m.id, m.name])), needsOk: needsOkFor(data.group.members.find((m) => m.id === p.toId), myId) });
  }

  try {
   await db.$transaction(async (tx) => {
    await claimKey(tx, key, "settled", fp);
    for (const c of checked) {
      const myId = memberships[c.groupId];
      const pay = await createPayment(tx, { groupId: c.groupId, fromId: c.fromId, toId: c.toId, amount: c.amount, createdById: myId, needsOk: c.needsOk });
      await logEvent(tx, {
        groupId: c.groupId,
        actorId: myId,
        undo: { type: "payment_delete", paymentId: pay.id },
        kind: "payment_recorded",
        text: `${paymentText(myId, c.fromId, c.toId, c.names.get(c.fromId) ?? "Someone", c.names.get(c.toId) ?? "Someone", formatMoney(c.amount, c.currency))} (Smart Settle across groups)`,
        paymentId: pay.id,
      });
    }
   });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
  }
  redirect("/settle?settle=done");
}

// "Record a payment": any amount (full or part) between any two people in the group.
export async function recordCustomPayment(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const fromId = String(formData.get("fromId") ?? "");
  const toId = String(formData.get("toId") ?? "");
  const amountText = String(formData.get("amount") ?? "");
  const fromSettle = formData.get("back") === "settle";
  // From a finished card game's "Who pays whom": stay on the game.
  const potGame = /^pot:[A-Za-z0-9_-]{6,40}$/.test(String(formData.get("back") ?? "")) ? String(formData.get("back")).slice(4) : "";

  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true, name: true, accountId: true, claimedAt: true } } } });
  if (!group || group.deletedAt) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  if (group.closed) redirect(`/groups/${group.id}`);
  if (await hasLeft(group.id, myId)) redirect(`/groups/${group.id}?tab=balances&error=${encodeURIComponent(LEFT_ERROR)}`);

  const back = (error: string) =>
    redirect(
      potGame
        ? `/groups/${group.id}/pot/${potGame}?${new URLSearchParams({ error })}`
        : fromSettle
        ? `/groups/${group.id}/settle?${new URLSearchParams({ error })}`
        : `/groups/${group.id}/pay?${new URLSearchParams({ from: fromId, to: toId, amount: amountText, error })}`,
    );
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name;
  if (!nameOf(fromId) || !nameOf(toId)) back("Pick who paid and who they paid.");
  if (fromId === toId) back("Pick two different people.");
  const amount = parseAmount(amountText, group.currency);
  if (amount === null || amount <= 0) back(amountError(amountText, group.currency));
  // More than they owe (often a typo with an extra zero): ask once before saving.
  if (!potGame && formData.get("over") !== "1") {
    const { loadGroup } = await import("@/lib/group-data");
    const data = await loadGroup(group.id, { events: false });
    const owes = Math.max(0, -(data?.net[fromId] ?? 0));
    if (amount! > owes)
      redirect(overpayHref(group.id, { from: fromId, to: toId, amount: amountText, owes: String(owes) }, fromSettle));
  }
  const done = potGame ? `/groups/${group.id}/pot/${potGame}?paid=1` : fromSettle ? `/groups/${group.id}/settle?paid=1` : `/groups/${group.id}?tab=balances&paid=1`;
  const key = cleanKey(formData.get("rid"));
  const fp = fingerprintOf("pay-custom", group.id, fromId, toId, amount, potGame, fromSettle);
  const ks = await keyState(key, fp);
  if (ks.state === "stale") back(STALE_KEY_ERROR);
  if (ks.state === "done" || (!key && (await isDoubleTap(group.id, fromId, toId, amount!, myId)))) redirect(done);

  let did = "";
  try {
   did = await db.$transaction(async (tx) => {
    const p = await createPayment(tx, { groupId: group.id, fromId, toId, amount: amount!, createdById: myId, needsOk: needsOkFor(group.members.find((m) => m.id === toId), myId) });
    await claimKey(tx, key, p.id, fp);
    return logEvent(tx, {
      groupId: group.id,
      actorId: myId,
      kind: "payment_recorded",
      text: paymentText(myId, fromId, toId, nameOf(fromId)!, nameOf(toId)!, formatMoney(amount!, group.currency)),
      paymentId: p.id,
      undo: { type: "payment_delete", paymentId: p.id },
    });
   });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
  }
  redirect(did ? `${done}&did=${did}` : done);
}

const ADMIN_ONLY = "Only the person who started the group can do that.";

// People screen: rename, remove (never used), leave / rejoin.
async function peopleContext(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  return { groupId, memberId, myId };
}

function backToPeople(groupId: string, r: { ok: true; eventId?: string } | { ok: false; error: string }): never {
  const q = r.ok ? (r.eventId ? `did=${r.eventId}` : "") : `error=${encodeURIComponent(r.error)}`;
  redirect(`/groups/${groupId}/people${q ? `?${q}` : ""}`);
}

export async function renamePerson(formData: FormData) {
  const { groupId, memberId, myId } = await peopleContext(formData);
  backToPeople(groupId, await renameMember(groupId, myId, memberId, String(formData.get("name") ?? "")));
}

export async function removePerson(formData: FormData) {
  const { groupId, memberId, myId } = await peopleContext(formData);
  if (!(await isGroupAdmin(groupId, myId))) backToPeople(groupId, { ok: false, error: ADMIN_ONLY });
  const row = await db.member.findFirst({ where: { id: memberId, groupId }, select: { accountId: true } });
  // Someone with an account, or anyone already in expenses or payments, is removed but kept in the history
  // (they can't rejoin on their own). A name that was never used is deleted completely.
  if (row?.accountId || (await isMemberUsed(memberId))) backToPeople(groupId, await setMemberLeft(groupId, myId, memberId, true));
  backToPeople(groupId, await removeMembers(groupId, myId, [memberId], false));
}

export async function setPersonLeft(formData: FormData) {
  const { groupId, memberId, myId } = await peopleContext(formData);
  // You can always leave or rejoin yourself. Taking someone else out is for whoever looks after the group; any member can bring back
  // someone who left on their own (only a person the admin removed needs the admin: setMemberLeft checks that).
  if (memberId !== myId && formData.get("left") === "1" && !(await isGroupAdmin(groupId, myId))) backToPeople(groupId, { ok: false, error: ADMIN_ONLY });
  backToPeople(groupId, await setMemberLeft(groupId, myId, memberId, formData.get("left") === "1"));
}

// "We settled outside the app": record every Smart Settle payment and close the group.
export async function settleEverything(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  const r = await settleAllAndClose(group.id, myId, String(formData.get("plan") ?? ""));
  if (!r.ok) redirect(`/groups/${group.id}?tab=balances&error=${encodeURIComponent(r.error)}`);
  redirect(`/?closed=1&did=${r.eventId}&g=${group.id}`);
}

// Phone notifications: this phone's subscription is saved for every person
// it's signed in as, so changes in any of its groups reach it.
type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function pushPublicKey(): Promise<string> {
  return (await vapidKeys()).publicKey;
}

export async function savePushSubscription(sub: PushSub): Promise<{ ok: boolean; groups: number }> {
  if (!(await allow(`push:${(await originAndIp()).ip}`, 60, 3600))) return { ok: false, groups: 0 };
  const clean = validSub(sub);
  if (!clean) return { ok: false, groups: 0 };
  const r = await savePushFor(await getMemberships(), clean);
  return { ok: r.ok, groups: r.groups };
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const memberships = await getMemberships();
  await db.pushSubscription.deleteMany({ where: { endpoint: String(endpoint), memberId: { in: Object.values(memberships) } } });
}

// ---------- Optional email sign-in ----------

async function originAndIp() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  // Links in emails always point at the real site in production, never at
  // whatever address the request claimed to come from.
  return { origin: process.env.VERCEL_ENV === "production" ? SITE_URL : `${proto}://${host}`, ip: clientIp(h) };
}

export async function requestCode(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const back = safeBack(String(formData.get("back") ?? "/"));
  const { origin, ip } = await originAndIp();
  const name = cleanNames([String(formData.get("name") ?? "")])[0] ?? "";
  const mode = formData.get("mode") === "signup" ? "signup" : "";
  const r = await requestLoginCode(email, ip, origin, new Date(), back);
  const q = new URLSearchParams({ e: email.trim().toLowerCase(), back });
  if (name) q.set("n", name);
  if (mode) q.set("mode", mode);
  if (r.ok) q.set("sent", "1");
  else q.set("error", r.error);
  redirect(`/signin?${q}`);
}

export async function verifyCode(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const back = safeBack(String(formData.get("back") ?? "/"));
  const testing = (process.env.MAIL_OUTBOX === "1" && !process.env.VERCEL) || (process.env.VERCEL_ENV === "preview" && /\.test$/i.test(email.trim()));
  const { ip } = await originAndIp();
  if (!testing && (!(await allow(`verify-ip:${ip}`, 30, 900)) || !(await allow(`verify-email:${email.trim().toLowerCase()}`, 10, 900)))) {
    redirect(`/signin?${new URLSearchParams({ e: email, back, sent: "1", error: "Too many tries. Wait 15 minutes and ask for a new code." })}`);
  }
  const r = await verifyLoginCode(email, String(formData.get("code") ?? ""));
  if (!r.ok) redirect(`/signin?${new URLSearchParams({ e: email, back, sent: "1", error: r.error, n: String(formData.get("name") ?? "") })}`);
  const name = cleanNames([String(formData.get("name") ?? "")])[0];
  if (name) await db.account.updateMany({ where: { id: r.accountId, name: "" }, data: { name } });
  await signInAs(r.accountId);
  redirect(`${back}${back.includes("?") ? "&" : "?"}signedin=1`);
}

// How a payment reads in the history and alerts, after the name of whoever
// recorded it: "Ravi paid Varun ₹5,000", "Varun got ₹5,000 from Ravi", or
// "Asha recorded Ravi paid Varun ₹5,000".
function paymentText(actorId: string, fromId: string, toId: string, from: string, to: string, amount: string): string {
  if (actorId === fromId) return `paid ${to} ${amount}`;
  if (actorId === toId) return `got ${amount} from ${from}`;
  return `recorded ${from} paid ${to} ${amount}`;
}

// You page → "Your name": the name friends see in invites and when they search
// for you. Optionally also renames you in the groups where you still go by the
// old name (a different name you picked for one group is left alone).
export async function saveMyName(formData: FormData) {
  const account = await getAccount();
  if (!account) redirect("/signin?back=/account");
  const name = cleanNames([String(formData.get("name") ?? "")])[0];
  if (!name) redirect("/account?name=empty");
  const old = account.name ?? "";
  await db.account.update({ where: { id: account.id }, data: { name } });
  let changed = 0;
  if (formData.get("groups") === "on" && old) {
    const mine = await db.member.findMany({ where: { accountId: account.id, leftAt: null, group: { deletedAt: null } }, select: { id: true, groupId: true, name: true } });
    for (const m of mine) {
      if (!sameName(m.name, old) || m.name === name) continue;
      const r = await renameMember(m.groupId, m.id, m.id, name);
      if (r.ok) changed++;
    }
  }
  redirect(`/account?name=saved&groups=${changed}`);
}

export async function signOutOtherPhonesAction(formData?: FormData) {
  // Other phones stop getting notifications too; this one keeps them.
  const account = await getAccount();
  if (account) {
    const keep = String(formData?.get("endpoint") ?? "");
    const members = await db.member.findMany({ where: { accountId: account.id }, select: { id: true } });
    await db.pushSubscription
      .deleteMany({ where: { memberId: { in: members.map((m) => m.id) }, ...(keep ? { endpoint: { not: keep } } : {}) } })
      .catch(() => undefined);
  }
  const ok = await signOutOtherPhones();
  redirect(ok ? "/account?others=out#other-phones" : "/signin");
}

export async function signOutThisPhone(formData?: FormData) {
  // This phone stops getting notifications for the groups it was signed in to.
  const endpoint = String(formData?.get("endpoint") ?? "");
  if (endpoint.startsWith("https://") && endpoint.length < 1000) {
    const memberIds = Object.values(await getMemberships());
    if (memberIds.length) await db.pushSubscription.deleteMany({ where: { endpoint, memberId: { in: memberIds } } }).catch(() => undefined);
  }
  await forgetThisPhone();
  redirect("/");
}

export async function deleteMyAccount() {
  const account = await getAccount();
  await keepGroupsDropAccount();
  if (account) await deleteAccount(account.id);
  redirect("/?deleted=account");
}

const safeBack = safePath;

// ---------- Delete / restore a whole group ----------

export async function deleteGroup(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group || group.deletedAt) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  if (!(await isGroupAdmin(group.id, myId))) redirect(`/groups/${group.id}/settings?error=admin`);
  await db.$transaction(async (tx) => {
    await tx.group.update({ where: { id: group.id }, data: { deletedAt: new Date(), deletedById: myId } });
    await logEvent(tx, { groupId: group.id, actorId: myId, kind: "group_deleted", text: "deleted the group (it can be restored for 30 days)" });
  });
  // Replaces the screen in the phone's history, so Back doesn't land on the deleted group.
  redirect("/groups?deleted=group#deleted", RedirectType.replace);
}

export async function restoreGroup(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!group || !group.deletedAt) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/");
  // Bringing a deleted group back is for whoever deleted it or looks after it, and not for someone who left.
  if (!canRestoreGroup(group, group.members, myId)) redirect("/");
  await db.$transaction(async (tx) => {
    await tx.group.update({ where: { id: group.id }, data: { deletedAt: null, deletedById: "" } });
    await logEvent(tx, { groupId: group.id, actorId: myId, kind: "group_restored", text: "restored the group" });
  });
  redirect(`/groups/${group.id}`);
}

// The same payment recorded by the same person seconds ago = a double tap.
// Only used when the form carries no request key: with one, a real second
// payment of the same amount (two part-payments) is kept.
async function isDoubleTap(groupId: string, fromId: string, toId: string, amount: number, createdById: string): Promise<boolean> {
  const recent = await db.payment.findFirst({
    where: { groupId, fromId, toId, amount, createdById, deletedAt: null, createdAt: { gt: new Date(Date.now() - 20_000) } },
  });
  return Boolean(recent);
}


// People → "not on Loopin yet" → Invite by email.
export async function invitePersonByEmail(formData: FormData) {
  const { group, me } = await memberContext(String(formData.get("groupId") ?? ""));
  const { origin, ip } = await originAndIp();
  if (!(await allow(`invite:${ip}`, 40, 3600))) redirect(`/groups/${group.id}/people?error=${encodeURIComponent("Too many invites from here. Wait a bit.")}`);
  const { inviteToClaim } = await import("@/lib/invites");
  const r = await inviteToClaim(group.id, me.id, String(formData.get("memberId") ?? ""), String(formData.get("email") ?? ""), origin);
  redirect(`/groups/${group.id}/people?${r.ok ? new URLSearchParams({ invited: r.email }) : new URLSearchParams({ error: r.error })}`);
}

// People → a name with an open invitation → Cancel invitation (the admin, or the person who sent it).
// The name goes back to being a plain name that "That's me" can take. Balances don't change.
export async function cancelInvite(formData: FormData) {
  const { group, me } = await memberContext(String(formData.get("groupId") ?? ""));
  const { cancelInvitation } = await import("@/lib/invites");
  const r = await cancelInvitation(group.id, me.id, String(formData.get("memberId") ?? ""));
  redirect(`/groups/${group.id}/people?${r.ok ? new URLSearchParams({ cancelled: "1" }) : new URLSearchParams({ error: r.error })}`);
}

// You → Fingerprint / face sign-in → Remove (only your own passkeys).
export async function removeMyPasskey(formData: FormData) {
  const account = await getAccount();
  if (!account) redirect("/signin?back=/account");
  const { removePasskey } = await import("@/lib/passkeys");
  await removePasskey(account.id, String(formData.get("id") ?? ""));
  redirect("/account?removed=passkey");
}
