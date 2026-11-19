import { neutralGameText } from "@/lib/game-words";
import { bounceIfDirect } from "@/lib/direct-db";
import { setMoveIn } from "@/app/bill-actions";
import { PassportIcon, PeoplePassportsIcon } from "@/components/DrawnIcons";
import { payerIds } from "@/lib/payers";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { getAccount, getMyMemberId, privatePath } from "@/lib/identity";
import { loadGroup } from "@/lib/group-data";
import { canUndo, leaverUndoChecks, ownMoveOut } from "@/lib/undo";
import { UNDO_MOVE_OUT_EXPLAINER, UndoMoveOutButton, leaverBlockedText } from "../_components/LeftBanner";
import { formatMoney } from "@/lib/money";
import { listMoney } from "@/lib/money-display";
import { cancelInvite, invitePersonByEmail, releaseGuestNameAction, removePerson, renamePerson, setPersonLeft } from "@/app/actions";
import { pickAdmin } from "@/lib/group-admin";
import { Notice } from "@/components/Notice";
import { Avatar, ErrorNote, PageHeader, inputClass } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import Link from "@/components/Link";
import { InviteIcon, iconButtonClass } from "@/components/icons";
import { UndoBar } from "@/components/UndoBar";
import { StaysGoes } from "@/components/StaysGoes";
import { leaveText, removeText } from "@/lib/leave-text";
import { groupPeople } from "@/lib/people";
import { membersAsOf } from "@/lib/left-view";
import { niceDate } from "@/lib/format";
import { dayKey } from "@/lib/dates";
import { getTimeZone } from "@/lib/tz";
import { db } from "@/lib/db";
import { inviteMemberId, waitingNote } from "@/lib/invites";
import { invitedNotice } from "@/lib/invite-label";
import { SafetyLinks } from "@/components/SafetyLinks";
import { DateField } from "@/components/DateField";
import { readNotes } from "@/lib/flash";
import { SigninPrompt } from "@/components/SigninPrompt";

