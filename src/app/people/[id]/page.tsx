import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAccount, getMemberships, privatePath } from "@/lib/identity";
import { invitationFor } from "@/lib/invitations";
import { loadGroupView } from "@/lib/group-data";
import { buildGroupView } from "@/app/groups/[id]/_components/view";
import { ActivityTab } from "@/app/groups/[id]/_components/ActivityTab";
import { getTimeZone } from "@/lib/tz";
import { canUndo } from "@/lib/undo";
import { neutralGameText } from "@/lib/game-words";
import { formatMoney, toInputAmount } from "@/lib/money";
import { balanceLine } from "@/lib/direct";
import { cancelInvite, renamePerson, settleAcrossGroups } from "@/app/actions";
import { openInviteEmail } from "@/lib/direct-db";
import { inviteDirect } from "@/app/direct-actions";
import { differentAmountFor } from "@/components/SettleRow";
import { FreshKey } from "@/components/FreshKey";
import { InvitationCard } from "@/components/InvitationCard";
import { Initial, SettleCard, type MenuItem } from "@/components/SettleUp";
import { Notice } from "@/components/Notice";
import { UndoBar } from "@/components/UndoBar";
import { BackIcon, iconButtonClass } from "@/components/icons";
import { inputClass, primaryButtonClass } from "@/components/ui";
import { BIG_OUTLINE } from "@/lib/settle-ui";
import { STALE_KEY_ERROR } from "@/lib/once";
import { readNotes } from "@/lib/flash";

// A person you share expenses with directly (no group): who owes whom, a way to settle, and the history between the two of you.
// Only the two of you can open it (a name nobody else has joined is visible to its owner alone). It never mentions any group.
const SHEET_NOTE = "This records a payment made outside Loopin. No money will be transferred.";

type SP = { settle?: string; paid?: string; ok?: string; notgot?: string; invited?: string; inviteError?: string; email?: string; error?: string; did?: string; undone?: string; open?: string; n?: string; tab?: string };

