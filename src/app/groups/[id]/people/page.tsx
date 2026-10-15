import { notFound, redirect } from "next/navigation";
import { getMyMemberId } from "@/lib/identity";
import { loadGroup } from "@/lib/group-data";
import { canUndo } from "@/lib/undo";
import { formatMoney } from "@/lib/money";
import { removePerson, renamePerson, setPersonLeft } from "@/app/actions";
import { Avatar, ErrorNote, PageHeader, inputClass } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import Link from "next/link";
import { InviteIcon, iconButtonClass } from "@/components/icons";
import { UndoBar } from "@/components/UndoBar";

// Everyone in the group: fix a name, remove someone added by mistake, or
// leave / bring back. Every change notifies the others and can be undone.
export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; did?: string; undone?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const data = await loadGroup(id);
  if (!data) notFound();
  const { group, net } = data;
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(`/join/${group.inviteCode}`);

  const used = new Set<string>();
  for (const e of group.expenses) {
    used.add(e.paidById);
    if (e.createdById) used.add(e.createdById);
    for (const s of e.shares) used.add(s.memberId);
  }
  for (const p of group.payments) used.add(p.fromId).add(p.toId);

  const money = (m: number) => formatMoney(Math.abs(m), group.currency);
  const active = group.members.filter((m) => !m.leftAt);
  const left = group.members.filter((m) => m.leftAt);
  const justDid = sp.did ? group.events.find((x) => x.id === sp.did) : undefined;
  const nameOf = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const small = "border border-line px-3 py-2 text-sm font-medium text-fg active:bg-mist disabled:opacity-40";

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
              </span>
              <span className="block text-xs text-gray-400">
                {m.leftAt ? "Left the group" : bal > 0 ? `gets ${money(bal)}` : bal < 0 ? `owes ${money(bal)}` : "settled up"}
              </span>
            </span>
            <span className="text-sm text-gray-400 group-open/p:hidden">Edit</span>
            <span className="hidden text-sm text-gray-400 group-open/p:inline">Close</span>
          </summary>

          <div className="space-y-4 pb-5 pl-12">
            <form action={renamePerson} className="flex gap-2">
              {hidden}
              <input name="name" defaultValue={m.name} aria-label={`New name for ${m.name}`} maxLength={40} required className={`${inputClass} py-2`} />
              <button type="submit" className={`${small} shrink-0`}>
                Rename
              </button>
            </form>

            {m.leftAt ? (
              <form action={setPersonLeft}>
                {hidden}
                <input type="hidden" name="left" value="0" />
                <button type="submit" className={small}>
                  {me ? "Rejoin the group" : `Bring ${m.name} back`}
                </button>
              </form>
            ) : !used.has(m.id) && !me ? (
              <form action={removePerson}>
                {hidden}
                <ConfirmButton message={`Remove ${m.name} from ${group.name}?`} className={small}>
                  Remove from group
                </ConfirmButton>
                <p className="mt-2 text-xs text-gray-400">Not in any expense yet, so they can be removed completely.</p>
              </form>
            ) : (
              <form action={setPersonLeft}>
                {hidden}
                <input type="hidden" name="left" value="1" />
                <button type="submit" disabled={bal !== 0} className={small}>
                  {me ? "Leave group" : `Mark ${m.name} as left`}
                </button>
                <p className="mt-2 text-xs text-gray-400">
                  {bal !== 0
                    ? `${me ? "You" : m.name} must be settled up first (${bal > 0 ? "gets" : "owes"} ${money(bal)}).`
                    : "They stay in the history, but won’t be offered for new expenses. You can bring them back any time."}
                </p>
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

      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {active.length} {active.length === 1 ? "person" : "people"} in {group.name}
        </p>
        <Link href={`/groups/${group.id}/invite`} aria-label="Invite people" className={iconButtonClass}>
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

      {justDid && canUndo(justDid, group.events).ok && (
        <UndoBar
          key={justDid.id}
          text={sp.undone ? "Undone." : `${nameOf(justDid.actorId)} ${justDid.text}`}
          groupId={group.id}
          eventId={justDid.id}
          back="people"
          redo={sp.undone === "1"}
        />
      )}
    </>
  );
}
