import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { invitePeople } from "@/app/actions";
import { canUndo } from "@/lib/undo";
import { Avatar, ErrorNote, PageHeader, inputClass } from "@/components/ui";
import { ShareInvite } from "@/components/ShareInvite";
import { ContactInvite, PeopleSearch } from "@/components/AddPeople";
import { UndoBar } from "@/components/UndoBar";
import { whatsappLink } from "@/lib/whatsapp";
import { CopyButton } from "@/components/CollectBits";
import { GroupCover } from "@/components/GroupCover";
import { coverFor } from "@/lib/covers";

// The WhatsApp invite, worded for the kind of group.
function inviteMessage(type: string, name: string, link: string): string {
  const lead =
    type === "trip"
      ? `Join our trip “${name}” on Loopin: we split everything as we go, and get the whole trip back as stories after.`
      : type === "home"
        ? `Join “${name}” on Loopin, for rent, bills and the shopping list. Nobody keeps a spreadsheet again.`
        : type === "couple"
          ? `Join “${name}” on Loopin, so we always know who’s ahead.`
          : type === "pot"
            ? `Join “${name}” on Loopin for card night: buy-ins, the pot, and who pays whom at the end.`
            : `Join “${name}” on Loopin so we can split expenses, settle in one tap.`;
  return `${lead}\n\nTap to join (30 seconds, no password):\n${link}`;
}

