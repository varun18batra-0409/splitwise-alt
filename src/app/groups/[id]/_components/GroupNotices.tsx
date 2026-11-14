import { Notice } from "@/components/Notice";

type Notices = { saved?: string; error?: string; added?: string; skipped?: string };

// What just happened (settings saved, an error, people added): shown under the header on every tab, not only on the one with the ticket.
export function GroupNotices({ sp }: { sp: Notices }) {
  if (sp.saved !== "settings" && !sp.error && sp.added === undefined) return null;
  return (
    <div className="mb-4 space-y-2" data-group-notices>
      {sp.saved === "settings" && <p className="text-sm text-accent-dark">Settings saved. Everyone in the group has been notified.</p>}
      {sp.error && <Notice tone="error" params={["error"]}>{sp.error}</Notice>}
      {sp.added !== undefined && (
        <p className="text-sm text-accent-dark">
          {Number(sp.added) === 1 ? "1 person added." : `${Number(sp.added) || 0} people added.`}
          {sp.skipped && <span className="text-gray-600"> Already in the group: {sp.skipped}.</span>}
        </p>
      )}
    </div>
  );
}
