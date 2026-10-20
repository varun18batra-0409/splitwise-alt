import Link from "@/components/Link";
import { getMemberships } from "@/lib/identity";
import { Notice } from "@/components/Notice";
import { loadOverview } from "@/lib/overview";
import { formatMoney } from "@/lib/money";
import { settleAcrossGroups } from "@/app/actions";
import { newRequestKey } from "@/lib/once";
import { PageHeader } from "@/components/ui";

// Smart Settle across all your groups: one payment per person.
export default async function SettlePage({ searchParams }: { searchParams: Promise<{ settle?: string }> }) {
  const { settle: notice } = await searchParams;
  const { all, common, settleItems, skippedGroups, othersPending } = await loadOverview(await getMemberships());

  return (
    <>
      <PageHeader title="Settle up" back="/" />
      <p className="-mt-4 mb-6 text-sm text-gray-500">One payment per person, across all your groups.</p>

      {notice === "done" && <Notice params={["settle"]} className="mb-3">Recorded in each group. Everyone’s notified.</Notice>}
      {notice === "changed" && <Notice params={["settle"]} className="mb-3">Balances just changed. Here’s the latest.</Notice>}
      {notice === "error" && <Notice tone="error" params={["settle"]} className="mb-3">Couldn’t record that. Try again.</Notice>}

      {all.length === 0 ? (
        <p className="rounded-2xl bg-mist px-4 py-8 text-center text-sm text-gray-500">
          No groups yet. <Link href="/groups/new" className="text-fg underline underline-offset-4">Create one</Link>.
        </p>
      ) : settleItems.length === 0 ? (
        <p className="rounded-2xl bg-mist px-4 py-8 text-center text-sm text-gray-600">You’re settled up with everyone. 🎉</p>
      ) : (
        <ul className="space-y-2">
          {settleItems.map((it) => {
            const amt = (n: number) => `${it.converted ? "≈ " : ""}${formatMoney(Math.abs(n), common)}`;
            return (
              <li key={it.key} className="rounded-2xl border border-line px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 text-sm">
                    {it.net < 0 ? (
                      <>You pay <strong className="font-medium">{it.name}</strong></>
                    ) : it.net > 0 ? (
                      <><strong className="font-medium">{it.name}</strong> pays you</>
                    ) : (
                      <>You and <strong className="font-medium">{it.name}</strong> are even</>
                    )}
                  </p>
                  <p className={`shrink-0 font-display font-semibold tabular-nums ${it.net < 0 ? "text-owe" : it.net > 0 ? "text-owed" : "text-gray-400"}`}>
                    {it.net === 0 ? "—" : amt(it.net)}
                  </p>
                </div>
                <ul className="mt-1.5 space-y-0.5 text-xs text-gray-500">
                  {it.parts.map((p) => (
                    <li key={`${p.groupId}-${p.fromId}-${p.toId}`}>
                      {p.groupName}: {p.iPay ? `you pay ${formatMoney(p.amount, p.currency)}` : `${it.name} pays you ${formatMoney(p.amount, p.currency)}`}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-400">{it.parts.length > 1 ? `1 payment instead of ${it.parts.length}` : ""}</span>
                  <form action={settleAcrossGroups}>
                    <input type="hidden" name="rid" value={newRequestKey()} />
                    <input
                      type="hidden"
                      name="parts"
                      value={JSON.stringify(it.parts.map((p) => ({ groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount })))}
                    />
                    <button type="submit" className="border border-line px-3 py-1.5 text-sm font-medium text-fg active:bg-mist">
                      Mark as paid
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {skippedGroups.length > 0 && (
        <p className="mt-2 text-xs text-gray-400">No exchange rate right now for {skippedGroups.join(", ")}. Settle those inside the group.</p>
      )}

      {othersPending.length > 0 && (
        <div className="mt-8">
          <p className="mb-2 text-sm text-gray-500">Others still settling between themselves</p>
          <ul className="flex flex-wrap gap-2">
            {othersPending.map((g) => (
              <li key={g.group.id}>
                <Link href={`/groups/${g.group.id}?tab=balances`} className="inline-block rounded-full border border-line px-3 py-1.5 text-sm active:bg-mist">
                  {g.group.name} · {g.transfers.length} {g.transfers.length === 1 ? "payment" : "payments"}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-8 text-xs text-gray-400">“Mark as paid” only records it. Loopin never moves money.</p>
    </>
  );
}