// Add people. Nobody can be added by just typing a name:
//  1. people already on Loopin (search by name or email, one tap to add);
//  2. invite from your contacts (WhatsApp / SMS / email);
//  3. invite by email;
//  plus the group's link and QR code. Invited people become members only after
//  they sign up with their email and accept.
export default async function AddPeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string; added?: string; invited?: string; error?: string; did?: string; undone?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const group = await db.group.findUnique({
    where: { id },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] }, events: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  const invites = await db.invite.findMany({ where: { groupId: group.id, acceptedAt: null }, orderBy: { createdAt: "desc" } });

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const link = `${proto}://${host}/join/${group.inviteCode}`;
  const qr = await QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0d0d0f", light: "#f4f2ec" } });
  const whatsapp = whatsappLink(inviteMessage(group.type, group.name, link));

  const active = group.members.filter((m) => !m.leftAt);
  const justDid = sp.did ? group.events.find((e) => e.id === sp.did) : undefined;
  const nameOf = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const box = "rounded-[20px] border border-line bg-mist/40 px-4 py-4";
  const step = (icon: React.ReactNode, title: string, hint: string) => (
    <div className="mb-3 flex items-start gap-3">
      <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d8bd7a]/40 text-[#e8d29a]">
        {icon}
      </span>
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-gray-400">{hint}</span>
      </span>
    </div>
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
      {sp.error && <ErrorNote>{sp.error}</ErrorNote>}
      {sp.added && !sp.undone && <Notice tone="success" params={["added"]} className="mb-4">Added {sp.added}. They’ve been notified.</Notice>}
      {sp.invited && <Notice params={["invited"]} className="mb-4">Invite sent to {sp.invited}. They’ll join once they accept.</Notice>}

      {/* The fastest way in: the group's own invite, straight to WhatsApp. */}
      <section aria-label="Invite link" className="vault relative mb-6 overflow-hidden rounded-[24px]" data-invite-card>
        <div className="relative h-[96px] overflow-hidden" aria-hidden>
          <GroupCover {...coverFor(group)} uid={`inv-${group.id}`} sizes="(max-width: 448px) 100vw, 448px" drift />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(20,20,24,0.15),#141418)]" />
        </div>
        <div className="relative -mt-7 px-5 pb-5">
          <p className="font-hand text-[22px] font-bold leading-none text-[#ffd9a8]">Bring your people in</p>
          <p className="mt-1 font-display text-[24px] font-semibold leading-tight tracking-tight">{group.name}</p>
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-line bg-canvas/50 px-3.5 py-2.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg/70">{link.replace(/^https?:\/\//, "")}</span>
            <CopyButton text={link} label="Copy" />
          </div>
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="pop mt-3 flex w-full items-center justify-center gap-2.5 bg-[#25d366] px-4 py-3.5 text-[15px] font-semibold text-[#062c16] [--pop-edge:#128c4a]" data-invite-whatsapp>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
            </svg>
            Invite on WhatsApp
          </a>
          <div className="mt-2.5">
            <ShareInvite code={group.inviteCode} groupName={group.name} />
          </div>
          <details className="group/link mt-2">
            <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 py-1.5 text-xs font-semibold text-fg/60 [&::-webkit-details-marker]:hidden">
              Share the group link or QR code <span className="transition-transform group-open/link:rotate-90">›</span>
            </summary>
            <div
              className="mx-auto mt-3 w-full max-w-[200px] overflow-hidden rounded-2xl bg-[#f4f2ec] p-3 [&_svg]:h-auto [&_svg]:w-full"
              role="img"
              aria-label={`QR code to join ${group.name}`}
              dangerouslySetInnerHTML={{ __html: qr }}
            />
            <p className="mt-2 text-center text-xs text-gray-400">Anyone with it can ask to join after signing up</p>
          </details>
        </div>
      </section>

      <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.2em] text-gray-400">Or add them yourself</p>
      <section className={box}>
        {step(ico("M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20.5 20.5 16 16"), "People on Loopin", "Search friends by name, or anyone by their email")}
        <PeopleSearch groupId={group.id} />
      </section>

      <section className={`mt-3 ${box}`}>
        {step(ico("M16 19.5v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18v1.5M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 8v6M22 11h-6"), "From your contacts", "Pick people and send them the invite")}
        <ContactInvite groupId={group.id} groupName={group.name} link={link} />
      </section>

      <section className={`mt-3 ${box}`}>
        {step(ico("M4 6h16v12H4ZM4 7l8 6 8-6"), "By email", "We email them a link to join")}
        <form action={invitePeople} className="flex gap-2">
          <input type="hidden" name="groupId" value={group.id} />
          <input name="emails" type="text" inputMode="email" autoComplete="off" required placeholder="friend@example.com" aria-label="Email addresses to invite" className={inputClass} />
          <button type="submit" className="pop shrink-0 bg-fg px-4 text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
            Invite
          </button>
        </form>
        <p className="mt-1.5 text-xs text-gray-400">Several? Separate them with commas.</p>
      </section>

      {invites.length > 0 && (
        <>
          <p className="mb-2 mt-8 text-sm text-gray-500">Invited · waiting to join</p>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-sm">{i.email}</span>
                <span className="shrink-0 rounded-full bg-mist px-2.5 py-1 text-xs text-gray-500">Invited</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mb-2 mt-8 text-sm text-gray-500">
        In the group · {active.length} {active.length === 1 ? "person" : "people"}
      </p>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {group.members.map((m) => {
          const me = m.id === myId;
          const status = m.leftAt
            ? { text: "Left", cls: "bg-mist text-gray-500" }
            : m.accountId
              ? { text: "On Loopin ✓", cls: "bg-owed/15 text-owed" }
              : { text: "Not verified", cls: "bg-mist text-gray-500" };
          return (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3.5">
              <Avatar name={m.name} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {m.name}
                {me && <span className="text-gray-400"> (you)</span>}
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${status.cls}`}>{status.text}</span>
            </li>
          );
        })}
      </ul>
      {group.members.some((m) => !m.accountId && !m.leftAt) && (
        <p className="mt-3 text-xs text-gray-400">“Not verified”: added by name before invitations. They can claim their name from the group link after signing up.</p>
      )}

      {justDid && canUndo(justDid, group.events).ok && (
        <UndoBar key={justDid.id} text={sp.undone ? "Undone." : `${nameOf(justDid.actorId)} ${justDid.text}`} groupId={group.id} eventId={justDid.id} back="people" redo={sp.undone === "1"} />
      )}
    </>
  );
}
