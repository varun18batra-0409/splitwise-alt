import Link from "@/components/Link";
import { FocusOnShow } from "@/components/FocusOnShow";
import { notFound, redirect } from "next/navigation";
import { getMyMemberId, privatePath } from "@/lib/identity";
import { loadGroup } from "@/lib/group-data";
import { formatMoney, parseAmount, PAYMENT_LINE, toInputAmount } from "@/lib/money";
import { overpayQuestion } from "@/lib/pay-record";
import { defaultPayment } from "@/lib/pay-default";
import { RecordPaymentForm } from "@/components/RecordPaymentForm";
import { Mark } from "@/components/HomeMoney";
import { groupMark } from "@/lib/home/money-card";
import { FreshKey } from "@/components/FreshKey";
import { ErrorNote, PageHeader } from "@/components/ui";

// Record that one person paid another back — any amount, full or part.
// Smart Settle's suggestions are offered as one-tap fill-ins.
export default async function RecordPayment({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; amount?: string; error?: string; owes?: string; side?: string; back?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const data = await loadGroup(id, { events: false, viewer: await getMyMemberId(id) });
  if (!data) notFound();
  const { group, transfers, net } = data;
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(await privatePath(id));

  const people = group.members.filter((m) => !m.leftAt); // people who left aren't offered
  const isMember = (x?: string) => Boolean(x && people.some((m) => m.id === x));
  // Opened with nothing filled in while you're owed: start from the top suggestion to you.
  const pre = !sp.from && !sp.to && !sp.amount ? defaultPayment(transfers, myId, net[myId] ?? 0, isMember) : null;
  const qFrom = sp.from ?? pre?.from;
  const qTo = sp.to ?? pre?.to;
  const qAmount = sp.amount ?? (pre ? toInputAmount(pre.amount, group.currency) : "");
  const from = isMember(qFrom) ? qFrom! : myId;
  const to = isMember(qTo) && qTo !== from ? qTo! : "";
  const nameOf = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const money = (m: number) => formatMoney(m, group.currency);
  const fill = (f: string, t: string, a: number) =>
    `/groups/${group.id}/pay?${new URLSearchParams({ from: f, to: t, amount: toInputAmount(a, group.currency) })}`;

  const fromSettle = sp.back === "settle";
  const owes = /^\d{1,12}$/.test(sp.owes ?? "") ? Number(sp.owes) : null;
  const typed = parseAmount(sp.amount ?? "", group.currency);
  // More than the payer owes (often an extra zero): asked once, with Cancel first.
  // `owes` is the most that can be paid without either person flipping to the other side; `side` says who sets that limit.
  const side = sp.side === "to" ? "to" : "from";
  const plain = (mid: string) => group.members.find((m) => m.id === mid)?.name ?? "Someone";
  const overLine = owes !== null && typed !== null ? overpayQuestion({ typed, limit: owes, side, currency: group.currency, fromName: plain(from), toName: plain(sp.to ?? "") }) : null;
  const cancelHref = `/groups/${group.id}/pay?${new URLSearchParams({ from, ...(to ? { to } : {}), amount: sp.amount ?? "", ...(fromSettle ? { back: "settle" } : {}) })}`;
  return (
    <>
      <PageHeader title="Record a payment" back={fromSettle ? `/groups/${group.id}/settle` : `/groups/${group.id}?tab=balances`} />
      {sp.error && <ErrorNote>{sp.error}</ErrorNote>}

      <RecordPaymentForm
        groupId={group.id}
        currency={group.currency}
        people={people.map((m) => ({ id: m.id, name: m.name, me: m.id === myId, gets: net[m.id] > 0 ? money(net[m.id]) : "" }))}
        defaultFrom={from}
        defaultTo={to}
        defaultAmount={qAmount}
        fromSettle={fromSettle}
        keyField={<FreshKey name="rid" />}
        mark={<Mark mark={groupMark(group.type)} />}
        overLine={overLine}
        cancel={
          <FocusOnShow>
            <Link href={cancelHref} className="pop inline-flex min-h-11 items-center bg-fg px-5 text-sm font-semibold text-canvas" data-over-cancel>
              Cancel
            </Link>
          </FocusOnShow>
        }
        note={PAYMENT_LINE}
      >
        {transfers.length > 0 && (
          <section aria-label="Smart Settle suggests">
            <p className="mb-1 text-[13px] text-fg/55">Smart Settle suggests</p>
            <ul className="divide-y divide-[#26262c]">
              {transfers.map((t) => (
                <li key={`${t.from}-${t.to}`}>
                  <Link href={fill(t.from, t.to, t.amount)} className="flex min-h-11 items-center justify-between gap-3 py-2 text-[14px] active:opacity-70">
                    <span className="min-w-0 truncate">
                      {nameOf(t.from)} → {t.to === myId ? "you" : nameOf(t.to)}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(t.amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </RecordPaymentForm>
    </>
  );
}
