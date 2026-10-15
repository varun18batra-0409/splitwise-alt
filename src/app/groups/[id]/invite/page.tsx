import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { addMembers } from "@/app/actions";
import { Avatar, PageHeader, primaryButtonClass } from "@/components/ui";
import { MemberInputs } from "@/components/MemberInputs";
import { ShareInvite } from "@/components/ShareInvite";

// Invite people: share the link, show a QR code for friends at the same
// table, or add names yourself. Below, everyone in the group and whether
// they've joined on their phone yet.
export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = await db.group.findUnique({
    where: { id },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(`/join/${group.inviteCode}`);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const link = `${proto}://${host}/join/${group.inviteCode}`;
  const qr = await QRCode.toString(link, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0d0d0f", light: "#f4f2ec" },
  });
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`Join “${group.name}” on Loopin to split expenses: ${link}`)}`;

  const active = group.members.filter((m) => !m.leftAt);
  const joinedCount = active.filter((m) => m.claimedAt || m.id === myId).length;
  const row = "flex w-full items-center gap-4 px-4 py-4 text-left active:bg-mist";

  return (
    <>
      <PageHeader title="Invite people" back={`/groups/${group.id}`} />

      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-fg font-display text-xl font-semibold text-canvas">
          {group.name.trim().charAt(0).toUpperCase()}
        </span>
        <div>
          <p className="font-display text-xl font-semibold">{group.name}</p>
          <p className="text-sm text-gray-500">
            {joinedCount} of {active.length} joined
          </p>
        </div>
      </div>

      <p className="mb-2 text-sm text-gray-500">Add people to the group</p>
      <div className="mb-8 divide-y divide-line overflow-hidden rounded-2xl border border-line">
        <div className="px-4 py-4">
          <ShareInvite code={group.inviteCode} groupName={group.name} />
        </div>
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={row}>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-mist text-lg">💬</span>
          <span className="flex-1 font-medium">Send on WhatsApp</span>
          <span className="text-gray-400">›</span>
        </a>
        <details className="group/qr">
          <summary className={`${row} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-mist text-lg">▦</span>
            <span className="flex-1 font-medium">Show QR code</span>
            <span className="text-gray-400 transition-transform group-open/qr:rotate-90">›</span>
          </summary>
          <div className="px-4 pb-6 pt-2 text-center">
            <div
              className="mx-auto w-full max-w-[240px] overflow-hidden rounded-2xl bg-[#f4f2ec] p-3 [&_svg]:h-auto [&_svg]:w-full"
              role="img"
              aria-label={`QR code to join ${group.name}`}
              dangerouslySetInnerHTML={{ __html: qr }}
            />
            <p className="mt-3 text-sm text-gray-500">Friends point their phone camera at this to join.</p>
          </div>
        </details>
        <details className="group/add">
          <summary className={`${row} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-mist text-lg">＋</span>
            <span className="flex-1 font-medium">Add members yourself</span>
            <span className="text-gray-400 transition-transform group-open/add:rotate-90">›</span>
          </summary>
          <form action={addMembers} className="space-y-4 px-4 pb-5">
            <input type="hidden" name="groupId" value={group.id} />
            <MemberInputs firstPlaceholderNumber={group.members.length + 1} />
            <button type="submit" className={primaryButtonClass}>
              Add to group
            </button>
          </form>
        </details>
      </div>

      <p className="mb-2 text-sm text-gray-500">
        {active.length} {active.length === 1 ? "member" : "members"}
      </p>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {group.members.map((m) => {
          const me = m.id === myId;
          const status = m.leftAt
            ? { text: "Left", cls: "bg-mist text-gray-500" }
            : me || m.claimedAt
              ? { text: "Joined", cls: "bg-owed/15 text-owed" }
              : { text: "Not joined yet", cls: "bg-mist text-gray-500" };
          return (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3.5">
              <Avatar name={m.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {m.name}
                  {me && <span className="text-gray-400"> (you)</span>}
                </span>
                {m.phone && <span className="block truncate text-xs text-gray-400">{m.phone}</span>}
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${status.cls}`}>{status.text}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-gray-400">“Not joined yet” means nobody has opened the link and picked that name on their phone.</p>
    </>
  );
}
