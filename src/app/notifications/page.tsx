import Link from "@/components/Link";
import { GroupCover } from "@/components/GroupCover";
import { getMemberships } from "@/lib/identity";
import { loadNotifications, markNotificationsSeen } from "@/lib/group-data";
import { byDay } from "@/lib/activity";
import { getTimeZone } from "@/lib/tz";
import { parseDetails } from "@/lib/events";
import { PageHeader } from "@/components/ui";
import { PushToggle } from "@/components/PushControls";

const ICON: Record<string, string> = {
  expense_added: "＋",
  expense_edited: "✎",
  expense_deleted: "✕",
  expense_restored: "↺",
  payment_recorded: "⇄",
  payment_deleted: "✕",
  payment_restored: "↺",
  members_removed: "👤",
  display_currency_changed: "💱",
  group_renamed: "✎",
  currency_changed: "💱",
  markup_changed: "％",
  members_added: "👤",
  group_closed: "⏸",
  group_reopened: "▶",
  group_imported: "📥",
  group_settled_closed: "🎉",
  member_renamed: "✎",
  member_left: "👋",
  member_rejoined: "👤",
};

// Everything other people added, changed or deleted in your groups, newest first.
// Opening this page marks them as read.
export default async function Notifications() {
  const memberships = await getMemberships();
  const tz = await getTimeZone();
  const { items } = await loadNotifications(memberships, 100);
  await markNotificationsSeen(memberships);

  const rows = items.map((n) => ({ ...n, date: n.event.createdAt }));

  return (
    <>
      <PageHeader title="Notifications" back="/" />
      <PushToggle />
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-mist px-4 py-10 text-center text-sm text-gray-600">
          Nothing yet. When someone adds, changes or deletes something in your groups, it shows up here.
        </p>
      ) : (
        <div className="space-y-6">
          {byDay(rows, new Date(), tz).map((day) => (
            <section key={day.day}>
              <h2 className="py-1.5 text-sm font-medium text-gray-500">{day.day}</h2>
              <ul className="lp-rise divide-y divide-gray-100">
                {day.items.map((n) => {
                  const details = parseDetails(n.event.details).slice(0, 4);
                  return (
                    <li key={n.event.id}>
                      <Link href={`/groups/${n.event.groupId}?tab=activity`} className="flex gap-3 py-3 active:bg-gray-50">
                        {/* The group's picture, with what happened as a small badge. */}
                        <span className="relative h-11 w-11 shrink-0" aria-hidden>
                          <span className={`absolute inset-0 overflow-hidden rounded-xl ${n.unread ? "" : "opacity-70"}`}>
                            <GroupCover kind={n.groupCover} uid={`nt-${n.event.id}`} letter={n.groupName} letterClass="text-lg" sizes="44px" />
                          </span>
                          <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-canvas bg-mist text-[11px]">
                            {ICON[n.event.kind] ?? "•"}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm">
                            <strong className="font-medium">{n.actorName}</strong> {n.event.text}
                            {n.event.undoneAt && <span className="text-gray-400"> (since undone)</span>}
                          </span>
                          {n.event.kind === "expense_edited" && details.length > 0 && (
                            <span className="mt-0.5 block text-xs text-gray-500">{details.join(" · ")}</span>
                          )}
                          <span className="mt-0.5 block text-xs text-gray-400">
                            {n.groupName} ·{" "}
                            {n.event.createdAt.toLocaleTimeString("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" })}
                          </span>
                        </span>
                        {n.unread && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-owe" aria-label="New" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
