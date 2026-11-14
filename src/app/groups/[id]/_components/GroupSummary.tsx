import Link from "@/components/Link";
import { niceDate } from "@/lib/format";
import { dayKey } from "@/lib/dates";
import { setGroupClosed } from "@/app/actions";
import { exactMoney } from "@/lib/money-display";
import { ActionButton, Amount, CREAM, OUTLINE, PassFields, PassRoute, SquareBody, TicketShell } from "@/components/HomeMoney";
import { PassStack } from "@/components/PassStack";
import { amountTier, clearsLine, groupTicketSides, initialOf, orderPasses, passFields, sideCodes, type GroupFacts, type GroupSide } from "@/lib/home/money-card";
import type { GroupView } from "./view";

// The closed banner: on every tab of a group that was closed.
export function ClosedBanner({ v }: { v: GroupView }) {
  const { group, expenses } = v;
  if (!group.closed) return null;
  return (
    <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl bg-mist px-4 py-3 text-sm">
      <span className="text-gray-600">
        Closed{group.closedAt ? ` on ${niceDate(dayKey(group.closedAt, v.tz))}` : ""}. History stays here; new expenses are paused.{" "}
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
  );
}

// One side of the group's money as a boarding pass: the SAME pass Home draws (TicketShell, PassRoute, Amount, PassFields, ActionButton from
// HomeMoney), with the group's picture left out of the stub (it is on the page above): the other people's initials on paper instead.
// The amount is exact, paise included: the figure Settle up and the People tab show. Nothing is worked out here.
function GroupPass({ v, side, facts, bright, settle, note, year }: { v: GroupView; side: GroupSide; facts: GroupFacts; bright: boolean; settle: boolean; note: string | null; year: string }) {
  const { group, myId, money } = v;
  const codes = sideCodes(side.side, side.names);
  const text = exactMoney(side.amount, group.currency);
  const settleHref = `/groups/${group.id}/settle`;
  const initials = [...new Set(side.names.map(initialOf))].slice(0, 3);
  const hasHistory = v.expenses.length > 0 || v.payments.length > 0;
  const fields = [
    ...(side.names.length > 0 ? [{ key: "payments" as const, label: "Payments", value: String(side.names.length) }] : []),
    ...passFields({ groupNames: [], since: facts.since, items: facts.items, thisYear: year }),
  ];
  return (
    <TicketShell
      stub={[]}
      paper={initials.length ? initials : ["?"]}
      label={side.side === "owe" ? "What you owe in this group" : "What you are owed in this group"}
      attrs={{ "data-ticket-line": side.side }}
      barcode
    >
      <PassRoute from={codes.from} to={codes.to} />
      <Amount text={text} exact={money(side.amount)} tone={side.side} tier={amountTier(text)} />
      {note && <p className="money mt-0.5 text-[13.5px] text-fg/50">{note}</p>}
      {hasHistory && (
        <Link href={`/groups/${group.id}?tab=balances&why=${myId}#why-${myId}`} className="flex min-h-11 items-center self-start text-[13.5px] font-medium text-fg/75 underline underline-offset-4 active:opacity-70" data-breakdown>
          See breakdown
        </Link>
      )}
      <PassFields fields={fields} />
      {settle && (
        <div className="mt-auto pt-3">
          <ActionButton a={{ key: "settle", label: "Settle up", fullLabel: "Settle up", href: settleHref, bright }} className={`${bright ? CREAM : OUTLINE} w-full`} />
        </div>
      )}
    </TicketShell>
  );
}

// The group's money ticket: your balance in this group, as the same boarding pass Home has. One side: one pass. Money both ways: two passes
// in the same swipeable stack, the larger first, never netted together. Nothing owed: the settled pass.
export function MoneyTicket({ v, facts }: { v: GroupView; facts: GroupFacts }) {
  const { group, myId, net, expenses } = v;
  const mine = net[myId] ?? 0;
  const sides = groupTicketSides({ mine, myId, transfers: v.transfers, nameOf: v.nameOf });
  const hasHistory = expenses.length > 0 || v.payments.length > 0;
  const settle = v.transfers.length > 0 && !group.closed && hasHistory;
  const kind = sides.length === 2 ? "both" : sides.length === 1 ? "one" : "square";
  const year = dayKey(new Date(), v.tz).slice(0, 4);
  // "≈ THB 908" under the amount, only when there is one side (it is that side's amount).
  const note = sides.length === 1 && mine !== 0 ? v.eq(mine) : null;
  const attrs = { "data-group-balance": "", "data-ticket": kind, "data-tone": sides.length === 1 ? sides[0].side : "square" };

  return (
    <section className="mb-5">
      {sides.length === 2 ? (
        <PassStack label="Your money in this group, two passes" attrs={attrs}>
          {orderPasses(sides.map((s) => ({ ...s, weight: s.amount })) as [GroupSide & { weight: number }, GroupSide & { weight: number }]).map((s, i) => (
            <GroupPass key={s.side} v={v} side={s} facts={facts} bright={i === 0} settle={settle} note={null} year={year} />
          ))}
        </PassStack>
      ) : sides.length === 1 ? (
        <div {...attrs}>
          <GroupPass v={v} side={sides[0]} facts={facts} bright settle={settle} note={note} year={year} />
        </div>
      ) : (
        <TicketShell stub={[]} paper={[initialOf(group.name)]} label="Your balance in this group" attrs={attrs} barcode>
          <SquareBody amount="All square" label={clearsLine(0)} addHref={group.closed || v.leaver ? undefined : `/groups/${group.id}/add`} title="Your balance" />
        </TicketShell>
      )}
    </section>
  );
}
