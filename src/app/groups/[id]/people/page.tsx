import { neutralGameText } from "@/lib/game-words";
import { setMoveIn } from "@/app/bill-actions";
import { PassportIcon, PeoplePassportsIcon } from "@/components/DrawnIcons";
import { payerIds } from "@/lib/payers";
import { notFound, redirect } from "next/navigation";
import { getAccount, getMyMemberId, privatePath } from "@/lib/identity";
import { loadGroup } from "@/lib/group-data";
import { canUndo } from "@/lib/undo";
import { formatMoney } from "@/lib/money";
import { cancelInvite, invitePersonByEmail, removePerson, renamePerson, setPersonLeft } from "@/app/actions";
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
import { db } from "@/lib/db";
import { inviteMemberId } from "@/lib/invites";
import { invitedNotice } from "@/lib/invite-label";
import { SafetyLinks } from "@/components/SafetyLinks";
import { DateField } from "@/components/DateField";

// Everyone in the group: fix a name, remove someone (the admin) or
// leave / bring back. Every change notifies the others and can be undone.
export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; did?: string; undone?: string; invited?: string; cancelled?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
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
  const waiting = new Map<string, { email: string; by: string; mayCancel: boolean; mayInvite: boolean }>();
  const openFor = new Map<string, { email: string; invitedById: string }[]>();
  for (const i of await db.invite.findMany({ where: { groupId: group.id, acceptedAt: null, declinedAt: null }, orderBy: { createdAt: "desc" } })) {
    const row = inviteMemberId(i);
    if (row) openFor.set(row, [...(openFor.get(row) ?? []), { email: i.email, invitedById: i.invitedById }]);
  }
  for (const [row, list] of openFor) {
    const by = group.members.find((m) => m.id === list[0].invitedById)?.name ?? "someone";
    waiting.set(row, { email: list[0].email, by, mayCancel: isAdmin || list.some((i) => i.invitedById === myId), mayInvite: isAdmin || list.every((i) => i.invitedById === myId) });
  }
  // Report / Block on someone who is on Loopin (needs your own account).
  const viewer = await getAccount();
  const justDid = sp.did ? group.events.find((x) => x.id === sp.did) : undefined;
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
    return (
      <li className="border-b border-line">
        <details className="group/p">
          <summary className="flex cursor-pointer list-none items-center gap-3 py-3">
            <Avatar name={m.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {m.name}
                {me && <span className="text-gray-400"> (you)</span>}
                {!me && !m.accountId && !m.claimedAt && !m.leftAt && (
                  <span className="ml-2 rounded-full border border-line px-2 py-0.5 align-middle text-[10px] font-normal text-gray-500">not on Loopin yet</span>
                )}
              </span>
              <span className="block text-xs text-gray-400">
                {m.removedAt ? "Removed from the group" : m.leftAt ? "Left the group" : leaver && !me ? "—" : bal > 0 ? `gets ${money(bal)}` : bal < 0 ? `owes ${money(bal)}` : "settled up"}
              </span>
            </span>
            <span className="text-sm text-gray-400 group-open/p:hidden">Edit</span>
            <span className="hidden text-sm text-gray-400 group-open/p:inline">Close</span>
          </summary>

          <div className="space-y-4 pb-5 pl-12">
            {m.accountId && !me && (
              <Link href={`/groups/${group.id}/passport/${m.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold active:bg-mist">
                <PassportIcon size={14} /> {m.name.trim().split(/\s+/)[0]}’s passport
              </Link>
            )}
            {viewer && m.accountId && !me && m.accountId !== viewer.id && (
              <SafetyLinks kind="person" targetId={m.accountId} accountId={m.accountId} name={m.name} back={`/groups/${group.id}/people`} className="!justify-start -ml-2" />
            )}
            {!m.accountId && !m.claimedAt && !m.leftAt && waiting.has(m.id) && (
              <div className="space-y-2" data-invited-row>
                <p className="text-sm text-gray-500">
                  {waiting.get(m.id)!.mayCancel
                    ? `Invited at ${waiting.get(m.id)!.email}. Wrong address, or they sign in with another one? Cancel the invitation${waiting.get(m.id)!.mayInvite ? ", or invite a different email below" : ""}.`
                    : `Invited by ${waiting.get(m.id)!.by}. They can change it if the address is wrong.`}
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
            {!m.accountId && !m.claimedAt && !m.leftAt && (!waiting.has(m.id) || waiting.get(m.id)!.mayInvite) && (
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
            {group.type === "home" && !m.leftAt && (
              <Link href={`/groups/${group.id}/people/${m.id}/move`} className={`${small} inline-block`}>
                {me ? "I’m moving out" : `${m.name} is moving out`}
              </Link>
            )}
            {group.type === "home" && !m.leftAt && (
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
            <form action={renamePerson} className="flex gap-2">
              {hidden}
              <input name="name" defaultValue={m.name} aria-label={`New name for ${m.name}`} maxLength={40} required className={`${inputClass} py-2`} />
              <button type="submit" className={`${small} shrink-0`}>
                Rename
              </button>
            </form>

            {m.removedAt ? (
              isAdmin && !me ? (
                <form action={setPersonLeft}>
                  {hidden}
                  <input type="hidden" name="left" value="0" />
                  <button type="submit" className={small}>
                    Bring {m.name} back
                  </button>
                  <p className="mt-2 text-xs text-gray-400">{m.name} can’t rejoin on their own or with the old link.</p>
                </form>
              ) : (
                <p className="text-xs text-gray-400" data-removed-note>
                  {me ? `${group.members.find((x) => x.id === m.removedById)?.name ?? admin?.name ?? "The person who looks after the group"} removed you from this group. Ask them to invite you again.` : `Only ${admin?.name ?? "the person who looks after the group"} can bring ${m.name} back.`}
                </p>
              )
            ) : m.leftAt ? (
              <div className="space-y-4">
                <form action={setPersonLeft}>
                  {hidden}
                  <input type="hidden" name="left" value="0" />
                  <button type="submit" className={small}>
                    {me ? "Rejoin the group" : `Bring ${m.name} back`}
                  </button>
                </form>
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
                    Settle up first
                  </button>
                ) : (
                  <ConfirmButton message={`Remove ${m.name} from ${group.name}? They won’t be able to rejoin on their own.`} className={small}>
                    Remove {m.name}
                  </ConfirmButton>
                )}
                <p className="mt-2 text-xs text-gray-400" title={bal !== 0 ? money(bal) : undefined} data-exact={bal !== 0 ? money(bal) : undefined}>
                  {bal !== 0 ? `${m.name} must be settled up first (${bal > 0 ? "gets" : "owes"} ${money(Math.abs(bal))}).` : used.has(m.id) || m.accountId ? "They stay in the history. You can bring them back later." : "Not in any expense yet, so they’re removed completely."}
                </p>
              </form>
            ) : (
              <form action={setPersonLeft}>
                {hidden}
                <input type="hidden" name="left" value="1" />
                <StaysGoes text={leaveText()} />
                <button type="submit" disabled={bal !== 0} className={small}>
                  {bal !== 0 ? "Settle up first" : "Leave group"}
                </button>
                {bal !== 0 && <p className="mt-2 text-xs text-gray-400">You must be settled up first ({bal > 0 ? "get" : "owe"} {money(bal)}).</p>}
              </form>
            )}
          </div>
        </details>
      </li>
    );
  };

  return (
    <>
      <PageHeader title="People" back={`/groups/${group.id}/settings`} />
      {sp.error && <ErrorNote>{sp.error}</ErrorNote>}
      {sp.cancelled && (
        <Notice tone="success" params={["cancelled"]} className="mb-4">
          Invitation cancelled. The name stays in the group, and can be claimed with “That’s me” or invited again.
        </Notice>
      )}
      {sp.invited && (
        <Notice tone="success" params={["invited"]} className="mb-4">
          {invitedNotice(sp.invited.slice(0, 80))} When they join, they take over their name with its expenses.
        </Notice>
      )}

      <Link href={`/groups/${group.id}/passports`} className="mb-4 flex items-center gap-3 rounded-2xl border border-line px-4 py-3 active:bg-mist" data-our-passports>
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-fg/25 text-fg/75"><PeoplePassportsIcon size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Our passports</span>
          <span className="block text-xs text-gray-500">Where everyone in {group.name} has been</span>
        </span>
        <span aria-hidden className="text-gray-400">›</span>
      </Link>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {active.length} {active.length === 1 ? "person" : "people"} in {group.name}
        </p>
        <Link href={`/groups/${group.id}/invite`} aria-label="Add people" className={iconButtonClass}>
          <InviteIcon size={20} />
        </Link>
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

      {justDid && canUndo(justDid, group.events).ok && (
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
