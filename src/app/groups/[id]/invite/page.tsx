import { neutralGameText } from "@/lib/game-words";
import { bounceIfDirect } from "@/lib/direct-db";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "@/components/Link";
import { Notice } from "@/components/Notice";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { getAccount, getMyMemberId, privatePath } from "@/lib/identity";
import { invitePeople, makeNewInviteLink } from "@/app/actions";
import { isGroupAdmin, pickAdmin } from "@/lib/group-admin";
import { ConfirmButton } from "@/components/ConfirmButton";
import { canUndo } from "@/lib/undo";
import { Avatar, ErrorNote, PageHeader, inputClass, primaryButtonClass } from "@/components/ui";
import { ShareInvite } from "@/components/ShareInvite";
import { ContactInvite, PeopleSearch } from "@/components/AddPeople";
import { UndoBar } from "@/components/UndoBar";
import { whatsappLink } from "@/lib/whatsapp";
import { CopyButton } from "@/components/CollectBits";
import { GroupCover } from "@/components/GroupCover";
import { coverFor } from "@/lib/covers";
import { inviteMemberId, inviteRowLabel } from "@/lib/invites";
import { invitedNotice } from "@/lib/invite-label";
import { SITE_URL } from "@/lib/site";
import { readNotes } from "@/lib/flash";

// "invited" in the address: who was just added, as [name, email] pairs. The email is only there when the
// person typed it themselves ("By email"); someone found by search carries their name alone.
function justInvited(raw: string | undefined): [string, string][] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "string").slice(0, 20).map(([n, e]) => [n.slice(0, 60), e.slice(0, 120)]) : [];
  } catch {
    return [];
  }
}

// The WhatsApp invite, worded for the kind of group: warm, short, and about why it's nice to be in,
// not about the app. The link shows its own picture card underneath.
function inviteMessage(type: string, name: string, link: string, from: string): string {
  const who = from ? `${from} invited you` : "You’re invited";
  const body =
    type === "trip"
      ? `✈️ ${who} to *${name}* on Loopin\n\nAdd what you spend as we go, settle in one tap at the end, and get the whole trip back as stories, postcards and a stamp in your passport.`
      : type === "home"
        ? `🏠 ${who} to *${name}* on Loopin\n\nRent, bills and groceries in one place. Everyone sees their share, nobody has to chase anyone.`
        : type === "couple"
          ? `💛 ${who} to *${name}* on Loopin\n\nOur shared money, sorted. One number, no awkward maths.`
          : type === "pot"
            ? `🃏 ${who} to *${name}* on Loopin\n\nKeep the score and see who pays whom, all in one place. No betting happens in the app.`
            : `👋 ${who} to *${name}* on Loopin\n\nAdd what you spend, see who owes what, settle in one tap.`;
  return `${body}\n\nTap to join 👇\n${link}`;
}

