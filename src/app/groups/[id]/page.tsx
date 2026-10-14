import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { formatMoney } from "@/lib/money";
import { getCategory } from "@/lib/categories";
import { Avatar, PageHeader } from "@/components/ui";
import { ShareInvite } from "@/components/ShareInvite";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
      <PageHeader title={group.name} back="/" />

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
              return (
                <li key={e.id} className="flex items-center gap-3 py-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-xl" title={cat.label}>
                    {cat.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{e.description}</p>
                    <p className="text-sm text-gray-400">
                      {nameOf(e.paidById)} paid {money(e.amount)}
                    </p>
                  </div>
                  <span className={`shrink-0 text-right text-sm ${note.cls}`}>{note.text}</span>
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
      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-400">
          People · {group.members.length}
        </h2>
        <ul className="mb-4 divide-y divide-gray-100">
          {group.members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-3">
              <Avatar name={m.name} />
              <span className="font-medium">{m.name}</span>
              {m.id === myId && <span className="text-sm text-gray-400">(you)</span>}
            </li>
          ))}
        </ul>
        <ShareInvite code={group.inviteCode} groupName={group.name} />
        <Link href={`/join/${group.inviteCode}`} className="mt-2 inline-block py-2 text-sm text-gray-400">
          Not you? Switch person
        </Link>
      </section>
    </>
  );
}
