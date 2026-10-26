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
  const whatsapp = whatsappLink(`Join “${group.name}” on Loopin so we can split expenses: ${link}`);

  const active = group.members.filter((m) => !m.leftAt);
  const justDid = sp.did ? group.events.find((e) => e.id === sp.did) : undefined;
  const nameOf = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const box = "rounded-2xl border border-line px-4 py-4";
  const step = (n: number, title: string, hint: string) => (
    <div className="mb-3 flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fg text-xs font-semibold text-canvas">{n}</span>
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-gray-400">{hint}</span>
      </span>
    </div>
  );

  return (
    <>
      <PageHeader title="Add people" back={`/groups/${group.id}`} />
      {sp.new === "1" && (
        <Notice params={["new"]} className="-mt-2 mb-5">🎉 {group.name} is ready. Now bring your people in.</Notice>
      )}
      {sp.error && <ErrorNote>{sp.error}</ErrorNote>}
      {sp.added && !sp.undone && <Notice tone="success" params={["added"]} className="mb-4">Added {sp.added}. They’ve been notified.</Notice>}
      {sp.invited && <Notice params={["invited"]} className="mb-4">Invite sent to {sp.invited}. They’ll join once they accept.</Notice>}

      <section className={box}>
        {step(1, "People on Loopin", "Search friends by name, or anyone by their email")}
        <PeopleSearch groupId={group.id} />
      </section>

      <section className={`mt-3 ${box}`}>
        {step(2, "From your contacts", "Pick people and send them the invite")}
        <ContactInvite groupId={group.id} groupName={group.name} link={link} />
      </section>

      <section className={`mt-3 ${box}`}>
        {step(3, "By email", "We email them a link to join")}
        <form action={invitePeople} className="flex gap-2">
          <input type="hidden" name="groupId" value={group.id} />
          <input name="emails" type="text" inputMode="email" autoComplete="off" required placeholder="friend@example.com" aria-label="Email addresses to invite" className={inputClass} />
          <button type="submit" className="pop shrink-0 bg-fg px-4 text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
            Invite
          </button>
        </form>
        <p className="mt-1.5 text-xs text-gray-400">Several? Separate them with commas.</p>
      </section>

      <details className="group/link mt-3 rounded-2xl border border-line">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
          <span className="flex-1">
            <span className="block font-medium">Share the group link or QR code</span>
            <span className="block text-xs text-gray-400">Anyone with it can ask to join after signing up</span>
          </span>
          <span className="text-gray-400 transition-transform group-open/link:rotate-90">›</span>
        </summary>
        <div className="space-y-3 px-4 pb-5">
          <ShareInvite code={group.inviteCode} groupName={group.name} />
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="block border border-line px-4 py-3 text-center text-sm font-medium text-fg active:bg-mist">
            💬 Send on WhatsApp
          </a>
          <div
            className="mx-auto w-full max-w-[220px] overflow-hidden rounded-2xl bg-[#f4f2ec] p-3 [&_svg]:h-auto [&_svg]:w-full"
            role="img"
            aria-label={`QR code to join ${group.name}`}
            dangerouslySetInnerHTML={{ __html: qr }}
          />
        </div>
      </details>

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
