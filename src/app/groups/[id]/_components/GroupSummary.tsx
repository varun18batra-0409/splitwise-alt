import Link from "@/components/Link";
import { niceDate } from "@/lib/format";
import { dayKey } from "@/lib/dates";
import { setGroupClosed } from "@/app/actions";
import { exactMoney } from "@/lib/money-display";
import { leaverMoneyLine, settleHeadline } from "@/lib/settle-ui";
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
  const text = mine === 0 ? "All square" : exactMoney(Math.abs(mine), group.currency);
  const tone = mine > 0 ? "owed" : mine < 0 ? "owe" : "square";
  return (
    <section className="mb-5">
      <div className="glass rounded-[26px] px-[18px] py-4" data-group-balance data-ticket={mine === 0 ? "square" : "one"} data-tone={tone}>
        {/* Wraps: on a narrow phone Settle up drops under the amount instead of touching it. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 max-w-full">
            <p className="text-sm text-fg/65">{mine > 0 ? "You’re owed" : mine < 0 ? "You owe" : "Your balance"}</p>
            <p className={`money whitespace-nowrap leading-[1.1] ${amountSize(text)} ${mine > 0 ? "text-owed" : mine < 0 ? "text-owe" : ""}`} data-net-balance title={mine === 0 ? undefined : money(Math.abs(mine))}>
              {text}
            </p>
          </div>
          {settle && (
            <Link href={`/groups/${group.id}/settle`} className="pop flex h-11 shrink-0 items-center bg-fg px-5 text-[15px] font-semibold text-canvas" data-money-action="settle">
              Settle up
            </Link>
          )}
        </div>
        {mine !== 0 && v.eq(mine) && <p className="money text-[15px] text-fg/50">{v.eq(mine)}</p>}
        {hasHistory && (
          <p className="mt-1 text-[13px] leading-snug text-fg/55" data-summary-line>
            {summaryLine(v)}{" "}
            <Link href={`/groups/${group.id}?tab=balances&why=${myId}#why-${myId}`} className="font-semibold text-fg underline underline-offset-4" data-why>
              Why?
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}

// One plain line under the balance: who owes you (or whom you owe), and how many payments clear it all.
function summaryLine(v: LiteView): string {
  const { myId, transfers, nameOf } = v;
  const first = (id: string) => nameOf(id).trim().split(/\s+/)[0];
  const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
  const toMe = transfers.filter((t) => t.to === myId).map((t) => first(t.from));
  const fromMe = transfers.filter((t) => t.from === myId).map((t) => first(t.to));
  // Someone who left hears only about their own side (never "N payments clear everything").
  if (v.leaver) return leaverMoneyLine(transfers, myId, first, v.money);
  const clear = transfers.length === 0 ? (v.leaver ? settleHeadline({ leaver: true }).line : "Nobody owes anybody.") : `${transfers.length === 1 ? "1 payment clears" : `${transfers.length} payments clear`} everything.`;
  if (toMe.length) return `${list(toMe)} ${toMe.length === 1 ? "owes" : "owe"} you. ${clear}`;
  if (fromMe.length) return `You pay ${list(fromMe)}. ${clear}`;
  return clear;
}

// The big number shrinks as it gets longer, so it always fits beside Settle up (₹17,618.19 on a small phone).
function amountSize(text: string): string {
  return text.length <= 7 ? "text-[38px]" : text.length <= 9 ? "text-[32px]" : text.length <= 11 ? "text-[27px]" : "text-[23px]";
}
