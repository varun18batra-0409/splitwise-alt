import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getMyMemberId } from "@/lib/identity";
import { loadGroup } from "@/lib/group-data";
import { formatMoney, toInputAmount } from "@/lib/money";
import { recordCustomPayment } from "@/app/actions";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass } from "@/components/ui";

// Record that one person paid another back — any amount, full or part.
// Smart Settle's suggestions are offered as one-tap fill-ins.
export default async function RecordPayment({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; amount?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const data = await loadGroup(id);
  if (!data) notFound();
  const { group, transfers, net } = data;
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(`/join/${group.inviteCode}`);

  const isMember = (x?: string) => Boolean(x && group.members.some((m) => m.id === x));
  const from = isMember(sp.from) ? sp.from! : myId;
  const to = isMember(sp.to) && sp.to !== from ? sp.to! : "";
  const nameOf = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const money = (m: number) => formatMoney(m, group.currency);
  const fill = (f: string, t: string, a: number) =>
    `/groups/${group.id}/pay?${new URLSearchParams({ from: f, to: t, amount: toInputAmount(a, group.currency) })}`;

  const chip = "flex items-center gap-2 border border-line px-3 py-2 text-sm has-[:checked]:border-fg has-[:checked]:bg-fg has-[:checked]:font-medium has-[:checked]:text-canvas";

  return (
    <>
      <PageHeader title="Record a payment" back={`/groups/${group.id}?tab=balances`} />
      {sp.error && <ErrorNote>{sp.error}</ErrorNote>}

      {transfers.length > 0 && (
        <section className="mb-8">
          <p className="mb-2 text-sm text-gray-500">Smart Settle suggests</p>
          <ul className="flex flex-wrap gap-2">
            {transfers.map((t) => (
              <li key={`${t.from}-${t.to}`}>
                <Link href={fill(t.from, t.to, t.amount)} className="inline-block border border-line px-3 py-2 text-sm active:bg-mist">
                  {nameOf(t.from)} → {t.to === myId ? "you" : nameOf(t.to)} · <span className="tabular-nums">{money(t.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action={recordCustomPayment} className="space-y-8">
        <input type="hidden" name="groupId" value={group.id} />

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-600">Who paid?</legend>
          <div className="flex flex-wrap gap-2">
            {group.members.map((m) => (
              <label key={m.id} className={chip}>
                <input type="radio" name="fromId" value={m.id} defaultChecked={m.id === from} className="sr-only" required />
                {m.id === myId ? "You" : m.name}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-600">Paid to</legend>
          <div className="flex flex-wrap gap-2">
            {group.members.map((m) => (
              <label key={m.id} className={chip}>
                <input type="radio" name="toId" value={m.id} defaultChecked={m.id === to} className="sr-only" required />
                {m.id === myId ? "You" : m.name}
                {net[m.id] > 0 && <span className="text-xs opacity-60">gets {money(net[m.id])}</span>}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-600">Amount ({group.currency})</span>
          <input name="amount" required inputMode="decimal" placeholder="0" defaultValue={sp.amount ?? ""} autoComplete="off" className={`${inputClass} text-2xl font-semibold`} />
          <span className="mt-2 block text-xs text-gray-400">Full or part. You can record the rest later.</span>
        </label>

        <button type="submit" className={primaryButtonClass}>
          Record payment
        </button>
        <p className="text-xs text-gray-400">This only notes the payment here, so balances update. The app never moves real money.</p>
      </form>
    </>
  );
}
