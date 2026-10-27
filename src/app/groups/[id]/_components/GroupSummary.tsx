import Link from "@/components/Link";
import { niceDate } from "@/lib/format";
import { Notice } from "@/components/Notice";
import { setGroupClosed } from "@/app/actions";
import type { GroupView } from "./view";

type Notices = { saved?: string; error?: string; added?: string; skipped?: string };

// The top of a group, kept short: closed banner, your balance, Settle up and
// Why?, and notices. Details (other currencies, totals, card fee) live in Balances.
export function GroupSummary({ v, sp, compact }: { v: GroupView; sp: Notices; compact?: boolean }) {
  const { group, myId, net, money, eq, expenses } = v;
  const mine = net[myId] ?? 0;

  return (
    <>
      {group.closed && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl bg-mist px-4 py-3 text-sm">
          <span className="text-gray-600">
            Closed{group.closedAt ? ` on ${niceDate(group.closedAt.toISOString().slice(0, 10))}` : ""}. History stays here; new expenses are
            paused.{" "}
            {expenses.length > 0 && (
              <Link href={`/groups/${group.id}/report`} className="font-medium text-fg underline underline-offset-4">
                {group.type === "trip" ? "Trip report" : "Report"}
              </Link>
            )}
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
        {/* Home and Couple groups show the balance on This month instead. */}
        {!compact && (
          <div className="glass rounded-[26px] px-[18px] py-4" data-group-balance>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-fg/65">{mine > 0 ? "You’re owed" : mine < 0 ? "You owe" : "Your balance"}</p>
                <p className={`money whitespace-nowrap leading-[1.1] ${amountSize(mine === 0 ? "All square" : money(Math.abs(mine)))} ${mine > 0 ? "text-owed" : mine < 0 ? "text-owe" : ""}`}>{mine === 0 ? "All square" : money(Math.abs(mine))}</p>
              </div>
              {v.transfers.length > 0 && !group.closed && (expenses.length > 0 || v.payments.length > 0) && (
                <Link href={`/groups/${group.id}/settle`} className="pop flex h-11 shrink-0 items-center bg-fg px-5 text-[15px] font-semibold text-canvas">
                  Settle up
                </Link>
              )}
            </div>
            {mine !== 0 && eq(mine) && <p className="money text-[15px] text-fg/50">{eq(mine)}</p>}
            {(expenses.length > 0 || v.payments.length > 0) && (
              <p className="mt-1 text-[13px] leading-snug text-fg/55">
                {summaryLine(v)}{" "}
                <Link href={`/groups/${group.id}?tab=balances&why=${myId}#why-${myId}`} className="font-semibold text-fg underline underline-offset-4">
                  Why?
                </Link>
              </p>
            )}
          </div>
        )}
        {sp.saved === "settings" && <p className="mt-2 text-sm text-accent-dark">Settings saved. Everyone in the group has been notified.</p>}
        {sp.error && <Notice tone="error" params={["error"]} className="mt-2">{sp.error}</Notice>}
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

// One plain line under the balance: who owes you (or whom you owe), and how many payments clear it all.
function summaryLine(v: GroupView): string {
  const { myId, transfers, nameOf } = v;
  const first = (id: string) => nameOf(id).trim().split(/\s+/)[0];
  const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
  const toMe = transfers.filter((t) => t.to === myId).map((t) => first(t.from));
  const fromMe = transfers.filter((t) => t.from === myId).map((t) => first(t.to));
  const clear = transfers.length === 0 ? "Nobody owes anybody." : `${transfers.length === 1 ? "1 payment clears" : `${transfers.length} payments clear`} everything.`;
  if (toMe.length) return `${list(toMe)} ${toMe.length === 1 ? "owes" : "owe"} you. ${clear}`;
  if (fromMe.length) return `You pay ${list(fromMe)}. ${clear}`;
  return clear;
}

// The big number shrinks as it gets longer, so it always fits beside Settle up (₹17,618.19 on a small phone).
function amountSize(text: string): string {
  return text.length <= 7 ? "text-[38px]" : text.length <= 9 ? "text-[32px]" : text.length <= 11 ? "text-[27px]" : "text-[23px]";
}
