import Link from "@/components/Link";
import { getMemberships } from "@/lib/identity";
import { Notice } from "@/components/Notice";
import { loadOverview } from "@/lib/overview";
import { formatMoney } from "@/lib/money";
import { settleAcrossGroups } from "@/app/actions";
import { newRequestKey } from "@/lib/once";
import { Avatar, PageHeader } from "@/components/ui";
import { SquareSeal } from "@/components/DrawnIcons";
import { db } from "@/lib/db";
import { payButtons } from "@/lib/pay-links";

// Smart Settle across all your groups: one payment per person.
export default async function SettlePage({ searchParams }: { searchParams: Promise<{ settle?: string }> }) {
  const { settle: notice } = await searchParams;
  const { all, common, settleItems, skippedGroups, othersPending } = await loadOverview(await getMemberships());
  // Pay buttons for people you owe who added their UPI ID / pay link.
  const owedAccounts = settleItems.filter((it) => it.net < 0 && !it.converted && it.key.startsWith("acc:")).map((it) => it.key.slice(4));
  const accounts = owedAccounts.length ? await db.account.findMany({ where: { id: { in: owedAccounts } }, select: { id: true, upiId: true, payLink: true } }) : [];

  return (
    <>
      <PageHeader title="Settle up" back="/" />
      {settleItems.length > 0 && (
        <div className="relative -mt-2 mb-6">
          <span aria-hidden className="pointer-events-none absolute -left-24 -top-28 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(111,227,168,0.14),transparent_65%)]" />
          <p className="relative font-display text-[34px] font-semibold leading-[1.04] tracking-[-0.02em]">
            {settleItems.length === 1 ? "One payment" : `${settleItems.length} payments`} and you’re all square
          </p>
          <p className="relative mt-2 text-sm leading-relaxed text-fg/60">One payment per person, across all your groups. Each one clears itself when it’s marked paid.</p>
        </div>
      )}

      {notice === "done" && <Notice params={["settle"]} className="mb-3">Recorded in each group. Everyone’s notified.</Notice>}
      {notice === "changed" && <Notice params={["settle"]} className="mb-3">Balances just changed. Here’s the latest.</Notice>}
      {notice === "error" && <Notice tone="error" params={["settle"]} className="mb-3">Couldn’t record that. Try again.</Notice>}

      {all.length === 0 ? (
        <p className="rounded-[22px] bg-mist px-4 py-8 text-center text-sm text-gray-500">
          No groups yet. <Link href="/groups/new" className="text-fg underline underline-offset-4">Create one</Link>.
        </p>
      ) : settleItems.length === 0 ? (
        <div className="rounded-[26px] bg-mist px-5 py-10 text-center">
          <SquareSeal size={56} className="mx-auto" />
          <p className="mt-3 font-display text-2xl font-semibold">All square</p>
          <p className="mt-1 text-sm text-gray-600">You’re settled up with everyone.</p>
        </div>
      ) : (
        <>
          {(["in", "out"] as const).map((way) => {
            const list = settleItems.filter((it) => (way === "in" ? it.net > 0 : it.net <= 0));
            if (!list.length) return null;
            return (
              <section key={way} id={way === "in" ? "remind" : "pay"} className="mb-6 scroll-mt-6" aria-label={way === "in" ? "Coming to you" : "From you"}>
                <h2 className="mb-2.5 px-1 text-[13px] font-semibold text-fg/50">{way === "in" ? "Coming to you" : "From you"}</h2>
                <ul className="lp-rise space-y-2.5">
                  {list.map((it) => {
                    const amt = (n: number) => `${it.converted ? "≈ " : ""}${formatMoney(Math.abs(n), common)}`;
                    const biggest = [...it.parts].sort((a, b) => b.amount - a.amount)[0];
                    return (
                      <li
                        key={it.key}
                        className={`rounded-[22px] border px-4 py-3.5 ${it.net < 0 ? "border-owe/25 bg-[linear-gradient(180deg,rgba(255,171,107,0.07),rgba(255,171,107,0.02))]" : "border-line bg-white"}`}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar name={it.name} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px] font-semibold">{it.net < 0 ? `You pay ${it.name}` : it.net > 0 ? `${it.name} pays you` : `You and ${it.name} are even`}</p>
                            <p className={`money text-[22px] leading-tight ${it.net < 0 ? "text-owe" : it.net > 0 ? "text-owed" : "text-gray-400"}`}>{it.net === 0 ? "Even" : amt(it.net)}</p>
                          </div>
                          {it.net > 0 && biggest && (
                            <Link
                              href={`/groups/${biggest.groupId}/remind?from=${biggest.fromId}`}
                              data-remind
                              className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line bg-mist px-3.5 text-sm font-semibold active:scale-[0.97]"
                            >
                              <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 3 10 14M21 3l-7 18-4-7-7-4Z" />
                              </svg>
                              Remind
                            </Link>
                          )}
                        </div>
                        <ul className="mt-2 space-y-0.5 pl-12 text-xs text-gray-500">
                          {it.parts.length === 1 ? (
                            <li>In {it.parts[0].groupName}</li>
                          ) : (
                            it.parts.map((p) => (
                              <li key={`${p.groupId}-${p.fromId}-${p.toId}`} className="flex flex-wrap items-baseline justify-between gap-x-3">
                                <span>
                                  {p.groupName}: {p.iPay ? `you pay ${formatMoney(p.amount, p.currency)}` : `${it.name} pays you ${formatMoney(p.amount, p.currency)}`}
                                </span>
                                {/* Just this group for now (the trip today, the flat at month-end). */}
                                <Link href={`/groups/${p.groupId}/settle`} className="shrink-0 font-medium text-fg underline underline-offset-2">
                                  Settle only here
                                </Link>
                              </li>
                            ))
                          )}
                        </ul>
                        {it.net < 0 &&
                          !it.converted &&
                          (() => {
                            const a = accounts.find((x) => `acc:${x.id}` === it.key);
                            const buttons = payButtons(a, { amount: -it.net, currency: common, toName: it.name, note: "Loopin settle-up" });
                            return buttons.length ? (
                              <div className="mt-3 flex flex-wrap gap-2 pl-12" data-pay-buttons>
                                {buttons.map((b) => (
                                  <a
                                    key={b.kind}
                                    href={b.href}
                                    {...(b.kind === "upi" ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                                    className="inline-flex h-10 items-center rounded-full bg-fg px-4 text-sm font-semibold text-canvas active:scale-[0.97]"
                                    data-pay={b.kind}
                                  >
                                    Pay {amt(it.net)} with {b.label}
                                  </a>
                                ))}
                              </div>
                            ) : null;
                          })()}
                        <div className="mt-3 flex items-center justify-between gap-3 pl-12">
                          <span className="text-xs text-gray-400">{it.parts.length > 1 ? `1 payment instead of ${it.parts.length}` : ""}</span>
                          <form action={settleAcrossGroups}>
                            <input type="hidden" name="rid" value={newRequestKey()} />
                            <input
                              type="hidden"
                              name="parts"
                              value={JSON.stringify(it.parts.map((p) => ({ groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount })))}
                            />
                            <button type="submit" data-haptic="success" className="h-10 rounded-full border border-fg/18 bg-fg/[0.07] px-4 text-sm font-semibold text-fg active:scale-[0.97]">
                              Mark as paid
                            </button>
                          </form>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </>
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
                <Link href={`/groups/${g.group.id}?tab=balances`} className="inline-block rounded-full border border-line px-3.5 py-2 text-sm active:bg-mist">
                  {g.group.name}, {g.transfers.length} {g.transfers.length === 1 ? "payment" : "payments"}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-8 flex gap-2.5 rounded-[18px] bg-mist px-4 py-3.5 text-[13px] leading-snug text-fg/60">
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="mt-px shrink-0">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16.5v.5" />
        </svg>
        <span>“Mark as paid” only records it; Loopin never moves money. Remind sends a WhatsApp link where they can tap “I’ve paid” without signing in.</span>
      </p>
    </>
  );
}
