"use server";

import { SITE_URL } from "@/lib/site";
import { RedirectType } from "next/navigation";

import { cleanCover } from "@/lib/covers";
import { redirect } from "@/lib/fresh-redirect";
import { db } from "@/lib/db";
import { clearMoveConfirmation, forgetThisPhone, getAccount, getMemberships, getMyMemberId, confirmedGuestIds, guestCookieAfterDelete, guestCookieHasRoomFor, keepGroupsDropAccount, moveGuestsToAccount, parseConfirmed, setMoveConfirmation, setMyMemberId, signInAs, signOutOtherPhones } from "@/lib/identity";
import { deleteAccount, requestLoginCode, verifyLoginCode } from "@/lib/auth";
import { allow, clientIp } from "@/lib/rate-limit";
import { PAY_CHANGE_LIMIT_TEXT, isPaymentChangeEvent, payChangeOk } from "@/lib/pay-limit";
import { headers } from "next/headers";
import { ipCountry } from "@/lib/region";
import { markLeft } from "@/lib/offline/left-cookie";
import { cleanNames, sameName } from "@/lib/names";
import { amountError, isSupportedCurrency, overCap, overpayHref, parseAmount, parsePercent } from "@/lib/money";
import { paymentTooBigText } from "@/lib/payments";
import { getRate, type RateAnswer } from "@/lib/rate-cache";
import { cleanRateText } from "@/lib/conversion";
import { deletePayment, saveExpense, setExpenseDeleted, setPaymentDeleted, type SaveExpenseInput } from "@/lib/save-expense";
import { MOVED_OUT_REJOIN_TEXT, ownMoveOut, undoEvent, undoViewerFor } from "@/lib/undo";
import { renameMember, setMemberLeft } from "@/lib/people";
import { removeOrKeepPerson } from "@/lib/remove-person";
import { settleAllAndClose } from "@/lib/settle-all";
import { isPairGroup } from "@/lib/direct-guard";
import { vapidKeys } from "@/lib/push";
import { addExpenseChecks } from "@/lib/add-expense-checks";
import { changeGroupCurrency, hasOtherMoney, loadOtherMoney, updateGroupBasics } from "@/lib/group-changes";
import { logEvent } from "@/lib/events";
import { countryOf } from "@/lib/geo";
import { overKey, paymentText, recordPaymentCore } from "@/lib/pay-record";
import { cleanKey, fingerprintOf, isDuplicateKey, keyState, previousResult, STALE_KEY_ERROR } from "@/lib/once";
import { safePath } from "@/lib/paths";
import { addRegistered, copyPushTo, inviteByEmail } from "@/lib/invites";
import { savePushFor, validSub } from "@/lib/push-subs";
import { createGroupFor, setTripDates, updateSharing } from "@/lib/group-setup";
import { addWaitingBill } from "@/lib/home/bills-db";
import { checkBudgets } from "@/lib/home/budgets-db";
import { after } from "next/server";
import { noteSavedTripPlaceLater, noteTripPlaceLater } from "@/lib/unknown-places";
import { getTimeZone } from "@/lib/tz";
import { dayKey, todayKey } from "@/lib/dates";
import { niceDate } from "@/lib/format";
import { offlineOn, W } from "@/lib/offline/words";
import { importSplitwise } from "@/lib/splitwise-import";
import { canRestoreGroup, isGroupAdmin } from "@/lib/group-admin";
import { CLOSED_PAY_ERROR, hasLeft, LEFT_ERROR } from "@/lib/active";
import { parseWas, saveAllSettings } from "@/lib/settings-save";
import { countGuestJoin, guestJoinAllowed, joinExisting, joinExistingAsGuest, joinNew, joinNewAsGuest, joinReplay, newInviteLink, releaseGuestName, type JoinFail } from "@/lib/join";
import { GUEST_REFUSAL, gateGuest, isGuestMember, refusalNotes, renameRefusal } from "@/lib/guest-rules";
import { acceptInvitation, declineInvitation } from "@/lib/invitations";
import { flashTo, type Notes } from "@/lib/flash";
import { FORM_OUT_OF_DATE, formCurrencyRefusal } from "@/lib/form-currency";


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
  // A place with no photo yet: only its name is noted (after the group is made; never fails this).
  if (group.type === "trip") noteTripPlaceLater((job) => after(job), account.id, group.tripPlace, group.tripCountry);
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
  if (!(await allow(`import:${(await originAndIp()).ip}`, 10, 3600))) redirect(await flashTo("/import", { error: "Lots of imports from here in the last hour. Wait a bit and try again." }));
  // The one-time key from the form: without it (a page opened before this update) the screen is out of date, and nothing is made.
  const key = cleanKey(formData.get("rid"));
  if (!key) redirect(await flashTo("/import", { error: FORM_OUT_OF_DATE }));
  const r = await importSplitwise(account, {
    key,
    text: String(formData.get("csv") ?? ""),
    groupName: String(formData.get("groupName") ?? ""),
    type: String(formData.get("type") ?? "other"),
    me: Number(formData.get("me") ?? -1),
    map: readColumnMap(String(formData.get("map") ?? "")),
    currency: String(formData.get("currency") ?? "") || undefined,
  });
  if (!r.ok) redirect(await flashTo("/import", { error: r.error }));
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
  const group = await db.group.findUnique({ where: { id: groupId }, select: { id: true, inviteCode: true, deletedAt: true, type: true } });
  if (!group || group.deletedAt) redirect("/");
  // Nobody is added to, or invited into, a pair of two people.
  if (group.type === "direct") redirect(`/people/${group.id}`);
  const myId = await getMyMemberId(group.id);
  const me = myId ? await db.member.findFirst({ where: { id: myId, groupId: group.id } }) : null;
  if (!me) redirect("/private");
  // Adding and inviting people is for people still in the group.
  if (me.leftAt) redirect(await flashTo(["groups", group.id, "people"], { error: "You left this group. Rejoin it to add or invite people." }));
  // Adding and inviting people needs an account (a guest gets the sign-in sheet).
  const refused = await gateGuest(me.id);
  if (refused) redirect(await flashTo(["groups", group.id, "people"], refusalNotes(refused)));
  return { group, me };
}

