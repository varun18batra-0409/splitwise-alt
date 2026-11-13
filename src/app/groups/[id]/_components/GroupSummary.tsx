import Link from "@/components/Link";
import { niceDate } from "@/lib/format";
import { dayKey } from "@/lib/dates";
import { Notice } from "@/components/Notice";
import { setGroupClosed } from "@/app/actions";
import { overviewMoney } from "@/lib/money-display";
import { coverFor } from "@/lib/covers";
import { tripPhotoSrc } from "@/lib/places";
import { ActionButton, Amount, BothLine, CREAM, Route, TicketShell, type BothLineData } from "@/components/HomeMoney";
import { amountTier, clearsLine, firstName, groupMark, groupTicketSides, routeEnds, type GroupSide } from "@/lib/home/money-card";
import type { GroupView } from "./view";

type Notices = { saved?: string; error?: string; added?: string; skipped?: string };

// The top of a group, kept short: closed banner, your balance, Settle up and
// Why?, and notices. Details (other currencies, totals, card fee) live in Balances.
export function GroupSummary({ v, sp, compact }: { v: GroupView; sp: Notices; compact?: boolean }) {
  const { group, myId, net, money, eq, expenses } = v;
  const mine = net[myId] ?? 0;

  // The ticket. The amounts are the same ones the page showed before (your balance, whole rupees from 1,000, the exact one on tap);
  // only the sides are decided here (who you pay / who pays you).
  const sides = groupTicketSides({ mine, myId, transfers: v.transfers, nameOf: v.nameOf });
  const mark = groupMark(group.type);
  const shown = (n: number) => overviewMoney(n, group.currency);
  const hasHistory = expenses.length > 0 || v.payments.length > 0;
  const settle = v.transfers.length > 0 && !group.closed && hasHistory;
  const settleHref = `/groups/${group.id}/settle`;
  const routeFor = (s: GroupSide) => routeEnds(s.side, s.names.length ? s.names.map(firstName) : ["the group"], "people");
  const bothLine = (s: GroupSide): BothLineData => {
    const count = Math.max(1, s.names.length);
    const name = count === 1 ? firstName(s.names[0] ?? "") : `${count} people`;
    return { side: s.side, count, phrase: s.side === "owe" ? `You owe ${name}` : count === 1 ? `${name} owes you` : `${name} owe you`, name, amount: shown(s.amount), exact: money(s.amount), faces: [], peopleHref: settleHref };
  };
  // One quiet line: how many payments clear it all, and the "Why?" link (it opens your balance's explanation in Balances).
  const context = (
    <p className="mt-1.5 flex min-w-0 items-baseline gap-1.5 whitespace-nowrap text-[13.5px] leading-snug text-fg/55" data-ticket-context>
      <span className="min-w-0 truncate">{clearsLine(v.transfers.length, group.type)}</span>
      {hasHistory && (
        <>
          <span aria-hidden className="shrink-0">·</span>
          <Link href={`/groups/${group.id}?tab=balances&why=${myId}#why-${myId}`} className="shrink-0 text-[12.5px] font-semibold text-fg underline underline-offset-4">
            Why?
          </Link>
        </>
      )}
    </p>
  );

  return (
    <>
      {group.closed && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl bg-mist px-4 py-3 text-sm">
          <span className="text-gray-600">
            Closed{group.closedAt ? ` on ${niceDate(dayKey(group.closedAt, v.tz))}` : ""}. History stays here; new expenses are
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
          <TicketShell
            stub={[{ id: group.id, cover: coverFor(group), photo: tripPhotoSrc(group), name: group.name }]}
            label="Your balance in this group"
            attrs={{ "data-group-balance": "", "data-ticket": sides.length === 2 ? "both" : sides.length === 1 ? "one" : "square", "data-tone": sides.length === 1 ? sides[0].side : "square" }}
          >
            {sides.length === 2 ? (
              <div className="flex flex-1 flex-col justify-center" data-ticket-both>
                {sides.map((s) => (
                  <BothLine key={s.side} line={bothLine(s)} />
                ))}
                {context}
              </div>
            ) : sides.length === 1 ? (
              <>
                <Route {...routeFor(sides[0])} mark={mark} />
                <Amount text={shown(sides[0].amount)} exact={money(sides[0].amount)} tone={sides[0].side} tier={amountTier(shown(sides[0].amount))} />
                {mine !== 0 && eq(mine) && <p className="money mt-0.5 text-[13.5px] text-fg/50">{eq(mine)}</p>}
                {context}
                {settle && (
                  <div className="mt-auto pt-3">
                    <ActionButton a={{ key: "settle", label: "Settle up", fullLabel: "Settle up", href: settleHref, bright: true }} className={`${CREAM} w-full`} />
                  </div>
                )}
              </>
            ) : (
              <div className="my-auto">
                <Amount text="All square" tone="plain" tier="l" />
                {context}
              </div>
            )}
            {sides.length === 2 && settle && (
              <div className="pt-3">
                <ActionButton a={{ key: "settle", label: "Settle up", fullLabel: "Settle up", href: settleHref, bright: true }} className={`${CREAM} w-full`} />
              </div>
            )}
          </TicketShell>
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
