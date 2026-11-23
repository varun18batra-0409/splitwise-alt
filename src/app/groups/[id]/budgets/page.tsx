import { AmountInput } from "@/components/AmountInput";
import { ExpenseGlyph } from "@/components/ExpenseGlyph";
import { bounceIfDirect } from "@/lib/direct-db";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId, privatePath } from "@/lib/identity";
import { ErrorNote, PageHeader, primaryButtonClass } from "@/components/ui";
import { saveBudgets } from "@/app/bill-actions";
import { BUDGET_CATEGORIES, budgetFormKey } from "@/lib/home/budgets";
import { getCategory } from "@/lib/categories";
import { toInputAmount } from "@/lib/money";
import { leaverOf } from "@/lib/left-view-db";
import { readNotes } from "@/lib/flash";

// Monthly budgets: an amount per category (blank = no budget).
export default async function BudgetsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  await bounceIfDirect(id); // a pair of two people has no group screens: its person page instead
  const sp = await searchParams;
  const notes = await readNotes(sp, `/groups/${id}/budgets`);
  const group = await db.group.findUnique({ where: { id }, include: { budgets: true, members: { select: { id: true } } } });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(await privatePath(id));
  // Someone who left (or was removed) reads the group only on its main screen, up to the day they left.
  if (await leaverOf(myId)) redirect(`/groups/${group.id}`);
  const amountOf = (c: string) => {
    const b = group.budgets.find((x) => x.category === c);
    return b ? toInputAmount(b.amount, group.currency) : "";
  };
  return (
    <>
      <PageHeader title="Monthly budgets" back={`/groups/${group.id}`} />
      <p className="-mt-3 mb-6 text-sm text-gray-500">Set a limit for what matters. Everyone gets a nudge at 80% and if it goes over. Leave blank for no budget.</p>
      {notes.error && <ErrorNote>{notes.error.slice(0, 160)}</ErrorNote>}
      <form key={`${group.currency}|${budgetFormKey(Object.fromEntries(group.budgets.map((b) => [b.category, String(b.amount)])))}`} action={saveBudgets} className="space-y-6">
        <input type="hidden" name="groupId" value={group.id} />
        <input type="hidden" name="currency" value={group.currency} />
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {BUDGET_CATEGORIES.map((c) => {
            const cat = getCategory(c);
            return (
              <li key={c}>
                <label className="flex items-center gap-3 px-4 py-3">
                  {/* What this box showed (minor units, or nothing): the save only changes boxes that were changed, and only if still as shown. */}
                  <input type="hidden" name={`was_${c}`} value={String(group.budgets.find((x) => x.category === c)?.amount ?? "")} />
                  <ExpenseGlyph title="" category={c} size={34} />
                  <span className="flex-1">{cat.label}</span>
                  <span className="flex w-32 items-center rounded-xl border border-line px-3 focus-within:border-accent">
                    <span className="nobreak shrink-0 text-xs text-gray-400">{group.currency}</span>
                    <AmountInput name={`b_${c}`} currency={group.currency} defaultValue={amountOf(c)} placeholder="—" aria-label={`${cat.label} budget`} className="w-full bg-transparent py-2 text-right outline-none" />
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