// Live suggestions while typing in "Add people".
// Add someone who's already on Loopin (in the group at once as a name, and invited).
export async function addPerson(formData: FormData) {
  const { group, me } = await memberContext(String(formData.get("groupId") ?? ""));
  const { origin, ip } = await originAndIp();
  if (!(await allow(`add-person:${ip}`, 60, 3600))) redirect(await flashTo(["groups", group.id, "invite"], { error: "Too many adds from here. Wait a bit." }));
  const r = await addRegistered(group.id, me.id, String(formData.get("accountId") ?? ""), origin, { later: (job) => after(job) });
  // Someone brought back who has their own account is only invited: they rejoin when they accept ("back" tells the screen to say so).
  const notes: Notes = r.ok ? { invited: JSON.stringify([[r.name, ""]]) } : { error: r.error };
  const extra = r.ok ? (r.invitedBack ? { back: "1" } : r.eventId ? { did: r.eventId } : {}) : {};
  redirect(await flashTo(["groups", group.id, "invite"], notes, extra));
}

// "Couldn’t invite: a, b, c": as many as fit in a short message, then "and N more" (a long list must not be cut off mid-word).
function couldntInvite(bad: string[]): string {
  const head = "Couldn’t invite: ";
  const shown: string[] = [];
  let used = head.length;
  for (const b of bad) {
    const one = b.slice(0, 60);
    const left = bad.length - shown.length - 1;
    const tail = left > 0 ? ` and ${left} more` : "";
    if (used + one.length + (shown.length ? 2 : 0) + tail.length > 280 && shown.length) break;
    shown.push(one);
    used += one.length + 2;
  }
  const more = bad.length - shown.length;
  return `${head}${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

// Invite by email: they are in the group at once as a name, and invited.
export async function invitePeople(formData: FormData) {
  const { group, me } = await memberContext(String(formData.get("groupId") ?? ""));
  const { origin, ip } = await originAndIp();
  if (!(await allow(`invite:${ip}`, 40, 3600))) redirect(await flashTo(["groups", group.id, "invite"], { error: "Too many invites from here. Wait a bit." }));
  const r = await inviteByEmail(group.id, me.id, String(formData.get("emails") ?? ""), origin, { later: (job) => after(job) });
  const notes: Notes = {};
  if (r.people.length) notes.invited = JSON.stringify(r.people.map((p) => [p.name, p.email]));
  if (r.bad.length) notes.error = couldntInvite(r.bad);
  redirect(await flashTo(["groups", group.id, "invite"], notes));
}

// Joining from an invitation (link, QR, contact message or email). With an account it is one tap; without one (a guest) the person
// picks their name and the phone remembers it (a signed note, see identity.ts). The rules live in lib/join.ts.
async function joinContext(code: string) {
  const account = await getAccount();
  return { account };
}

async function finishJoin(code: string, groupId: string, memberId: string, account: { id: string; email: string } | null) {
  // A phone with no sign-in must be able to hold one more name in its cookie: checked here too, so nothing is ever written that would not fit
  // (the earlier check, before the join, is the one that keeps a new member from being made at all).
  if (!account && !(await guestCookieHasRoomFor(groupId))) redirect(`/join/${code}?step=name&error=phone`);
  // Only an account has email invitations to close and phones to copy; a guest just gets the name written on this phone.
  if (account) {
    await db.invite.updateMany({ where: { groupId, email: account.email, acceptedAt: null }, data: { acceptedAt: new Date() } });
    await setMyMemberId(groupId, memberId);
    await copyPushTo(account.id, memberId);
  } else {
    await setMyMemberId(groupId, memberId);
  }
  redirect(`/groups/${groupId}`);
}

// Where a refused join goes: the join page says it calmly.
function joinRefused(code: string, r: JoinFail, step = ""): never {
  const base = `/join/${code}${r.reason === "removed" ? "?error=removed" : r.reason === "claimed" ? "?error=claimed" : r.reason === "name" ? "?error=name" : r.reason === "left" ? "?error=left" : r.reason === "full" ? "?error=full" : ""}`;
  // Someone not signed in goes back to the list of names they were on.
  redirect(step ? `${base}${base.includes("?") ? "&" : "?"}${step}` : base);
}

// The name this phone already holds in the group (no account, not removed, not left), if any: such a phone is sent straight to the group, uncounted.
async function heldGuestName(groupId: string | undefined): Promise<string | undefined> {
  const id = groupId ? await getMyMemberId(groupId) : undefined;
  if (!groupId || !id) return undefined;
  return (await db.member.findFirst({ where: { id, groupId, accountId: null, removedAt: null, leftAt: null }, select: { id: true } }))?.id;
}

// A guest's two limits (per network an hour for every attempt, per link a day for successful new joins): "busy" is the same calm note the account join uses.
async function guestJoinBusy(code: string, ip: string): Promise<boolean> {
  return !(await guestJoinAllowed(ip, code));
}

// "That's me": claim a name someone added before invitations existed (with or without an account).
export async function joinAsExisting(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  const { account } = await joinContext(code);
  const memberId = String(formData.get("memberId") ?? "");
  const rid = cleanKey(formData.get("rid")); // the form's one-time key: a lost reply can be sent again and gets the same person back
  // The same form again (its reply was lost) is answered first: it uses none of the limits and counts nothing a second time, even if the link has changed since.
  const replayed = await joinReplay(rid, code, "that", memberId, account);
  if (replayed) return finishJoin(code, replayed.groupId, replayed.memberId, account);
  const group = await db.group.findUnique({ where: { inviteCode: code }, select: { id: true } });
  if (!group) redirect(`/join/${code}`);
  const ip = (await originAndIp()).ip;
  const held = account ? undefined : await heldGuestName(group.id);
  if (!account && !held && (await guestJoinBusy(code, ip))) redirect(`/join/${code}?step=name&error=busy`);
  // A phone with no sign-in keeps its groups in one small cookie: refuse BEFORE joining if one more would not fit (nothing is created).
  if (!account && !held && !(await guestCookieHasRoomFor(group.id))) redirect(`/join/${code}?step=name&error=phone`);
  const r = account ? await joinExisting(code, account, memberId, { rid }) : await joinExistingAsGuest(code, memberId, await getMyMemberId(group.id), { rid });
  if (!r.ok) joinRefused(code, r, account ? "" : "step=name");
  if (!account && r.memberId !== held) await countGuestJoin(code); // a new guest really joined: one more for this link today
  await finishJoin(code, r.groupId, r.memberId, account);
}

// Join as yourself (your verified account), or as a new name with no account.
export async function joinAsNew(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  const ip = (await originAndIp()).ip;
  const { account } = await joinContext(code);
  const rid = cleanKey(formData.get("rid")); // the form's one-time key (see joinAsExisting)
  const replayed = await joinReplay(rid, code, "new", String(formData.get("name") ?? ""), account); // a lost reply sent again: no limits used, nothing counted twice
  if (replayed) return finishJoin(code, replayed.groupId, replayed.memberId, account);
  const groupRow = await db.group.findUnique({ where: { inviteCode: code }, select: { id: true } });
  // A phone that already holds a name in this group goes straight to it, without counting against any limit.
  const held = account ? undefined : await heldGuestName(groupRow?.id);
  // Generous per network: a whole party can join on one venue's Wi-Fi.
  if (!held && !(await allow(`join:${ip}`, 120, 3600))) redirect(`/join/${code}?error=busy`);
  if (!account && !held && groupRow && !(await guestCookieHasRoomFor(groupRow.id))) redirect(`/join/${code}?step=name&error=phone`); // see joinAsExisting
  if (!account && !held && (await guestJoinBusy(code, ip))) redirect(`/join/${code}?step=name&error=busy`);
  const r = account ? await joinNew(code, account, String(formData.get("name") ?? ""), { rid }) : await joinNewAsGuest(code, String(formData.get("name") ?? ""), groupRow ? await getMyMemberId(groupRow.id) : undefined, { rid });
  // Someone whose move-out can still be undone is not quietly put back in: People explains and offers Undo my move-out.
  if (!r.ok && r.reason === "moved_out" && r.groupId && r.memberId) {
    await setMyMemberId(r.groupId, r.memberId);
    redirect(await flashTo(["groups", r.groupId, "people"], { error: MOVED_OUT_REJOIN_TEXT }));
  }
  if (!r.ok) joinRefused(code, r, account ? "" : "step=name");
  if (!account && r.memberId !== held) await countGuestJoin(code); // a new guest really joined: one more for this link today
  await finishJoin(code, r.groupId, r.memberId, account); // the group this join really landed in (not looked up again by the link, which may have changed)
}

// The Join / Not now buttons on an invitation (Home, Alerts and the group's own screen).
export async function answerInvitation(formData: FormData) {
  const account = await getAccount();
  if (!account) redirect("/signin");
  const key = String(formData.get("key") ?? "").slice(0, 200);
  const join = formData.get("answer") === "join";
  if (join) {
    const r = await acceptInvitation(account, key);
    // Their move-out can still be undone: People explains it, instead of quietly giving that up.
    if (!r.ok && r.movedOut) {
      await setMyMemberId(r.movedOut.groupId, r.movedOut.memberId);
      redirect(await flashTo(["groups", r.movedOut.groupId, "people"], { error: r.error }));
    }
    if (!r.ok) redirect(await flashTo("/", { error: r.error }));
    await setMyMemberId(r.groupId, r.memberId);
    redirect(`/groups/${r.groupId}`);
  }
  await declineInvitation(account, key);
  redirect("/");
}

// People → "Free this name": the admin (with an account) on a name held with no account, or a guest on their own name ("Not me").
export async function releaseGuestNameAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const myId = await getMyMemberId(groupId);
  if (!myId) redirect("/private");
  const r = await releaseGuestName(groupId, myId, memberId);
  // The guest who freed their own name is no longer that person: their phone is told so at once, and goes back to the join page.
  if (r.ok && memberId === myId) redirect("/");
  redirect(await flashTo(["groups", groupId, "people"], r.ok ? {} : refusalNotes(r.error), r.ok && r.eventId ? { did: r.eventId } : {}));
}

// Add people → "Make a new invite link": the old link (and email invites not yet accepted) stop working.
export async function makeNewInviteLink(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const myId = await getMyMemberId(groupId);
  if (!myId) redirect("/private");
  const refusedGuest = await gateGuest(myId); // admin only, and a guest admin needs an account too
  if (refusedGuest) redirect(await flashTo(["groups", groupId, "invite"], refusalNotes(refusedGuest)));
  const r = await newInviteLink(groupId, myId);
  redirect(await flashTo(["groups", groupId, "invite"], r.ok ? {} : { error: r.error }, r.ok ? { newlink: "1" } : {}));
}

// Saves a new expense — or changes an existing one — then goes back to the group page.
export async function addExpense(
  input: SaveExpenseInput & { again?: boolean; billRun?: { billId: string; period: string }; receiptId?: string; items?: { name: string; amount: number; people: string[] }[] },
): Promise<{ error: string; duplicateOf?: { id: string; description: string; amount: number; by: string; when: string } }> {
  // The checks both doors share (rate limit, pairs): src/lib/add-expense-checks.ts.
  const checks = await addExpenseChecks({ ip: (await originAndIp()).ip, groupId: input.groupId, currency: input.currency, editing: Boolean(input.expenseId) });
  if (!checks.ok) return { error: checks.error };
  const isPair = checks.isPair;
  // Fetch (and cache) today's rate before saving, so the save itself never waits on the internet.
  const g = await db.group.findUnique({ where: { id: input.groupId }, select: { currency: true } });
  // Open and fix (an expense kept on a phone keeps its `off-` key): another currency, a day before today, and "use the live rate" would quietly
  // use today's rate for an earlier day. Refused here too, not only on the phone: the rate for that day has to be entered.
  if (offlineOn() && input.requestKey?.startsWith("off-") && input.date && g && input.currency !== g.currency && input.rateMode !== "manual" && input.date < todayKey(new Date(), await getTimeZone())) {
    return { error: W.fixRateNote(niceDate(input.date)) + "." };
  }
  if (g && input.currency !== g.currency && input.rateMode === "auto") await getRate(input.currency, g.currency).catch(() => null);
  const me = await getMyMemberId(input.groupId);
  // A waiting bill is Home-group money setup: it needs an account. (An ordinary new expense is open to a guest; changing one is own-only, below.)
  if (input.billRun) {
    const refused = await gateGuest(me);
    if (refused) return { error: refused };
  }
  const requestKey = cleanKey(input.requestKey);
  // The bill's item lines and photo are saved in the same step as the expense: all or nothing
  // (a photo that expired stops the save, and the form keeps what was typed).
  const attach = { items: input.items, receiptId: input.receiptId };
  // "Enter amount" for a waiting bill: the month is claimed as it's saved, so it's added once.
  const result =
    input.billRun && !input.expenseId
      ? await addWaitingBill(input, me, getRate, input.billRun, requestKey, attach)
      : await saveExpense(input, me, getRate, { ignoreDoubleTap: true, requestKey, checkDuplicate: true, attach, guestRules: true });
  if (!result.ok) return { error: result.error, duplicateOf: result.duplicateOf };
  // Budgets: a nudge at 80% and when one goes over (after the reply is sent).
  after(() => checkBudgets(input.groupId).catch(() => []));
  // "Save & add another": straight back to a fresh form with the same people and split.
  if (input.again && !input.expenseId) redirect(`/groups/${input.groupId}/add?again=${result.id}`);
  if (isPair) redirect(`/people/${input.groupId}${result.eventId ? `?did=${result.eventId}` : ""}`);
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
  const r = await setExpenseDeleted(expenseId, await getMyMemberId(groupId), deleted, { guestRules: true });
  redirect(await flashTo(["groups", groupId], r.ok ? {} : refusalNotes(r.error), { tab: "activity", ...(r.ok && r.eventId ? { did: r.eventId } : {}) }));
}

// Delete a settle-up payment. Only the payer and the person paid can (even if they have left: they come back owing it). History keeps it.
// A payment recorded across several groups is taken off in all of them, in one step.
export async function removePayment(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");
  const memberships = await getMemberships();
  if (memberships[groupId] && !(await payChangeOk(memberships[groupId]))) redirect(await flashTo(["groups", groupId], { error: PAY_CHANGE_LIMIT_TEXT }, { tab: "activity" }));
  const r = await deletePayment(paymentId, memberships[groupId], { memberships, guestRules: true });
  redirect(await flashTo(["groups", groupId], r.ok ? {} : refusalNotes(r.error), { tab: "activity", ...(r.ok && r.eventId ? { did: r.eventId } : {}) }));
}

// Bring back a deleted settle-up payment (the payer or the person paid; the person paid alone if they took it off themselves).
export async function restorePayment(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");
  const memberships = await getMemberships();
  if (memberships[groupId] && !(await payChangeOk(memberships[groupId]))) redirect(await flashTo(["groups", groupId], { error: PAY_CHANGE_LIMIT_TEXT }, { tab: "activity" }));
  const r = await setPaymentDeleted(paymentId, memberships[groupId], false, { memberships, guestRules: true });
  redirect(await flashTo(["groups", groupId], r.ok ? {} : refusalNotes(r.error), { tab: "activity", ...(r.ok && r.eventId ? { did: r.eventId } : {}) }));
}

// Undo (or redo) any change in a group. `back` says which page to return to.
export async function undoChange(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  const back = String(formData.get("back") ?? "group");
  const memberships = await getMemberships();
  // Undoing or redoing a payment change is a payment change too: the same limit, checked before anything is written.
  const ev = /^[A-Za-z0-9_-]{6,40}$/.test(eventId) ? await db.groupEvent.findUnique({ where: { id: eventId }, select: { groupId: true, kind: true, paymentId: true, undo: true } }) : null;
  const limited = Boolean(ev && ev.groupId === groupId && isPaymentChangeEvent(ev) && memberships[groupId] && !(await payChangeOk(memberships[groupId])));
  const r: Awaited<ReturnType<typeof undoEvent>> = limited ? { ok: false, error: PAY_CHANGE_LIMIT_TEXT } : await undoEvent(eventId, memberships[groupId], await getTimeZone(), { memberships, guestRules: true });
  const notes: Notes = r.ok ? {} : refusalNotes(r.error);
  const done: Record<string, string> = r.ok ? { undone: "1", ...(r.eventId ? { did: r.eventId } : {}) } : {};
  if (back === "home") redirect(await flashTo("/", notes, { ...done, g: groupId }));
  if (back === "people") redirect(await flashTo(["groups", groupId, "people"], notes, done));
  if (back === "settle") redirect(await flashTo(["groups", groupId, "settle"], notes, done));
  if (/^pot:[A-Za-z0-9_-]{6,40}$/.test(back)) redirect(await flashTo(["groups", groupId, "pot", back.slice(4)], notes, done));
  redirect(await flashTo(["groups", groupId], notes, { tab: back === "balances" ? "balances" : "activity", ...done }));
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
  await signinIfGuest(groupId, myId);
  const weights: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("w_")) weights[k.slice(2)] = String(v);
  const r = await updateSharing(groupId, myId, { type: String(formData.get("type") ?? ""), weights });
  if (!r.ok) redirect(await flashTo(["groups", groupId, "settings"], { error: r.error }, {}, "sharing"));
  redirect(`/groups/${groupId}?saved=settings${r.eventId ? `&did=${r.eventId}` : ""}`);
}

export async function updateGroupSettings(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { members: { select: { id: true, leftAt: true, accountId: true } }, _count: { select: { expenses: true, payments: true } } },
  });
  if (!group) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  if (group.members.find((m) => m.id === myId)?.leftAt) redirect(`/groups/${group.id}/people`); // left: read-only
  await signinIfGuest(group.id, myId);

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
    if (!trip.ok) redirect(await flashTo(["groups", group.id, "settings"], { error: trip.error }));
  }
  // Where the trip went (for the trip passport): as typed, and a country from the list.
  if (group.type === "trip" && formData.has("tripPlace")) {
    const tripPlace = String(formData.get("tripPlace") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    const tc = String(formData.get("tripCountry") ?? "").toUpperCase();
    const tripCountry = countryOf(tc) ? tc : "";
    if (tripPlace !== group.tripPlace || tripCountry !== group.tripCountry) await db.group.update({ where: { id: group.id }, data: { tripPlace, tripCountry } });
    noteTripPlaceLater((job) => after(job), group.members.find((m) => m.id === myId)?.accountId, tripPlace, tripCountry); // the saved value; name only, after the save, never fails it
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
  const group = await db.group.findUnique({ where: { id: groupId }, select: { id: true, type: true, members: { select: { id: true, leftAt: true, accountId: true } } } });
  if (!group) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  if (group.members.find((m) => m.id === myId)?.leftAt) redirect(`/groups/${group.id}/people`); // left: read-only
  await signinIfGuest(group.id, myId);
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
  if (!r.ok) redirect(await flashTo(["groups", group.id, "settings"], { error: r.code && r.code !== "conflict" ? r.code : r.error }));
  // The place was saved: note it for new place photos if Loopin has none (the value as saved, name only, after the save, never fails it).
  if (group.type === "trip" && formData.has("tripPlace")) noteSavedTripPlaceLater((job) => after(job), group.id, group.members.find((m) => m.id === myId)?.accountId);
  if (r.convertTo) redirect(`${back}?${new URLSearchParams({ convert: r.convertTo })}`);
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
  await signinIfGuest(group.id, myId); // admin only, and a guest admin needs an account too
  if (!(await isGroupAdmin(group.id, myId))) redirect(`/groups/${group.id}/settings?error=admin`);
  const r = await changeGroupCurrency(group.id, myId, currency, rate);
  if (!r.ok) redirect(await flashTo(["groups", group.id, "settings"], { error: r.error }, { convert: currency }));
  redirect(`/groups/${group.id}?saved=settings${r.eventId ? `&did=${r.eventId}` : ""}`);
}

// Close a group (hide it from the main list, stop new expenses) or reopen it.
export async function setGroupClosed(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const closed = formData.get("closed") === "1";
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group || group.deletedAt) redirect("/"); // a deleted group is not closed or reopened
  if (group.type === "direct") redirect(`/people/${group.id}`); // a pair is never closed or reopened
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  if (await hasLeft(group.id, myId)) redirect(await flashTo(["groups", group.id], { error: LEFT_ERROR }));
  await signinIfGuest(group.id, myId);

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
    if (Array.isArray(raw)) parts = raw.filter((p) => p && typeof p === "object").map((p) => ({ groupId: String(p.groupId), fromId: String(p.fromId), toId: String(p.toId), amount: Number(p.amount) }));
  } catch {
    redirect("/settle?settle=error");
  }
  const { settleAcrossCore } = await import("@/lib/cross-settle-db");
  const limitKey = (await getAccount())?.id ?? Object.values(await getMemberships()).sort()[0];
  if (limitKey && !(await payChangeOk(limitKey))) redirect("/settle?settle=busy");
  const r = await settleAcrossCore(parts, await getMemberships(), cleanKey(formData.get("rid")));
  // The person's own page asks to come back to it ("people:<pairId>"); only a pair id from the parts themselves is accepted.
  const back = String(formData.get("back") ?? "");
  const backId = /^people:([A-Za-z0-9_-]{6,40})$/.exec(back)?.[1];
  if (backId && parts.some((p) => p.groupId === backId)) redirect(`/people/${backId}?settle=${r}`);
  redirect(`/settle?settle=${r}`);
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
  if (group.closed) redirect(await flashTo(["groups", group.id], { error: CLOSED_PAY_ERROR }, { tab: "balances" }));
  if (await hasLeft(group.id, myId)) redirect(await flashTo(["groups", group.id], { error: LEFT_ERROR }, { tab: "balances" }));

  const back = async (error: string): Promise<never> =>
    redirect(
      await (potGame
        ? flashTo(["groups", group.id, "pot", potGame], refusalNotes(error))
        : fromSettle
        ? flashTo(["groups", group.id, "settle"], refusalNotes(error))
        : flashTo(["groups", group.id, "pay"], refusalNotes(error), { from: fromId, to: toId, amount: amountText })),
    );
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name;
  // The page was drawn in a currency: if the group's currency changed since, the typed amount would be saved in the wrong one.
  const stale = formCurrencyRefusal(formData.get("currency"), group.currency);
  if (stale) await back(stale);
  if (!nameOf(fromId) || !nameOf(toId)) await back("Pick who paid and who they paid.");
  if (fromId === toId) await back("Pick two different people.");
  const amount = parseAmount(amountText, group.currency);
  if (amount === null || amount <= 0) await back(overCap(amountText, group.currency) ? paymentTooBigText(group.currency) : amountError(amountText, group.currency));
  const done = potGame ? `/groups/${group.id}/pot/${potGame}?paid=1` : fromSettle ? `/groups/${group.id}/settle?paid=1` : `/groups/${group.id}?tab=balances&paid=1`;
  const key = cleanKey(formData.get("rid"));
  const fp = fingerprintOf("pay-custom", group.id, fromId, toId, amount, potGame, fromSettle);
  const ks = await keyState(key, fp);
  if (ks.state === "stale") await back(STALE_KEY_ERROR);
  if (ks.state === "done" || (!key && (await isDoubleTap(group.id, fromId, toId, amount!, myId)))) redirect(done);

  if (!(await payChangeOk(myId))) await back(PAY_CHANGE_LIMIT_TEXT);
  // More than they (or the person paid) can owe each other (often a typo with an extra zero): asked once, checked inside the write.
  const r = await recordPaymentCore({ groupId: group.id, fromId, toId, amount: amount!, currency: group.currency, myId, key, fp, warnOver: !potGame && !(formData.get("over") === "1" && formData.get("overFor") === overKey(fromId, toId, amount!)), guestRules: true });
  if (r.kind === "refused") await back(r.error);
  if (r.kind === "over") redirect(overpayHref(group.id, { from: fromId, to: toId, amount: amountText, owes: String(r.limit), side: r.side }, fromSettle));
  redirect(r.kind === "done" && r.did ? `${done}&did=${r.did}` : done);
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
  return { groupId, memberId, myId, guest: await isGuestMember(myId) };
}

// A guest asking for something that needs an account: back to the group with the sign-in note (the sheet opens there).
async function signinIfGuest(groupId: string, myId: string | undefined): Promise<void> {
  const refused = await gateGuest(myId);
  if (refused) redirect(await flashTo(["groups", groupId], refusalNotes(refused)));
}

async function backToPeople(groupId: string, r: { ok: true; eventId?: string } | { ok: false; error: string }): Promise<never> {
  redirect(await flashTo(["groups", groupId, "people"], r.ok ? {} : refusalNotes(r.error), r.ok && r.eventId ? { did: r.eventId } : {}));
}

export async function renamePerson(formData: FormData) {
  const { groupId, memberId, myId, guest } = await peopleContext(formData);
  const noRename = renameRefusal(guest, myId, memberId); // your own name is yours; someone else's needs an account
  if (noRename) await backToPeople(groupId, { ok: false, error: noRename });
  await backToPeople(groupId, await renameMember(groupId, myId, memberId, String(formData.get("name") ?? "")));
}

export async function removePerson(formData: FormData) {
  const { groupId, memberId, myId, guest } = await peopleContext(formData);
  if (await isPairGroup(groupId)) redirect(`/people/${groupId}`); // a pair always keeps its two people (the lib refuses too)
  if (guest) await backToPeople(groupId, { ok: false, error: GUEST_REFUSAL }); // admin only, and a guest admin needs an account too
  if (!(await isGroupAdmin(groupId, myId))) await backToPeople(groupId, { ok: false, error: ADMIN_ONLY });
  await backToPeople(groupId, await removeOrKeepPerson(groupId, myId, memberId));
}

export async function setPersonLeft(formData: FormData) {
  const { groupId, memberId, myId, guest } = await peopleContext(formData);
  // Leaving or rejoining yourself is open to a guest; anything about someone else needs an account.
  const noOthers = renameRefusal(guest, myId, memberId);
  if (noOthers) await backToPeople(groupId, { ok: false, error: noOthers });
  // Someone with their own account is never put back by somebody else: they get an invitation and rejoin when they accept.
  // (Rejoining yourself, and bringing back a name nobody has claimed, are direct.)
  if (memberId !== myId && formData.get("left") !== "1") {
    const row = await db.member.findFirst({ where: { id: memberId, groupId }, select: { accountId: true } });
    if (row?.accountId) {
      const { origin, ip } = await originAndIp();
      if (!(await allow(`add-person:${ip}`, 60, 3600))) redirect(await flashTo(["groups", groupId, "people"], { error: "Too many adds from here. Wait a bit." }));
      const r = await addRegistered(groupId, myId, row.accountId, origin, { later: (job) => after(job) });
      redirect(await flashTo(["groups", groupId, "people"], r.ok ? {} : { error: r.error }, r.ok ? { invitedBack: "1" } : {}));
    }
  }
  // Rejoining yourself after a move-out Loopin recorded (bills, deposit, square-up payments) would leave all of that as it is: the person is
  // pointed to "Undo my move-out" first. "Rejoin without undoing" (plain=1, behind a confirmation) is the deliberate way past it.
  if (memberId === myId && formData.get("left") !== "1" && formData.get("plain") !== "1" && (await ownMoveOut(groupId, await undoViewerFor(groupId, myId), new Date()))?.check.ok) {
    await backToPeople(groupId, { ok: false, error: MOVED_OUT_REJOIN_TEXT });
  }
  // You can always leave or rejoin yourself. Taking someone else out is for whoever looks after the group; any member can bring back
  // someone who left on their own (only a person the admin removed needs the admin: setMemberLeft checks that).
  if (memberId !== myId && formData.get("left") === "1" && !(await isGroupAdmin(groupId, myId))) await backToPeople(groupId, { ok: false, error: ADMIN_ONLY });
  await backToPeople(groupId, await setMemberLeft(groupId, myId, memberId, formData.get("left") === "1"));
}

// "We settled outside the app": record every Smart Settle payment and close the group.
export async function settleEverything(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group) redirect("/");
  if (group.type === "direct") redirect(`/people/${group.id}`); // a pair is never closed (the lib refuses too)
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  await signinIfGuest(group.id, myId); // it closes the group for everyone
  if (!(await payChangeOk(myId))) redirect(await flashTo(["groups", group.id], { error: PAY_CHANGE_LIMIT_TEXT }, { tab: "balances" }));
  const r = await settleAllAndClose(group.id, myId, String(formData.get("plan") ?? ""));
  if (!r.ok) redirect(await flashTo(["groups", group.id], { error: r.error }, { tab: "balances" }));
  redirect(`/?closed=1&did=${r.eventId}&g=${group.id}`);
}

// Phone notifications: this phone's subscription is saved for every person
// it's signed in as, so changes in any of its groups reach it.
type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function pushPublicKey(): Promise<string> {
  return (await vapidKeys()).publicKey;
}

export async function savePushSubscription(sub: PushSub): Promise<{ ok: boolean; groups: number; unsupported?: boolean }> {
  if (!(await allow(`push:${(await originAndIp()).ip}`, 60, 3600))) return { ok: false, groups: 0 };
  const clean = validSub(sub);
  if (!clean) return { ok: false, groups: 0, unsupported: true };
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
  const q: Record<string, string> = { e: email.trim().toLowerCase(), back };
  if (name) q.n = name;
  if (mode) q.mode = mode;
  if (r.ok) q.sent = "1";
  redirect(await flashTo("/signin", r.ok ? {} : { error: r.error }, q));
}

// "Move them and continue" before Google: leave a signed, 2-minute note of which of this phone's guest groups the person agreed to
// move. Only groups this phone really holds as guests are kept, whatever the screen sent. (/api/auth/google/start picks it up.)
export async function confirmGuestMove(ids: string[]): Promise<{ ok: boolean }> {
  await setMoveConfirmation(await confirmedGuestIds(ids));
  return { ok: true };
}

// Cancel on that sheet: the note is thrown away at once.
export async function cancelGuestMove(): Promise<{ ok: boolean }> {
  await clearMoveConfirmation();
  return { ok: true };
}

// Already signed in, with guest groups still only on this phone ("N groups are only on this phone"): move exactly the ones
// the person confirmed (and that this phone still holds) into the account.
export async function moveGuestGroups(ids: string[]): Promise<{ ok: boolean; moved: number; skipped?: number }> {
  if (!(await getAccount())) return { ok: false, moved: 0 };
  const skipped: string[] = []; // names this account already has a row for (or was removed from): left as guest names, and said so
  const moved = await moveGuestsToAccount(await confirmedGuestIds(ids), { skipped });
  return { ok: true, moved, skipped: skipped.length };
}

export async function verifyCode(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const back = safeBack(String(formData.get("back") ?? "/"));
  const testing = (process.env.MAIL_OUTBOX === "1" && !process.env.VERCEL) || (process.env.VERCEL_ENV === "preview" && /\.test$/i.test(email.trim()));
  const { ip } = await originAndIp();
  if (!testing && (!(await allow(`verify-ip:${ip}`, 30, 900)) || !(await allow(`verify-email:${email.trim().toLowerCase()}`, 10, 900)))) {
    redirect(await flashTo("/signin", { error: "Too many tries. Wait 15 minutes and ask for a new code." }, { e: email, back, sent: "1" }));
  }
  const r = await verifyLoginCode(email, String(formData.get("code") ?? ""), new Date(), ipCountry(await headers()) ?? ""); // the country the network says (never the phone language); where they are now is saved once, on a new account only
  if (!r.ok) redirect(await flashTo("/signin", { error: r.error }, { e: email, back, sent: "1", n: String(formData.get("name") ?? "") }));
  const name = cleanNames([String(formData.get("name") ?? "")])[0];
  if (name) await db.account.updateMany({ where: { id: r.accountId, name: "" }, data: { name } });
  // Only the groups the person agreed to move (the "move" field the sign-in screen sends); no field, nothing moves.
  await signInAs(r.accountId, { confirmed: parseConfirmed(formData.get("move")) });
  redirect(`${back}${back.includes("?") ? "&" : "?"}signedin=1`);
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
  redirect(ok ? "/account/sign-in?others=out#other-phones" : "/signin");
}

export async function signOutThisPhone(formData?: FormData) {
  // This phone stops getting notifications for every name it ever held (by its address, whoever the name is now).
  const endpoint = String(formData?.get("endpoint") ?? "");
  if (endpoint.startsWith("https://") && endpoint.length < 1000) {
    // Only for a phone that really holds this address: there must be a session (signed in, or at least one name), and at
    // least one of the address's rows must belong to a name in that session or to the signed-in account. Otherwise nothing.
    const account = await getAccount();
    const mine = new Set(Object.values(await getMemberships()));
    if (account || mine.size) {
      const rows = await db.pushSubscription.findMany({ where: { endpoint }, select: { memberId: true, member: { select: { accountId: true } } } }).catch(() => []);
      const belongs = rows.some((r) => mine.has(r.memberId) || (account && r.member.accountId === account.id));
      if (belongs) await db.pushSubscription.deleteMany({ where: { endpoint } }).catch(() => undefined);
    }
  }
  await forgetThisPhone();
  if (formData?.get("offline_wipe") === "1") await markLeft(); // the phone has offline data to clear: tell it we have finished
  redirect("/");
}

export async function deleteMyAccount(formData?: FormData) {
  // This phone keeps its notifications (its address comes from the page, like "Sign out other phones"); every other phone stops.
  const keep = String(formData?.get("endpoint") ?? "");
  const keepEndpoint = keep.startsWith("https://") && keep.length < 1000 ? keep : undefined;
  const account = await getAccount();
  const groups = await getMemberships(); // before deleting: the account's names are unlinked by it
  if (account) {
    // Deleting hands every group to this phone's guest cookie. If they would not all fit, nothing is deleted (a cookie that is too big is dropped by the browser).
    const after = await guestCookieAfterDelete(groups);
    if (!after.fits) {
      redirect(await flashTo("/account/data", { error: `This phone can keep ${after.room} groups without a sign-in, and you’re in ${after.total}. Leave groups you’ve finished with, or keep your account.` }));
    }
  }
  if (account) await deleteAccount(account.id, { keepEndpoint });
  await keepGroupsDropAccount(groups); // after: the cookie carries each name's fresh epoch
  if (formData?.get("offline_wipe") === "1") await markLeft();
  redirect("/?deleted=account");
}

const safeBack = safePath;

// ---------- Delete / restore a whole group ----------

export async function deleteGroup(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group || group.deletedAt) redirect("/");
  if (group.type === "direct") redirect(`/people/${group.id}`); // no delete for a pair in this version (blocking is the safety valve)
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  await signinIfGuest(group.id, myId); // admin only, and a guest admin needs an account too
  if (!(await isGroupAdmin(group.id, myId))) redirect(`/groups/${group.id}/settings?error=admin`);
  await db.$transaction(async (tx) => {
    await tx.group.update({ where: { id: group.id }, data: { deletedAt: new Date(), deletedById: myId } });
    await logEvent(tx, { groupId: group.id, actorId: myId, kind: "group_deleted", text: "deleted the group (it can be restored for 30 days)" });
  });
  // Replaces the screen in the phone's history, so Back doesn't land on the deleted group.
  redirect("/groups?deleted=group", RedirectType.replace);
}

export async function restoreGroup(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!group || !group.deletedAt) redirect("/");
  // Pairs are never deleted by a person; a retired empty pair (on an accepted invite) must never come back as a second history.
  if (group.type === "direct") redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/");
  if (await gateGuest(myId)) redirect("/"); // admin only, and a guest admin needs an account too (a deleted group has no page for the sheet)
  // Bringing a deleted group back is for whoever deleted it or looks after it, and not for someone who left.
  if (!canRestoreGroup(group, group.members, myId)) redirect("/");
  // One conditional write limited to the 30-day window: if the daily erase got there first (or the window just closed), nothing comes back.
  const { restoreIfInWindow } = await import("@/lib/purge");
  const back = await db.$transaction(async (tx) => {
    if (!(await restoreIfInWindow(tx, group.id))) return false;
    await logEvent(tx, { groupId: group.id, actorId: myId, kind: "group_restored", text: "restored the group" });
    return true;
  });
  if (!back) redirect("/groups");
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
  if (!(await allow(`invite:${ip}`, 40, 3600))) redirect(await flashTo(["groups", group.id, "people"], { error: "Too many invites from here. Wait a bit." }));
  const { inviteToClaim } = await import("@/lib/invites");
  const r = await inviteToClaim(group.id, me.id, String(formData.get("memberId") ?? ""), String(formData.get("email") ?? ""), origin, { later: (job) => after(job) });
  redirect(await flashTo(["groups", group.id, "people"], r.ok ? { invited: r.email } : { error: r.error }));
}

// People → a name with an open invitation → Cancel invitation (the admin, or the person who sent it).
// The name goes back to being a plain name that "That's me" can take. Balances don't change.
export async function cancelInvite(formData: FormData) {
  // A pair: only a member of it, and the other name must still be a name (checked in cancelDirectInvite). Back to the person's page,
  // where the invite form is open again so a mistyped address can be fixed.
  const pairId = String(formData.get("groupId") ?? "");
  if (await isPairGroup(pairId)) {
    const myPairId = await getMyMemberId(pairId);
    if (!myPairId) redirect("/private");
    const { cancelDirectInvite } = await import("@/lib/direct-db");
    const r = await cancelDirectInvite(pairId, myPairId);
    redirect(await flashTo(["people", pairId], r.ok ? {} : { error: r.error }));
  }
  const { group, me } = await memberContext(String(formData.get("groupId") ?? ""));
  const { cancelInvitation } = await import("@/lib/invites");
  const r = await cancelInvitation(group.id, me.id, String(formData.get("memberId") ?? ""));
  redirect(await flashTo(["groups", group.id, "people"], r.ok ? {} : { error: r.error }, r.ok ? { cancelled: "1" } : {}));
}

// You → Sign-in & devices → Remove (only your own passkeys).
export async function removeMyPasskey(formData: FormData) {
  const account = await getAccount();
  if (!account) redirect("/signin?back=/account");
  const { removePasskey } = await import("@/lib/passkeys");
  await removePasskey(account.id, String(formData.get("id") ?? ""));
  redirect("/account/sign-in?removed=passkey");
}
