import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { formatMoney, formatPercent } from "@/lib/money";
import { niceDate, rateText } from "@/lib/format";
import { getCategory } from "@/lib/categories";
import { Avatar, PageHeader, primaryButtonClass } from "@/components/ui";
import { ShareInvite } from "@/components/ShareInvite";
import { MemberInputs } from "@/components/MemberInputs";
import { addMembers } from "@/app/actions";

const PAID_WITH: Record<string, string> = { card: "Card", cash: "Cash", bank: "Bank / UPI" };
const FOR_MODE: Record<string, string> = { everyone: "Everyone", selected: "Selected people", one: "One person" };

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; added?: string; skipped?: string }>;
}) {
  const { id } = await params;
  const { saved, added, skipped } = await searchParams;
  const group = await db.group.findUnique({
    where: { id },
    include: {
      members: { orderBy: { createdAt: "asc" } },
      expenses: { orderBy: { createdAt: "desc" }, include: { shares: true } },
    },
  });
  if (!group) notFound();

  // If this phone hasn't said who it is in this group yet, ask first.
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) {
    redirect(`/join/${group.inviteCode}`);
  }

  const money = (p: number) => formatMoney(p, group.currency);
  const nameOf = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");

  // Spending by category, biggest first.
  const totals = new Map<string, number>();
  for (const e of group.expenses) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
  const byCategory = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const groupTotal = byCategory.reduce((s, [, v]) => s + v, 0);

  return (
    <>
      <PageHeader title={group.name} back="/" action={{ href: `/groups/${group.id}/settings`, label: "Group settings", icon: "⚙️" }} />

      <Link
        href={`/groups/${group.id}/settings`}
        className="-mt-6 mb-8 block text-sm text-gray-400"
      >
        Group currency {group.currency} · Card markup {formatPercent(group.cardMarkupBp)}
        {saved === "settings" && <span className="ml-2 text-accent-dark">✓ Saved</span>}
      </Link>

      {/* Expenses */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-400">Expenses</h2>
        {group.expenses.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
            No expenses yet. Tap <span className="font-medium text-accent">+ Add expense</span> below.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {group.expenses.map((e) => {
              const cat = getCategory(e.category);
              const myShare = e.shares.find((s) => s.memberId === myId)?.amount ?? 0;
              const iPaid = e.paidById === myId;
              const note = iPaid
                ? e.amount - myShare > 0
                  ? { text: `you lent ${money(e.amount - myShare)}`, cls: "text-accent-dark" }
                  : { text: "just you", cls: "text-gray-400" }
                : myShare > 0
                  ? { text: `you owe ${money(myShare)}`, cls: "text-orange-600" }
                  : { text: "not involved", cls: "text-gray-400" };
              const foreign = e.originalCurrency !== e.baseCurrency;
              return (
                <li key={e.id}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-xl" title={cat.label}>
                        {cat.emoji}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{e.description}</p>
                        <p className="truncate text-sm text-gray-400">
                          {nameOf(e.paidById)} paid {money(e.amount)}
                          {foreign && ` · ${formatMoney(e.originalAmount, e.originalCurrency)}`}
                        </p>
                      </div>
                      <span className={`shrink-0 text-right text-sm ${note.cls}`}>{note.text}</span>
                    </summary>

                    {/* Tap an expense to see exactly how it was worked out. */}
                    <div className="mb-3 ml-[3.25rem] space-y-1.5 rounded-xl bg-gray-50 p-3 text-sm text-gray-600">
                      <Line label="Category" value={`${cat.emoji} ${cat.label}`} />
                      {foreign && (
                        <>
                          <Line label="Original expense" value={formatMoney(e.originalAmount, e.originalCurrency)} />
                          <Line
                            label="Exchange rate"
                            value={`1 ${e.originalCurrency} = ${rateText(e.exchangeRate, e.baseCurrency)}`}
                          />
                          <p className="-mt-1 text-right text-xs text-gray-400">
                            {e.rateSource === "manual" ? "Entered by hand" : "Live rate"}
                            {e.rateDate && `, ${niceDate(e.rateDate)}`}
                          </p>
                          <Line label="Paid with" value={PAID_WITH[e.paymentMethod] ?? "—"} />
                          <Line label="Converted amount" value={money(e.convertedAmount)} />
                          {e.paymentMethod === "card" && (
                            <Line label={`Card markup (${formatPercent(e.markupBp)})`} value={money(e.markupAmount)} />
                          )}
                        </>
                      )}
                      <Line label="Total group expense" value={money(e.amount)} strong />
                      <div className="border-t border-gray-200 pt-1.5">
                        <Line label="Paid by" value={nameOf(e.paidById)} />
                        <Line label="For" value={FOR_MODE[e.forMode] ?? "Everyone"} />
                        {e.shares.map((sh) => (
                          <Line key={sh.id} label={`  ${nameOf(sh.memberId)}’s share`} value={money(sh.amount)} />
                        ))}
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Spending by category */}
      {byCategory.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 flex justify-between text-sm font-medium uppercase tracking-wide text-gray-400">
            <span>Spending by category</span>
            <span className="normal-case tracking-normal text-gray-500">{money(groupTotal)}</span>
          </h2>
          <ul className="space-y-3">
            {byCategory.map(([cid, total]) => {
              const cat = getCategory(cid);
              const pct = Math.round((total / groupTotal) * 100);
              return (
                <li key={cid}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>
                      {cat.emoji} {cat.label}
                    </span>
                    <span className="text-gray-500">
                      {money(total)} · {pct}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100">
                    <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* People + invite */}
      <section id="people" className="mt-10 scroll-mt-6">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-400">
          People · {group.members.length}
        </h2>
        {added !== undefined && (
          <p className="mb-3 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent-dark">
            {Number(added) === 1 ? "1 person added." : `${Number(added) || 0} people added.`}
            {skipped && <span className="text-gray-600"> Already in the group: {skipped}.</span>}
          </p>
        )}
        <ul className="mb-4 divide-y divide-gray-100">
          {group.members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-3">
              <Avatar name={m.name} />
              <span className="min-w-0">
                <span className="font-medium">{m.name}</span>
                {m.id === myId && <span className="text-sm text-gray-400"> (you)</span>}
                {m.phone && <span className="block text-xs text-gray-400">{m.phone}</span>}
              </span>
            </li>
          ))}
        </ul>

        {/* Add people by typing names or picking from the phone's contacts */}
        <details className="mb-4 rounded-2xl border border-gray-100">
          <summary className="cursor-pointer list-none px-4 py-3.5 text-sm font-medium text-accent [&::-webkit-details-marker]:hidden">
            + Add people
          </summary>
          <form action={addMembers} className="space-y-4 border-t border-gray-100 p-4">
            <input type="hidden" name="groupId" value={group.id} />
            <MemberInputs firstPlaceholderNumber={group.members.length + 1} />
            <button type="submit" className={primaryButtonClass}>
              Add to group
            </button>
          </form>
        </details>

        <ShareInvite code={group.inviteCode} groupName={group.name} />
        <Link href={`/join/${group.inviteCode}`} className="mt-2 inline-block py-2 text-sm text-gray-400">
          Not you? Switch person
        </Link>
      </section>
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={`flex justify-between gap-3 ${strong ? "font-semibold text-gray-900" : ""}`}>
      <span className="whitespace-pre">{label}</span>
      <span className="text-right">{value}</span>
    </p>
  );
}
