import { Notice } from "@/components/Notice";
import type { Notes } from "@/lib/flash";

type Notices = { saved?: string; added?: string };

// What just happened (settings saved, an error, people added): shown under the header on every tab, not only on the one with the ticket.
// `notes` are the messages Loopin signed for this page (see lib/flash.ts); anything else in the address is ignored.
export function GroupNotices({ sp, notes }: { sp: Notices; notes: Notes }) {
  if (sp.saved !== "settings" && !notes.error && sp.added === undefined) return null;
  return (
    <div className="mb-4 space-y-2" data-group-notices>
      {sp.saved === "settings" && <p className="text-sm text-accent-dark">Settings saved. Everyone in the group has been notified.</p>}
      {notes.error && <Notice tone="error" params={["error", "et", "es"]}>{notes.error}</Notice>}
      {sp.added !== undefined && (
        <p className="text-sm text-accent-dark">
          {Number(sp.added) === 1 ? "1 person added." : `${Number(sp.added) || 0} people added.`}
          {notes.skipped && <span className="text-gray-600"> Already in the group: {notes.skipped}.</span>}
        </p>
      )}
    </div>
  );
}