export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const notes = await readNotes(sp, `/people/${id}`);
  const g = await db.group.findUnique({ where: { id }, select: { id: true, type: true, deletedAt: true } });
  if (!g || g.deletedAt) notFound();
  if (g.type !== "direct") redirect(`/groups/${id}`);

  const memberships = await getMemberships();
  const myId = memberships[id];
  if (!myId) {
    // Not in it. Someone who shared expenses with you sees the invitation (Join / Not now); everyone else is turned away as for any private page.
    const invitation = await invitationFor(await getAccount(), id);
    if (invitation) {
      return (
        <div className="pt-2" data-person-invitation>
          <InvitationCard inv={invitation} />
        </div>
      );
    }
    redirect(await privatePath(id));
  }

  const tz = await getTimeZone();
  const data = await loadGroupView(id, { viewer: myId });
  if (!data) notFound();
  const v = await buildGroupView(data, myId, tz);
  const { group } = v;
  const other = group.members.find((m) => m.id !== myId);
  if (!other) notFound();
  const name = other.name;
  const shared = Boolean(other.accountId);
  const currency = group.currency;
  const net = data.net[myId] ?? 0;
  const owed = net > 0;
  const owe = net < 0;
  const hasHistory = group.expenses.length > 0 || group.payments.length > 0;

  const [reactions, receipts, openInvite] = await Promise.all([
    group.expenses.length ? db.reaction.findMany({ where: { expenseId: { in: group.expenses.map((e) => e.id) } }, select: { expenseId: true, memberId: true, emoji: true } }) : Promise.resolve([]),
    group.expenses.length ? db.receipt.findMany({ where: { groupId: group.id, expenseId: { not: "" } }, select: { id: true, expenseId: true } }) : Promise.resolve([]),
    shared ? Promise.resolve(null) : openInviteEmail(group.id, other.id),
  ]);

  // Right after a change: Undo (or Redo after an undo), judged on the same history the group screens use.
  const justDid = sp.did ? group.events.find((x) => x.id === sp.did) : undefined;
  const showUndo = Boolean(justDid) && canUndo(justDid!, group.events, new Date(), v.undoViewer).ok;

  // The settle card: the same card Settle uses, with one part (this pair only), coming back here afterwards.
  const amount = formatMoney(Math.abs(net), currency);
  const from = owe ? myId : other.id;
  const to = owe ? other.id : myId;
  const part = { groupId: group.id, fromId: from, toId: to, amount: Math.abs(net) };
  const partHref = differentAmountFor(group.id, from, to, toInputAmount(Math.abs(net), currency), false);
  const first = name.trim().split(/\s+/)[0] || name;
  const menu: MenuItem[] = owed
    ? [
        { key: "received", label: "Mark received", opensSheet: true, attrs: { "data-mark-received": "" } },
        { key: "part", label: "Received a different amount", href: partHref, attrs: { "data-different-amount": "" } },
      ]
    : [{ key: "part", label: "Pay part", href: partHref, attrs: { "data-different-amount": "" } }];

  const addButton = (
    <Link href={`/groups/${group.id}/add`} className={`${primaryButtonClass} mt-4`} data-person-add>
      Add expense
    </Link>
  );

  return (
    <>
      <header className="mb-5 flex items-center gap-3">
        <Link href="/settle" aria-label="Back" className={iconButtonClass}>
          <BackIcon size={20} />
        </Link>
        <Initial name={name} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[26px] font-semibold leading-tight tracking-[-0.02em]" data-person-name>
            {name}
          </h1>
          <p className="text-[14px] leading-snug text-fg/65" data-person-badge>
            {shared ? `Shared with ${name}` : "Only you can see this"}
          </p>
        </div>
        <details className="relative shrink-0" data-person-menu>
          <summary aria-label={`More for ${name}`} className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full text-fg/80 active:bg-mist [&::-webkit-details-marker]:hidden">
            <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5.5" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="12" cy="18.5" r="1.6" />
            </svg>
          </summary>
          <div className="absolute right-0 top-11 z-30 w-64 max-w-[calc(100vw-3rem)] rounded-2xl border border-line bg-mist p-2 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]">
            {!shared && (
              <form action={renamePerson} className="space-y-2 p-2">
                <input type="hidden" name="groupId" value={group.id} />
                <input type="hidden" name="memberId" value={other.id} />
                <label className="block text-[13px] font-semibold text-fg/65" htmlFor="person-rename">
                  Rename
                </label>
                <input id="person-rename" name="name" defaultValue={name} maxLength={40} required className={inputClass} />
                <button type="submit" className="min-h-11 w-full rounded-full border border-fg/25 text-[15px] font-semibold active:bg-fg/10">
                  Save name
                </button>
              </form>
            )}
            <a href={`/groups/${group.id}/export`} className="flex min-h-11 items-center px-3 text-[15px] active:bg-fg/10" data-person-export>
              Export
            </a>
          </div>
        </details>
      </header>

      {sp.settle === "done" && <Notice params={["settle"]} className="mb-3">Recorded.</Notice>}
      {sp.settle === "changed" && <Notice params={["settle"]} className="mb-3">The balance just changed. Here’s the latest.</Notice>}
      {sp.settle === "stale" && <Notice tone="error" params={["settle"]} className="mb-3">{STALE_KEY_ERROR}</Notice>}
      {sp.settle === "error" && <Notice tone="error" params={["settle"]} className="mb-3">Couldn’t record that. Try again.</Notice>}
      {sp.paid === "1" && !sp.undone && <Notice params={["paid"]} className="mb-3">Payment recorded.</Notice>}
      {sp.invited === "1" && <Notice tone="success" params={["invited"]} className="mb-3">Invitation sent.</Notice>}
      {notes.error && <Notice tone="error" params={["error", "et", "es"]} className="mb-3">{notes.error.slice(0, 300)}</Notice>}
      {sp.undone === "1" && !showUndo && <Notice tone="success" params={["undone"]} className="mb-3">Undone.</Notice>}

      {/* Who owes whom, exactly, in this pair's own currency. */}
      {net === 0 && (
        <section aria-label="Balance" className="rounded-[24px] border border-line bg-white px-5 py-5" data-person-balance>
          <p className="font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-fg" data-balance-line>
            {balanceLine(net, name, currency)}
          </p>
          <p className="mt-1 text-[14px] text-fg/60">
            {hasHistory ? `Only between you and ${name}. Not combined with any group.` : `Nothing here yet. Add the first expense with ${name}.`}
          </p>
          {addButton}
        </section>
      )}

      {/* One card when money is owed either way: the headline, the note, the breakdown, then Add expense and the settle action. */}
      {net !== 0 && (
        <ul aria-label="Balance" data-person-balance data-person-settle>
          <SettleCard
            id={`person-${group.id}`}
            name={name}
            groupLine="Direct"
            amount={amount}
            tone={owed ? "owed" : "owe"}
            lead={{
              headline: balanceLine(net, name, currency),
              note: `Only between you and ${name}. Not combined with any group.`,
              add: (
                <Link href={`/groups/${group.id}/add`} className={primaryButtonClass} data-person-add>
                  Add expense
                </Link>
              ),
            }}
            main={
              owed
                ? {
                    kind: "node",
                    node: (
                      <Link href={`/groups/${group.id}/remind?from=${other.id}`} data-remind className={BIG_OUTLINE}>
                        Remind {first}
                      </Link>
                    ),
                  }
                : { kind: "sheet", label: "Record payment" }
            }
            menu={menu}
            breakdown={
              <div className="mt-1 rounded-2xl bg-mist px-3.5 py-3 text-[13.5px] leading-snug text-fg/75" data-breakdown-body>
                <p className="font-semibold text-fg" data-cross-total>
                  {owed ? `${name} pays you ${amount}` : `You pay ${name} ${amount}`}
                </p>
              </div>
            }
            sheet={
              owed
                ? { title: "Mark received", subtitle: `Confirm only after ${first} has paid you.`, from: name, to: "You", other: name, groupLine: "Direct", amount, tone: "owed", partHref, confirmLabel: "Confirm payment received", note: SHEET_NOTE }
                : { title: "Record payment", subtitle: `Confirm only after you’ve paid ${first}.`, from: "You", to: name, other: name, groupLine: "Direct", amount, tone: "owe", partHref, confirmLabel: "Confirm payment recorded", note: SHEET_NOTE }
            }
            action={settleAcrossGroups}
            fields={
              <>
                <FreshKey name="rid" />
                <input type="hidden" name="parts" value={JSON.stringify([part])} />
                <input type="hidden" name="back" value={`people:${group.id}`} />
              </>
            }
          />
        </ul>
      )}

      {!shared && (
        <section aria-label={`Invite ${name}`} className="mt-4 rounded-[22px] border border-line px-4 py-3.5" data-person-invite>
          {openInvite ? (
            <div data-person-open-invite>
              <p className="text-[14.5px] leading-snug text-fg/75">Invitation sent to {openInvite}. They’ll see this once they join.</p>
              <form action={cancelInvite} className="mt-2">
                <input type="hidden" name="groupId" value={group.id} />
                <input type="hidden" name="memberId" value={other.id} />
                <button type="submit" className="min-h-11 w-full rounded-full border border-fg/25 text-[15px] font-semibold active:bg-fg/10" data-cancel-invite>
                  Cancel invitation
                </button>
              </form>
            </div>
          ) : (
            <details open={Boolean(notes.inviteError)}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[15px] font-medium [&::-webkit-details-marker]:hidden">
                Invite {name} by email
                <span aria-hidden className="text-fg/60">›</span>
              </summary>
              <form action={inviteDirect} className="mt-2 space-y-3">
                <input type="hidden" name="groupId" value={group.id} />
                <input name="email" type="email" inputMode="email" required maxLength={200} placeholder="name@example.com" aria-label={`${name}'s email`} autoComplete="off" defaultValue={notes.inviteError ? (sp.email ?? "").slice(0, 200) : ""} aria-invalid={notes.inviteError ? true : undefined} aria-describedby={notes.inviteError ? "invite-error" : undefined} className={inputClass} />
                {notes.inviteError && (
                  <p id="invite-error" role="alert" className="text-[14px] leading-snug text-fg" data-invite-error>
                    {notes.inviteError.slice(0, 300)}
                  </p>
                )}
                <p className="text-[13.5px] leading-snug text-fg/60">They’ll see your shared expenses once they join. Until then only you can.</p>
                <button type="submit" className="min-h-11 w-full rounded-full border border-fg/25 text-[15px] font-semibold active:bg-fg/10">
                  Send invitation
                </button>
              </form>
            </details>
          )}
        </section>
      )}

      <section aria-label="History" className="mt-8" data-person-history>
        <h2 className="mb-1 px-1 text-[13px] font-semibold tracking-[0.14em] text-fg/75">HISTORY</h2>
        {hasHistory ? (
          <ActivityTab v={v} shown={Number(sp.n) || undefined} openId={sp.open?.slice(0, 40)} reactions={reactions} receipts={receipts} />
        ) : (
          <p className="rounded-[20px] border border-line px-4 py-8 text-center text-[15px] text-fg/65" data-person-empty>
            Nothing here yet. Add the first expense with {name}.
          </p>
        )}
      </section>

      <p className="mt-6 px-1 text-[13.5px] leading-snug text-fg/60" data-settle-footnote>
        Recording a payment updates the balance. Loopin doesn’t transfer money.
      </p>

      {showUndo && justDid && (
        <UndoBar
          key={justDid.id}
          text={sp.undone ? "Undone." : `${v.nameOf(justDid.actorId)} ${neutralGameText(justDid.text)}`}
          groupId={group.id}
          eventId={justDid.id}
          back="group"
          redo={sp.undone === "1"}
        />
      )}
    </>
  );
}