// Add people. Nobody can be added by just typing a name:
//  The card up top: the group's link, Copy, and one big "Invite on WhatsApp". Behind "More ways to add people" (closed to start with):
//  the phone's share sheet, the QR code, people already on Loopin (search by name or email, one tap to add),
//  invite from your contacts (WhatsApp / SMS / email), add by email, and a new link. Someone added by email is in the group at
//  once as a name (so they can be split with) and is invited; they see the group
//  themselves only after they sign up with their email and tap Join.
export default async function AddPeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string; invited?: string; error?: string; did?: string; undone?: string; newlink?: string; back?: string }>;
}) {
  const { id } = await params;
  await bounceIfDirect(id); // a pair of two people has no group screens: its person page instead
  const sp = await searchParams;
  const notes = await readNotes(sp, `/groups/${id}/invite`);
  const group = await db.group.findUnique({
    where: { id },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] }, events: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  const signedIn = Boolean(await getAccount()); // "Not signed in · Sign in" is only said to someone who is not
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(await privatePath(id));
  // Someone who left keeps the history, but not the invite link.
  if (group.members.find((m) => m.id === myId)?.leftAt)
    return (
      <>
        <PageHeader title="Add people" back={`/groups/${group.id}`} />
        <p className="mb-6 text-gray-600" data-left-member>You left this group, so you can’t invite people to it. Rejoin it from People first.</p>
        <a href={`/groups/${group.id}/people`} className={primaryButtonClass}>
          Go to People
        </a>
      </>
    );
  const invites = await db.invite.findMany({ where: { groupId: group.id, acceptedAt: null }, orderBy: { createdAt: "desc" } });
  // Invited people already show in the list below as names; only invitations with no name row of their own are listed apart.
  const invitedRows = new Set(invites.map((i) => inviteMemberId(i)).filter(Boolean));
  const looseInvites = invites.filter((i) => !group.members.some((m) => m.id === inviteMemberId(i)));

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  // In production the link is always the real site address (never localhost, never a preview address); elsewhere it follows the page's own host.
  const origin = process.env.VERCEL_ENV === "production" ? SITE_URL : `${proto}://${host}`;
  const link = `${origin}/join/${group.inviteCode}`;
  const qr = await QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0d0d0f", light: "#f4f2ec" } });
  const myFirst = (group.members.find((m) => m.id === myId)?.name ?? "").trim().split(/\s+/)[0] ?? "";
  const whatsapp = whatsappLink(inviteMessage(group.type, group.name, link, myFirst));

  const active = group.members.filter((m) => !m.leftAt);
  const justDid = sp.did ? group.events.find((e) => e.id === sp.did) : undefined;
  const nameOf = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  // One of the "More ways to add people": a row that opens to its own small form.
  const way = (key: string, icon: React.ReactNode, title: string, hint: string, body: React.ReactNode) => (
    <details className="group/way" data-way={key}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3.5 px-4 py-3 active:bg-fg/10 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-fg/25 text-fg/75">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{title}</span>
          <span className="block text-xs text-gray-400">{hint}</span>
        </span>
        <span aria-hidden className="text-fg/55 transition-transform group-open/way:rotate-90">›</span>
      </summary>
      <div className="px-4 pb-4">{body}</div>
    </details>
  );
  const ico = (d: string) => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );

  return (
    <>
      <PageHeader title="Add people" back={`/groups/${group.id}`} />
      {sp.new === "1" && (
        <Notice params={["new"]} className="-mt-2 mb-5">{group.name} is ready. Now bring your people in.</Notice>
      )}
      {notes.error && <ErrorNote>{notes.error}</ErrorNote>}
      {sp.newlink && <Notice tone="success" params={["newlink"]} className="mb-4">New invite link ready. The old one no longer works.</Notice>}
      {!sp.undone &&
        justInvited(notes.invited).map(([name, email]) => (
          <Notice key={`${name}-${email}`} tone="success" params={["invited"]} className="mb-4">
            {sp.back === "1" ? (
              <>
                <span className="block font-semibold" data-invited-title>Invited back</span>
                <span className="block text-sm" data-invited-back>{name} will rejoin when they accept. Nothing about the money changes.</span>
              </>
            ) : (
              <>
                <span className="block font-semibold" data-invited-title>{name} is in the group</span>
                <span className="block text-sm">
                  You can add {name} to expenses now. {invitedNotice(email)}
                </span>
              </>
            )}
          </Notice>
        ))}

      {/* The fastest way in: the group's own invite, straight to WhatsApp. */}
      <section aria-label="Invite link" className="vault relative mb-6 overflow-hidden rounded-[24px]" data-invite-card>
        <div className="relative h-[96px] overflow-hidden" aria-hidden>
          <GroupCover {...coverFor(group)} uid={`inv-${group.id}`} sizes="(max-width: 448px) 100vw, 448px" drift />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(20,20,24,0.15),#141418)]" />
        </div>
        <div className="relative -mt-7 px-5 pb-5">
          <p className="text-[13px] font-medium leading-none text-fg/65">Bring your people in</p>
          <p className="mt-1 font-display text-[24px] font-semibold leading-tight tracking-tight">{group.name}</p>
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-line bg-canvas/50 px-3.5 py-2.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg/70">{link.replace(/^https?:\/\//, "")}</span>
            <CopyButton text={link} label="Copy link" />
          </div>
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="pop mt-3 flex w-full items-center justify-center gap-2.5 bg-fg px-4 py-3.5 text-[15px] font-semibold text-canvas [--pop-edge:#6e6b63]" data-invite-whatsapp>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
            </svg>
            Invite on WhatsApp
          </a>
          {/* The link, Copy and WhatsApp are the main way in. Everything else sits behind this one control, closed to start with: the phone's share sheet, the QR code, name or email search, contacts, email, and a new link. */}
          <details className="group/more mt-2" data-more-ways>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-1.5 text-center text-sm font-semibold text-fg/75 [&::-webkit-details-marker]:hidden">
              More ways to add people <span aria-hidden className="transition-transform group-open/more:rotate-90">›</span>
            </summary>
            <div className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-canvas/40">
              <ShareInvite code={group.inviteCode} groupName={group.name} />
              {way("qr", ico("M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 20h2"), "Show a QR code", "Friends scan it to join",
                <>
                  <div
                    className="mx-auto w-full max-w-[200px] overflow-hidden rounded-2xl bg-[#f4f2ec] p-3 [&_svg]:h-auto [&_svg]:w-full"
                    role="img"
                    aria-label={`QR code to join ${group.name}`}
                    dangerouslySetInnerHTML={{ __html: qr }}
                  />
                  <p className="mt-2 text-balance text-center text-xs text-gray-400">Anyone with the link or code can join with just a name</p>
                </>,
              )}
              {way("search", ico("M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20.5 20.5 16 16"), "Search by name or email", "People already on Loopin", <PeopleSearch groupId={group.id} />)}
              {way("contacts", ico("M16 19.5v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18v1.5M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 8v6M22 11h-6"), "From your contacts", "Pick people and send the invite", <ContactInvite groupId={group.id} groupName={group.name} link={link} india={group.currency === "INR"} />)}
              {way("email", ico("M4 6h16v12H4ZM4 7l8 6 8-6"), "By email", "We email them an invitation",
                <>
                  <form action={invitePeople} className="flex gap-2">
                    <input type="hidden" name="groupId" value={group.id} />
                    <input name="emails" type="text" inputMode="email" autoComplete="off" required placeholder="friend@example.com" aria-label="Email addresses to invite" className={inputClass} />
                    {/* Outline: "Invite on WhatsApp" is the one cream button on this screen. */}
                    <button type="submit" className="shrink-0 rounded-full border border-fg/30 px-4 text-sm font-semibold text-fg active:bg-fg/10">
                      Invite
                    </button>
                  </form>
                  <p className="mt-1.5 text-xs text-gray-400">They’re in the group now. Several? Separate them with commas. Everyone you add by email gets the same message, whether or not they’re on Loopin yet.</p>
                </>,
              )}
            </div>
            {pickAdmin(group.members)?.id === myId && (
              <form action={makeNewInviteLink} className="mt-3 text-center" data-new-invite-link>
                <input type="hidden" name="groupId" value={group.id} />
                <ConfirmButton
                  message={`Make a new invite link? The old link stops working.${invites.length > 0 ? " Email invites not yet accepted will stop working." : ""}`}
                  className="py-1.5 text-xs font-semibold text-fg/50 underline underline-offset-4"
                >
                  Make a new invite link
                </ConfirmButton>
                <p className="text-[11px] text-gray-400">Use this if the link got to someone it shouldn’t.{invites.length > 0 ? " Email invites not yet accepted will stop working." : ""}</p>
              </form>
            )}
          </details>
        </div>
      </section>

      {looseInvites.length > 0 && (
        <>
          <p className="mb-2 mt-8 text-sm text-gray-500">Invited · waiting to join</p>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {looseInvites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3 max-[389px]:flex-wrap max-[389px]:gap-y-1">
                {/* The email someone typed is shown only to the person who invited; everyone else sees that an invitation is out. */}
                <span className="min-w-0 flex-1 truncate text-sm max-[389px]:basis-full" data-invite-row>
                  {inviteRowLabel(i, myId, nameOf(i.invitedById))}
                </span>
                <span className="shrink-0 rounded-full bg-mist px-2.5 py-1 text-xs text-gray-500">Invited · hasn’t joined yet</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mb-2 mt-8 text-sm text-gray-500">
        In the group · {active.length} {active.length === 1 ? "person" : "people"}
        {group.members.length > active.length ? ` (and ${group.members.length - active.length} who left)` : ""}
      </p>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {group.members.map((m) => {
          const me = m.id === myId;
          const status: { text: string; cls: string; signIn?: boolean } = m.leftAt
            ? { text: "Left", cls: "bg-mist text-gray-500" }
            : m.accountId
              ? { text: "On Loopin ✓", cls: "bg-owed/15 text-owed" }
              : me
                ? // F3: you are never "not on Loopin yet": signed out, it's this device only.
                  signedIn
                    ? { text: "Only on this device", cls: "bg-mist text-gray-500" } // signed in but this seat has no account yet: the old, accurate words
                    : { text: "Not signed in", cls: "bg-mist text-gray-500", signIn: true }
                : invitedRows.has(m.id)
                  ? { text: "Invited · hasn’t joined yet", cls: "bg-mist text-gray-500" }
                  : { text: "Not on Loopin yet", cls: "bg-mist text-gray-500" };
          return (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3.5 max-[389px]:flex-wrap max-[389px]:gap-y-1">
              <Avatar name={m.name} you={me} />
              <span className="min-w-0 flex-1 truncate font-medium max-[389px]:basis-[calc(100%-52px)] max-[389px]:[white-space:normal]">
                {m.name}
                {me && <span className="text-gray-400"> (you)</span>}
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap max-[389px]:ml-[52px] ${status.cls}`} data-member-status={me ? "me" : undefined}>
                {status.text}
                {status.signIn && (
                  <>
                    {" · "}
                    <Link href={`/signin?${new URLSearchParams({ back: `/groups/${group.id}/invite` })}`} className="font-semibold text-fg underline underline-offset-2">
                      Sign in
                    </Link>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {group.members.some((m) => !m.accountId && !m.leftAt && m.id !== myId) && (
        <p className="mt-3 text-xs text-gray-400">“Not on Loopin yet”: added by name. They can take over their name from the group link, with or without signing in.</p>
      )}

      {justDid && canUndo(justDid, group.events, new Date(), { id: myId, isAdmin: await isGroupAdmin(group.id, myId), closed: group.closed, members: group.members }).ok && (
        <UndoBar key={justDid.id} text={sp.undone ? "Undone." : `${nameOf(justDid.actorId)} ${neutralGameText(justDid.text)}`} groupId={group.id} eventId={justDid.id} back="people" redo={sp.undone === "1"} />
      )}
    </>
  );
}
