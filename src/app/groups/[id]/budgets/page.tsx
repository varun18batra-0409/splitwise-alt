import { ExpenseGlyph } from "@/components/ExpenseGlyph";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { ErrorNote, PageHeader, primaryButtonClass } from "@/components/ui";
import { saveBudgets } from "@/app/bill-actions";
import { BUDGET_CATEGORIES } from "@/lib/home/budgets";
import { getCategory } from "@/lib/categories";
import { toInputAmount } from "@/lib/money";

// Monthly budgets: an amount per category (blank = no budget).
export default async function BudgetsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const group = await db.group.findUnique({ where: { id }, include: { budgets: true, members: { select: { id: true } } } });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  const amountOf = (c: string) => {
    const b = group.budgets.find((x) => x.category === c);
    return b ? toInputAmount(b.amount, group.currency) : "";
  };
  return (
    <>
      <PageHeader title="Monthly budgets" back={`/groups/${group.id}`} />
      <p className="-mt-3 mb-6 text-sm text-gray-500">Set a limit for what matters. Everyone gets a nudge at 80% and if it goes over. Leave blank for no budget.</p>
      {error && <ErrorNote>{error.slice(0, 160)}</ErrorNote>}
      <form action={saveBudgets} className="space-y-6">
        <input type="hidden" name="groupId" value={group.id} />
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {BUDGET_CATEGORIES.map((c) => {
            const cat = getCategory(c);
            return (
              <li key={c}>
                <label className="flex items-center gap-3 px-4 py-3">
                  <ExpenseGlyph title="" category={c} size={34} />
                  <span className="flex-1">{cat.label}</span>
                  <span className="flex w-32 items-center rounded-xl border border-line px-3 focus-within:border-accent">
                    <span className="text-xs text-gray-400">{group.currency}</span>
                    <input name={`b_${c}`} inputMode="decimal" defaultValue={amountOf(c)} placeholder="—" aria-label={`${cat.label} budget`} className="w-full bg-transparent py-2 text-right outline-none" />
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <button type="submit" className={primaryButtonClass}>
          Save budgets
        </button>
      </form>
    </>
  );
}
