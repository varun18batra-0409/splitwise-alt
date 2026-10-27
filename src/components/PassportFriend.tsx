import Link from "@/components/Link";
import { PageHeader } from "@/components/ui";
import { nudgePassportAction } from "@/app/passport-actions";

// For someone who doesn't share a group with this person: a friendly closed door.
export function Locked() {
  return (
    <>
      <PageHeader title="Passport" back="/passport/friends" />
      <div className="rounded-2xl bg-mist px-5 py-8 text-center" data-passport-locked>
        <p className="text-3xl" aria-hidden>
          🔒
        </p>
        <p className="mt-2 font-semibold">You can’t open this passport</p>
        <p className="mt-1 text-sm text-gray-500">You can see the passports of people you share a group with.</p>
        <Link href="/passport/friends" className="mt-5 inline-block text-sm font-semibold underline underline-offset-4">
          Friends’ passports
        </Link>
      </div>
    </>
  );
}

// A friend's passport with no stamps yet: a gentle nudge, to their Alerts only.
export function NudgeBox({ accountId, first, sent, error }: { accountId: string; first: string; sent: boolean; error?: string }) {
  return (
    <section aria-label={`Nudge ${first}`} className="mt-5 rounded-2xl border border-line px-4 py-4 text-center">
      {sent ? (
        <p role="status" className="text-sm text-owed">
          Nudged ✓ {first} will see it in Alerts.
        </p>
      ) : (
        <>
          <p className="text-sm font-semibold">{first}’s passport is still empty</p>
          <p className="mt-0.5 text-xs text-gray-500">Ask them to add the countries they’ve been to. They’ll see it in Alerts.</p>
          {error && <p className="mt-2 text-xs text-owe">{error.slice(0, 120)}</p>}
          <form action={nudgePassportAction} className="mt-3">
            <input type="hidden" name="accountId" value={accountId} />
            <button type="submit" className="rounded-full border border-line px-4 py-2 text-sm font-semibold active:bg-mist">
              👋 Nudge {first}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
