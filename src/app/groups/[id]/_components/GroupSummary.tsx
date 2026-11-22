import Link from "@/components/Link";
import { niceDate } from "@/lib/format";
import { dayKey } from "@/lib/dates";
import { setGroupClosed } from "@/app/actions";
import { MoneyCard } from "@/components/MoneyCard";
import { balanceParts, summaryLine } from "@/lib/group-summary-text";
import type { GroupFacts } from "@/lib/home/money-card";
import type { LiteView } from "./view";

// The closed banner: on every tab of a group that was closed.
export function ClosedBanner({ v }: { v: LiteView }) {
  const { group, expenses } = v;
  if (!group.closed) return null;
  return (
    <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl bg-mist px-4 py-3 text-sm">
      <span className="text-gray-600">
        Closed{group.closedAt ? ` on ${niceDate(dayKey(group.closedAt, v.tz))}` : ""}. History stays here; new expenses are paused.{" "}
        {expenses.length > 0 && (
          <Link href={`/groups/${group.id}/report`} className="font-medium text-fg underline underline-offset-4">
            {group.type === "trip" ? "Trip report" : "Group report"}
          </Link>
        )}
      </span>
      {/* Reopening is for people still in the group: the server refuses someone who left. */}
      {!v.leaver && (
        <form action={setGroupClosed} className="shrink-0">
          <input type="hidden" name="groupId" value={group.id} />
          <input type="hidden" name="closed" value="0" />
          <button type="submit" className="shrink-0 whitespace-nowrap font-medium text-accent [overflow-wrap:normal]">
            Reopen
          </button>
        </form>
      )}
    </div>
  );
}

// The group's money box, as it was before the mockups (founder, 15 Nov: "you are owed should be from before your mock up screen"):
// one rounded card with "You're owed" (or "You owe" / "Your balance"), the exact amount in green or orange, ONE cream Settle up on the
// right, and one plain line under it: who owes whom and how many payments clear everything, with "Why?". No boarding pass here.
// The amount is exact, paise included: the same figure Settle up and the People tab show. Nothing is worked out here.
export function MoneyTicket({ v, facts: _facts }: { v: LiteView; facts?: GroupFacts }) {
  const { group, myId, net, expenses, money } = v;
  const mine = net[myId] ?? 0;
  const hasHistory = expenses.length > 0 || v.payments.length > 0;
  const settle = v.transfers.length > 0 && !group.closed && hasHistory;
  const { text, tone, label } = balanceParts(mine, group.currency);
  return (
    <MoneyCard
      label={label}
      text={text}
      tone={tone}
      square={mine === 0}
      title={mine === 0 ? undefined : money(Math.abs(mine))}
      eq={mine !== 0 ? v.eq(mine) : null}
      action={
        settle ? (
          <Link href={`/groups/${group.id}/settle`} className="pop flex h-11 shrink-0 items-center bg-fg px-5 text-[15px] font-semibold text-canvas" data-money-action="settle">
            Settle up
          </Link>
        ) : null
      }
      line={
        hasHistory ? (
          <p className="mt-1 text-[13px] leading-snug text-fg/55" data-summary-line>
            {summaryLine(v)}{" "}
            <Link href={`/groups/${group.id}?tab=balances&why=${myId}#why-${myId}`} className="font-semibold text-fg underline underline-offset-4" data-why>
              Why?
            </Link>
          </p>
        ) : null
      }
    />
  );
}