// Everyone in the group: fix a name, remove someone (the admin) or
// leave / bring back. Every change notifies the others and can be undone.
export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; did?: string; undone?: string; invited?: string; cancelled?: string; invitedBack?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const notes = await readNotes(sp, `/groups/${id}/people`);
  await bounceIfDirect(id, sp, `/groups/${id}/people`); // a pair of two people has no group screens: its person page instead (messages travel with it)
  const data = await loadGroup(id, { viewer: await getMyMemberId(id) });
  if (!data) notFound();
  const { group, net } = data;
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(await privatePath(id));

  const used = new Set<string>();
  for (const e of group.expenses) {
    for (const id of payerIds(e)) used.add(id);
    if (e.createdById) used.add(e.createdById);
    for (const s of e.shares) used.add(s.memberId);
  }
  for (const p of group.payments) used.add(p.fromId).add(p.toId);

  const money = (m: number) => formatMoney(Math.abs(m), group.currency);
  // The balance lines: if any has paise, every line keeps its two decimals so they line up.
  const listFmt = listMoney(group.members.map((m) => Math.abs(net[m.id] ?? 0)), group.currency);
  // Taken out by whoever looks after the group ("removed"): kept in the history, can't rejoin on their own.
  // Everyone is listed once (a removed person only under Removed).
  // Someone who left sees the people as they were on the day they left, and no one else's balance.
  const leaver = data.leaver;
  const { active, left, removed } = groupPeople(leaver ? membersAsOf(group.members, myId, leaver.leftAt) : group.members);
  // Removing people or marking them as left is for the person who looks after the group.
  const admin = pickAdmin(group.members);
  const isAdmin = admin?.id === myId;
  // Names with an invitation still waiting. Who it went to is shown to whoever may cancel it (the admin, or a person who sent one);
  // the Invite box on such a name is for the admin or the person who sent it, so nobody else can re-point it to their own address.
  const waiting = new Map<string, { note: string; mayCancel: boolean; mayInvite: boolean }>();
  const openFor = new Map<string, { email: string; invitedById: string; fromAccount: boolean }[]>();
  for (const i of await db.invite.findMany({ where: { groupId: group.id, acceptedAt: null, declinedAt: null }, orderBy: { createdAt: "desc" } })) {
    const row = inviteMemberId(i);
    if (row) openFor.set(row, [...(openFor.get(row) ?? []), { email: i.email, invitedById: i.invitedById, fromAccount: i.fromAccount }]);
  }
  for (const [row, list] of openFor) {
    const by = group.members.find((m) => m.id === list[0].invitedById)?.name ?? "someone";
    const mayCancel = isAdmin || list.some((i) => i.invitedById === myId);
    // (The words, and whether an email may be shown at all, come from waitingNote: an invitation picked from someone's account never shows it.)
    const mayInvite = isAdmin || list.every((i) => i.invitedById === myId);
    waiting.set(row, { mayCancel, mayInvite, note: waitingNote({ invites: list, by, mayCancel, mayInvite }) });
  }
  // Report / Block on someone who is on Loopin (needs your own account).
  const viewer = await getAccount();
  const justDid = sp.did ? group.events.find((x) => x.id === sp.did) : undefined;
  // Who is looking, as canUndo wants them (the full member list). Someone who moved out themselves may undo it from here.
  const undoViewer = { id: myId, isAdmin, closed: group.closed, members: group.members };
  const ownMove = leaver && !leaver.removed ? await ownMoveOut(group.id, undoViewer, new Date()) : null;
  const leaverChecks = leaver && !leaver.removed ? await leaverUndoChecks(group.id, undoViewer, new Date()) : null;
  const tz = await getTimeZone();
  const nameOf = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const small = "rounded-full border border-line px-4 py-2 text-sm font-medium text-fg active:bg-mist disabled:opacity-40";

  const Person = ({ m }: { m: (typeof group.members)[number] }) => {
    const me = m.id === myId;
    const bal = net[m.id] ?? 0;
    const hidden = (
      <>
        <input type="hidden" name="groupId" value={group.id} />
        <input type="hidden" name="memberId" value={m.id} />
      </>
    );
    // Someone who left (or was removed) reads the names and amounts, but changes nothing: every button here is refused for them.
    // Their own row stays open, with only their way back (Rejoin, Undo move-out, or the "removed you" note).
    if (leaver && !me) {
      return (
        <li className="border-b border-line" data-readonly-person>
          <div className="flex items-center gap-3 py-3">
            <Avatar name={m.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{m.name}</span>
              {/* Other people's amounts are never shown to someone who left (their balance view holds only their own), so only the state is. */}
              {(m.removedAt || m.leftAt) && <span className="block text-xs text-gray-400">{m.removedAt ? "Removed from the group" : "Left the group"}</span>}
            </span>
          </div>
          {/* Report / Block works for every leaver (blockAction allows it). The passport link is for someone who left on their own, and
              only for people who were in the group by the day they left (this list is already cut to that day). */}
          {((!leaver.removed && m.accountId) || (viewer && m.accountId && m.accountId !== viewer.id)) && (
            <div className="space-y-4 pb-4 pl-12">
              {!leaver.removed && m.accountId && !m.removedAt && (
                <Link href={`/groups/${group.id}/passport/${m.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold active:bg-mist" data-leaver-passport>
                  <PassportIcon size={14} /> {m.name.trim().split(/\s+/)[0]}’s passport
                </Link>
              )}
              {viewer && m.accountId && m.accountId !== viewer.id && (
                <SafetyLinks kind="person" targetId={m.accountId} accountId={m.accountId} name={m.name} back={`/groups/${group.id}/people`} className="!justify-start -ml-2" />
              )}
            </div>
          )}
        </li>
      );
    }
    const mine = leaver && me;
    const ownStatus = leaver
      ? `${leaver.removed ? "Removed" : ownMove ? "Moved out" : "Left"} on ${niceDate(dayKey(leaver.leftAt, tz))} · ${bal > 0 ? `gets ${listFmt(bal)}` : bal < 0 ? `owes ${listFmt(-bal)}` : "all square"}`
      : "";
    const head = (
      <>
        <Avatar name={m.name} you={me} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {m.name}
            {me && <span className="text-gray-400"> (you)</span>}
            {!me && !m.accountId && !m.claimedAt && !m.leftAt && (
              <span className="ml-2 rounded-full border border-line px-2 py-0.5 align-middle text-[10px] font-normal text-gray-500">not on Loopin yet</span>
            )}
            {!m.accountId && m.claimedAt && !m.leftAt && !m.removedAt && (
              <span className="ml-2 rounded-full border border-line px-2 py-0.5 align-middle text-[10px] font-normal text-gray-500" data-no-account>no account yet</span>
            )}
          </span>
          <span className="block text-xs text-gray-400">
            {mine ? ownStatus : m.removedAt ? "Removed from the group" : m.leftAt ? "Left the group" : bal > 0 ? (
              <>
                gets <span className="text-owed">{listFmt(bal)}</span>
              </>
            ) : bal < 0 ? (
              <>
                owes <span className="text-owe">{listFmt(-bal)}</span>
              </>
            ) : "settled up"}
          </span>
        </span>
      </>
    );
    const Shell = ({ children }: { children: ReactNode }) =>
      mine ? (
        <li className="border-b border-line" data-own-row>
          <div className="flex items-center gap-3 py-3">{head}</div>
          {children}
        </li>
      ) : (
        <li className="border-b border-line">
          <details className="group/p">
            <summary className="flex cursor-pointer list-none items-center gap-3 py-3">
              {head}
              <span className="text-sm text-gray-400 group-open/p:hidden">Edit</span>
              <span className="hidden text-sm text-gray-400 group-open/p:inline">Close</span>
            </summary>
            {children}
          </details>
        </li>
      );
    return (
      <Shell>
          <div className="space-y-4 pb-5 pl-12">
            {m.accountId && !me && (
              <Link href={`/groups/${group.id}/passport/${m.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold active:bg-mist">
                <PassportIcon size={14} /> {m.name.trim().split(/\s+/)[0]}’s passport
              </Link>
            )}
            {viewer && m.accountId && !me && m.accountId !== viewer.id && (
              <SafetyLinks kind="person" targetId={m.accountId} accountId={m.accountId} name={m.name} back={`/groups/${group.id}/people`} className="!justify-start -ml-2" />
            )}
            {/* A name held with no account (someone joined from the link): the admin with an account, or the person on their own name, can free it. */}
            {!leaver && !m.accountId && m.claimedAt && !m.leftAt && !m.removedAt && (me || (isAdmin && viewer)) && (
              <form action={releaseGuestNameAction} data-free-name>
                {hidden}
                <button type="submit" className={small}>
                  {me ? "Not me" : "Free this name"}
                </button>
                <p className="mt-2 text-xs text-gray-400">{me ? `This phone stops being ${m.name}.` : `Whoever holds ${m.name} stops being them.`} The name goes back on the list at the invite link. Nothing is spent or changed.</p>
              </form>
            )}
            {!leaver && !m.accountId && !m.claimedAt && !m.leftAt && waiting.has(m.id) && (
              <div className="space-y-2" data-invited-row>
                <p className="text-sm text-gray-500">
                  {waiting.get(m.id)!.note}
                </p>
                {waiting.get(m.id)!.mayCancel && (
                  <form action={cancelInvite}>
                    {hidden}
                    <button type="submit" className={small}>
                      Cancel invitation
                    </button>
                  </form>
                )}
              </div>
            )}
            {!leaver && !m.accountId && !m.claimedAt && !m.leftAt && (!waiting.has(m.id) || waiting.get(m.id)!.mayInvite) && (
              <form action={invitePersonByEmail} className="space-y-2">
                <input type="hidden" name="groupId" value={group.id} />
                <input type="hidden" name="memberId" value={m.id} />
                <p className="text-sm text-gray-500">{m.name} was added by name. Invite them by email: they join as {m.name}, with their expenses and balance.</p>
                <div className="flex gap-2">
                  <input name="email" type="email" required inputMode="email" placeholder="their@email.com" aria-label={`${m.name}’s email`} className={`${inputClass} py-2`} />
                  <button type="submit" className={`${small} shrink-0`}>
                    Invite
                  </button>
                </div>
              </form>
            )}
            {/* Only the person moving out, or the admin, can confirm a move-out, so nobody else is offered the link. */}
            {group.type === "home" && !m.leftAt && !leaver && (me || isAdmin) && (
              <Link href={`/groups/${group.id}/people/${m.id}/move`} className={`${small} inline-block`}>
                {me ? "I’m moving out" : `${m.name} is moving out`}
              </Link>
            )}
            {group.type === "home" && !m.leftAt && !leaver && (
              <form action={setMoveIn} className="flex items-center gap-2 text-sm">
                {hidden}
                <label className="text-gray-500" htmlFor={`in-${m.id}`}>
                  Moved in on
                </label>
                <DateField id={`in-${m.id}`} name="day" defaultValue={m.joinedFrom ? m.joinedFrom.toISOString().slice(0, 10) : ""} size="sm" inline clearable={false} />
                <button type="submit" className={`${small} shrink-0`}>
                  Save
                </button>
              </form>
            )}
            {!leaver && (
            <form action={renamePerson} className="flex gap-2">
              {hidden}
              <input name="name" defaultValue={m.name} aria-label={`New name for ${m.name}`} maxLength={40} required className={`${inputClass} py-2`} />
              <button type="submit" className={`${small} shrink-0`}>
                Rename
              </button>
            </form>
            )}

            {m.removedAt ? (
              isAdmin && !me ? (
                <form action={setPersonLeft}>
                  {hidden}
                  <input type="hidden" name="left" value="0" />
                  <button type="submit" className={small}>
                    {m.accountId ? `Invite ${m.name} back` : `Bring ${m.name} back`}
                  </button>
                  <p className="mt-2 text-xs text-gray-400">{m.name} can’t rejoin on their own or with the old link.{m.accountId ? " They rejoin when they accept your invitation." : ""}</p>
                </form>
              ) : (
                <p className="text-xs text-gray-400" data-removed-note>
                  {me ? `${group.members.find((x) => x.id === m.removedById)?.name ?? admin?.name ?? "The person who looks after the group"} removed you from this group. Ask them to invite you again.` : `Only ${admin?.name ?? "the person who looks after the group"} can bring ${m.name} back.`}
                </p>
              )
            ) : m.leftAt ? (
              <div className="space-y-4">
                {me && ownMove ? (
                  <div data-own-move-out>
                    {ownMove.check.ok ? (
                      <>
                        <p className="text-sm text-gray-500">{UNDO_MOVE_OUT_EXPLAINER}</p>
                        <UndoMoveOutButton groupId={group.id} eventId={ownMove.event.id} back="people" />
                      </>
                    ) : (
                      <p className="text-sm text-gray-500" data-own-move-out-blocked>
                        {leaverBlockedText(ownMove.check)}
                      </p>
                    )}
                    {/* Rejoining without undoing keeps the deposit, bills and payments as the move-out left them, so it asks first. */}
                    <form action={setPersonLeft} className="mt-4">
                      {hidden}
                      <input type="hidden" name="left" value="0" />
                      <input type="hidden" name="plain" value="1" />
                      <ConfirmButton
                        message="Rejoin without undoing your move-out? Your deposit, bills and square-up payments stay as the move-out left them, and the move-out can’t be undone after this."
                        className="rounded-full px-1 py-2 text-xs font-medium text-gray-500 underline underline-offset-4"
                      >
                        Rejoin without undoing
                      </ConfirmButton>
                    </form>
                  </div>
                ) : (
                  <form action={setPersonLeft}>
                    {hidden}
                    <input type="hidden" name="left" value="0" />
                    <button type="submit" className={small}>
                      {me ? "Rejoin the group" : m.accountId ? `Invite ${m.name} back` : `Bring ${m.name} back`}
                    </button>
                  </form>
                )}
                {/* Someone who left on their own can still be taken out by whoever looks after the group (then they can't rejoin by themselves). */}
                {isAdmin && !me && (
                  <form action={removePerson} data-remove-left>
                    {hidden}
                    <StaysGoes text={removeText(m.name)} />
                    <ConfirmButton message={`Remove ${m.name} from ${group.name}? They won’t be able to rejoin on their own.`} className={small}>
                      Remove {m.name}
                    </ConfirmButton>
                  </form>
                )}
              </div>
            ) : !me && !isAdmin ? (
              <p className="text-xs text-gray-400" data-admin-only="people">
                Only {admin?.name ?? "the person who started the group"}, who looks after this group, can remove people.
              </p>
            ) : !me ? (
              <form action={removePerson}>
                {hidden}
                <StaysGoes text={removeText(m.name)} />
                {bal !== 0 ? (
                  <button type="submit" disabled className={small}>
                    Remove {m.name}
                  </button>
                ) : (
                  <ConfirmButton message={`Remove ${m.name} from ${group.name}? They won’t be able to rejoin on their own.`} className={small}>
                    Remove {m.name}
                  </ConfirmButton>
                )}
                <p className="mt-2 text-xs text-gray-400" title={bal !== 0 ? money(bal) : undefined} data-exact={bal !== 0 ? money(bal) : undefined}>
                  {bal !== 0 ? `To remove ${m.name}, settle up first.` : used.has(m.id) || m.accountId ? "They stay in the history. You can bring them back later." : "Not in any expense yet, so they’re removed completely."}
                </p>
              </form>
            ) : (
              <form action={setPersonLeft}>
                {hidden}
                <input type="hidden" name="left" value="1" />
                <StaysGoes text={leaveText()} />
                <button type="submit" disabled={bal !== 0} className={small}>
                  Leave group
                </button>
                {bal !== 0 && <p className="mt-2 text-xs text-gray-400">To leave, settle up first.</p>}
              </form>
            )}
          </div>
      </Shell>
    );
  };

  return (
    <>
      <PageHeader title="People" back={`/groups/${group.id}?tab=balances`} />
      {notes.error && !notes.signin && <ErrorNote>{notes.error}</ErrorNote>}
      <SigninPrompt notes={notes} back={`/groups/${group.id}/people`} />
      {sp.cancelled && (
        <Notice tone="success" params={["cancelled"]} className="mb-4">
          Invitation cancelled. The name stays in the group, and can be claimed with “That’s me” or invited again.
        </Notice>
      )}
      {sp.invitedBack && (
        <Notice tone="success" params={["invitedBack"]} className="mb-4">
          <span className="block font-semibold">Invited back</span>
          <span className="block text-sm" data-invited-back>They’ll rejoin when they accept. Nothing about the money changes.</span>
        </Notice>
      )}
      {notes.invited && (
        <Notice tone="success" params={["invited"]} className="mb-4">
          {invitedNotice(notes.invited.slice(0, 80))} When they join, they take over their name with its expenses.
        </Notice>
      )}

      {/* Passports stay for someone who left on their own (the passport rules allow it); only a removed person is turned away. */}
      {!leaver?.removed && (
      <Link href={`/groups/${group.id}/passports`} className="mb-4 flex items-center gap-3 rounded-2xl border border-line px-4 py-3 active:bg-mist" data-our-passports>
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-fg/25 text-fg/75"><PeoplePassportsIcon size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Our passports</span>
          <span className="block text-xs text-gray-500">Where everyone in this group has been</span>
        </span>
        <span aria-hidden className="text-gray-400">›</span>
      </Link>
      )}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {active.length} {active.length === 1 ? "person" : "people"} in {group.name}
        </p>
        {!leaver && (
          <Link href={`/groups/${group.id}/invite`} aria-label="Add people" className={iconButtonClass}>
            <InviteIcon size={20} />
          </Link>
        )}
      </div>
      <ul className="border-t border-line">
        {active.map((m) => (
          <Person key={m.id} m={m} />
        ))}
      </ul>

      {left.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 text-sm font-medium text-gray-500">Left the group</h2>
          <ul className="border-t border-line opacity-80">
            {left.map((m) => (
              <Person key={m.id} m={m} />
            ))}
          </ul>
        </section>
      )}

      {removed.length > 0 && (
        <section className="mt-10" data-removed-section>
          <h2 className="mb-2 text-sm font-medium text-gray-500">Removed</h2>
          <ul className="border-t border-line opacity-80">
            {removed.map((m) => (
              <Person key={m.id} m={m} />
            ))}
          </ul>
        </section>
      )}

      {justDid && (leaverChecks?.get(justDid.id) ?? canUndo(justDid, group.events, new Date(), undoViewer)).ok && (
        <UndoBar
          key={justDid.id}
          text={sp.undone ? "Undone." : `${nameOf(justDid.actorId)} ${neutralGameText(justDid.text)}`}
          groupId={group.id}
          eventId={justDid.id}
          back="people"
          redo={sp.undone === "1"}
        />
      )}
    </>
  );
}
