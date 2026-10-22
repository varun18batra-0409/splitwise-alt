import Link from "@/components/Link";
import { GroupCover } from "@/components/GroupCover";
import { getAccount, getMemberships } from "@/lib/identity";
import { loadNotes, markNotesSeen } from "@/lib/account-notes";
import { setCollectPush } from "@/app/collect-actions";
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
  trip_dates_set: "⏳",
  split_changed: "÷",
  bill_added: "↻",
  bill_changed: "✎",
};

// Everything other people added, changed or deleted in your groups, newest first.
// Opening this page marks them as read.
export default async function Notifications() {
  const [memberships, tz, account] = await Promise.all([getMemberships(), getTimeZone(), getAccount()]);
  const [{ items }, notes] = await Promise.all([loadNotifications(memberships, 100), account ? loadNotes(account.id, 50) : Promise.resolve([])]);
  await Promise.all([markNotificationsSeen(memberships), account ? markNotesSeen(account.id) : null]);

  // Group changes and personal notes (Collect) together, newest first.
  type Row = { date: Date } & ({ type: "event"; n: (typeof items)[number] } | { type: "note"; note: (typeof notes)[number] });
  const rows: Row[] = [
    ...items.map((n) => ({ type: "event" as const, n, date: n.event.createdAt })),
    ...notes.map((note) => ({ type: "note" as const, note, date: note.createdAt })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());
  const time = (d: Date) => d.toLocaleTimeString("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" });

  return (
    <>
      <PageHeader title="Notifications" back="/" />
      <PushToggle />
      {account && (
        // Collect notifications (being added, reminders, payments checked, people ticking): on the phone or not.
        <form action={setCollectPush} className="-mt-2 mb-6 flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
          <input type="hidden" name="on" value={account.collectPush ? "0" : "1"} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Collections on this phone</span>
            <span className="block text-xs text-gray-400">Added to one, reminders, payments ticked or checked. Always listed here.</span>
          </span>
          <button
            type="submit"
            role="switch"
            aria-checked={account.collectPush}
            aria-label="Collection notifications on this phone"
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${account.collectPush ? "bg-meter-up" : "bg-fg/15"}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-canvas transition-all ${account.collectPush ? "left-6" : "left-1"}`} />
          </button>
        </form>
      )}
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-mist px-4 py-10 text-center text-sm text-gray-600">
          Nothing yet. When someone adds, changes or deletes something in your groups, or something happens in a collection, it shows up here.
        </p>
      ) : (
        <div className="space-y-6">
          {byDay(rows, new Date(), tz).map((day) => (
            <section key={day.day}>
              <h2 className="py-1.5 text-sm font-medium text-gray-500">{day.day}</h2>
              <ul className="lp-rise divide-y divide-gray-100">
                {day.items.map((row) => {
                  if (row.type === "note") {
                    const note = row.note;
                    return (
                      <li key={note.id}>
                        <Link href={note.url} className="flex gap-3 py-3 active:bg-gray-50">
                          <span aria-hidden className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-owed/[0.12] text-owed ring-1 ring-inset ring-owed/15 ${note.seenAt ? "opacity-70" : ""}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                              {note.kind === "collect_reminder" ? (
                                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                              ) : note.kind === "collect_paid" || note.kind === "collect_ticked" ? (
                                <path d="M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3" />
                              ) : (
                                <path d="M9 3h6M10 3v3.5a5 5 0 0 0-4 4.9V19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7.6a5 5 0 0 0-4-4.9V3M9 14h6" />
                              )}
                            </svg>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm">
                              <strong className="font-medium">{note.title}</strong> · {note.body}
                            </span>
                            <span className="mt-0.5 block text-xs text-gray-400">Collection · {time(note.createdAt)}</span>
                          </span>
                          {!note.seenAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-owe" aria-label="New" />}
                        </Link>
                      </li>
                    );
                  }
                  const n = row.n;
                  const details = parseDetails(n.event.details).slice(0, 4);
                  return (
                    <li key={n.event.id}>
                      <Link href={`/groups/${n.event.groupId}?tab=activity`} className="flex gap-3 py-3 active:bg-gray-50">
                        {/* The group's picture, with what happened as a small badge. */}
                        <span className="relative h-11 w-11 shrink-0" aria-hidden>
                          <span className={`absolute inset-0 overflow-hidden rounded-xl ${n.unread ? "" : "opacity-70"}`}>
                            <GroupCover {...n.groupCover} uid={`nt-${n.event.id}`} letter={n.groupName} letterClass="text-lg" sizes="44px" />
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
                            {n.groupName} · {time(n.event.createdAt)}
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
