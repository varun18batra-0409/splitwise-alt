import Link from "@/components/Link";
import { niceDate } from "@/lib/format";
import { setGroupClosed } from "@/app/actions";
import type { GroupView } from "./view";

type Notices = { saved?: string; error?: string; added?: string; skipped?: string };

// The top of a group, kept short: closed banner, your balance, Settle up and
// Why?, and notices. Details (other currencies, totals, card fee) live in Balances.
export function GroupSummary({ v, sp }: { v: GroupView; sp: Notices }) {
  const { group, myId, net, money, eq, expenses } = v;
  const mine = net[myId] ?? 0;

  return (
    <>
      {group.closed && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl bg-mist px-4 py-3 text-sm">
          <span className="text-gray-600">
            Closed{group.closedAt ? ` on ${niceDate(group.closedAt.toISOString().slice(0, 10))}` : ""}. History stays here; new expenses are
            paused.
          </span>
          <form action={setGroupClosed}>
            <input type="hidden" name="groupId" value={group.id} />
            <input type="hidden" name="closed" value="0" />
            <button type="submit" className="shrink-0 font-medium text-accent">
              Reopen
            </button>
          </form>
        </div>
      )}

      <section className="mb-6">
        <p className="text-sm text-gray-500">Your balance</p>
        <p
          className={`font-display text-[32px] font-semibold leading-tight tracking-tight tabular-nums ${
            mine > 0 ? "text-owed" : mine < 0 ? "text-owe" : ""
          }`}
        >
          {mine > 0 ? `You’re owed ${money(mine)}` : mine < 0 ? `You owe ${money(-mine)}` : "All square"}
        </p>
        {(expenses.length > 0 || v.payments.length > 0) && (
          <div className="mt-3 flex items-center gap-3">
            {v.transfers.length > 0 && !group.closed && (
              <Link href={`/groups/${group.id}/settle`} className="pop bg-fg px-5 py-2.5 text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
                Settle up
              </Link>
            )}
            <Link href={`/groups/${group.id}?tab=balances&why=${myId}#why-${myId}`} className="text-sm font-medium text-fg underline underline-offset-4">
              Why?
            </Link>
          </div>
        )}
        {mine !== 0 && eq(mine) && <p className="font-display text-lg tabular-nums text-gray-500">{eq(mine)}</p>}
        {sp.saved === "settings" && <p className="mt-2 text-sm text-accent-dark">Settings saved. Everyone in the group has been notified.</p>}
        {sp.error && <p className="mt-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{sp.error}</p>}
        {sp.added !== undefined && (
          <p className="mt-2 text-sm text-accent-dark">
            {Number(sp.added) === 1 ? "1 person added." : `${Number(sp.added) || 0} people added.`}
            {sp.skipped && <span className="text-gray-600"> Already in the group: {sp.skipped}.</span>}
          </p>
        )}
      </section>
    </>
  );
}
