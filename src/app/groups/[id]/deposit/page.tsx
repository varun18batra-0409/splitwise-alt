import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { returnDeposit, saveDeposit } from "@/app/bill-actions";
import { formatMoney, toInputAmount } from "@/lib/money";

// The flat's security deposit: who put in what, and getting it back.
// It's kept on record only — never part of the balances.
export default async function DepositPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; returned?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const group = await db.group.findUnique({
    where: { id },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] }, deposit: { include: { shares: true } } },
  });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  const money = (n: number) => formatMoney(n, group.currency);
  const shares = group.deposit?.shares ?? [];
  const held = shares.filter((s) => s.status === "held");
  const total = held.reduce((s, x) => s + x.amount, 0);
  const name = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const amountOf = (mid: string) => {
    const s = held.find((x) => x.memberId === mid);
    return s ? toInputAmount(s.amount, group.currency) : "";
  };

  return (
    <>
      <PageHeader title="Deposit" back={`/groups/${group.id}`} />
      {sp.error && <ErrorNote>{sp.error.slice(0, 160)}</ErrorNote>}
      {sp.saved && <p className="mb-4 rounded-xl bg-owed/10 px-4 py-3 text-sm text-owed">Saved.</p>}
      {sp.returned && <p className="mb-4 rounded-xl bg-owed/10 px-4 py-3 text-sm text-owed">Marked as returned. The amounts are in Activity.</p>}

      <section className="vault mb-8 rounded-[24px] px-5 py-5">
        <p className="text-sm text-gray-500">With {group.deposit?.heldBy ?? "the landlord"}</p>
        <p className="mt-1 font-display text-[36px] font-semibold tabular-nums">{money(total)}</p>
        <p className="mt-1 text-sm text-gray-500">Kept on record only. It’s never part of who owes whom.</p>
      </section>

      <form action={saveDeposit} className="space-y-5">
        <input type="hidden" name="groupId" value={group.id} />
        <label className="block">
          <span className="mb-2 block text-base font-semibold">Who holds it</span>
          <input name="heldBy" defaultValue={group.deposit?.heldBy ?? "Landlord"} maxLength={40} className={inputClass} />
        </label>
        <fieldset>
          <legend className="mb-2 text-base font-semibold">Who put in what</legend>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {group.members
              .filter((m) => !m.leftAt)
              .map((m) => (
                <li key={m.id}>
                  <label className="flex items-center gap-3 px-4 py-3">
                    <span className="flex-1">{name(m.id)}</span>
                    <span className="flex w-36 items-center rounded-xl border border-line px-3 focus-within:border-accent">
                      <span className="text-xs text-gray-400">{group.currency}</span>
                      <input name={`d_${m.id}`} inputMode="decimal" defaultValue={amountOf(m.id)} placeholder="0" aria-label={`${m.name}’s deposit`} className="w-full bg-transparent py-2 text-right outline-none" />
                    </span>
                  </label>
                </li>
              ))}
          </ul>
        </fieldset>
        <button type="submit" className={secondaryButtonClass}>
          Save deposit
        </button>
      </form>

      {shares.some((s) => s.status !== "held") && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-gray-500">History</h2>
          <ul className="divide-y divide-line border-y border-line text-sm">
            {shares
              .filter((s) => s.status !== "held")
              .map((s) => (
                <li key={s.id} className="flex justify-between py-2.5">
                  <span>
                    {name(s.memberId)} · {s.status === "transferred" ? `taken over by ${name(s.toMemberId)}` : "got back"}
                    {s.status === "returned" && s.returnedAmount < s.amount && (
                      <span className="block text-xs text-gray-500">
                        {money(s.amount - s.returnedAmount)} kept back of {money(s.amount)}
                      </span>
                    )}
                  </span>
                  <span className="font-display tabular-nums">{money(s.status === "returned" ? s.returnedAmount : s.amount)}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {held.length > 0 && (
        <form action={returnDeposit} className="mt-10 space-y-3 rounded-2xl border border-line px-4 py-4">
          <input type="hidden" name="groupId" value={group.id} />
          <h2 className="font-semibold">Lease over?</h2>
          <p className="text-sm text-gray-500">Enter anything kept back (painting, repairs). It’s shared the group’s way, and everyone sees what they get back.</p>
          <label className="flex items-center gap-2 rounded-xl border border-line px-3 focus-within:border-accent">
            <span className="text-xs text-gray-400">{group.currency}</span>
            <input name="deductions" inputMode="decimal" placeholder="0 deducted" aria-label="Deductions" className="w-full bg-transparent py-3 outline-none" />
          </label>
          <ConfirmButton message="Mark the whole deposit as returned?" className={primaryButtonClass}>
            Mark deposit returned
          </ConfirmButton>
        </form>
      )}
    </>
  );
}
