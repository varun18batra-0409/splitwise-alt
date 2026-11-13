import Link from "@/components/Link";
import { getMemberships } from "@/lib/identity";
import { Notice } from "@/components/Notice";
import { loadOverview } from "@/lib/overview";
import { formatMoney, PAYMENT_LINE, toInputAmount } from "@/lib/money";
import { DifferentAmountLink, differentAmountFor, filledActionClass, outlineButtonClass, PayAppButtons } from "@/components/SettleRow";
import { crossActionLabel, crossPreview, settleRowId } from "@/lib/cross-settle";
import { settleAcrossGroups } from "@/app/actions";
import { STALE_KEY_ERROR } from "@/lib/once";
import { FreshKey } from "@/components/FreshKey";
import { PageHeader } from "@/components/ui";
import { SquareSeal } from "@/components/DrawnIcons";
import { db } from "@/lib/db";
import { payButtons } from "@/lib/pay-links";
import { coverFor } from "@/lib/covers";
import { tripPhotoSrc } from "@/lib/places";
import { groupMark } from "@/lib/home/money-card";
import { CREAM, type StubCover } from "@/components/HomeMoney";
import { firstName, InfoNote, OUTLINE_PILL, PayTicket, PayView, QUIET } from "@/components/PayScreens";

// Smart Settle across all your groups: one payment per person. Each is a ticket with the group's picture on its stub.
export default async function SettlePage({ searchParams }: { searchParams: Promise<{ settle?: string; pay?: string }> }) {
  const { settle: notice, pay } = await searchParams;
  const { all, common, settleItems, skippedLinks, othersPending } = await loadOverview(await getMemberships());
  // Pay buttons for people you owe who added their UPI ID / pay link.
  const owedAccounts = settleItems.filter((it) => it.net < 0 && !it.converted && it.key.startsWith("acc:")).map((it) => it.key.slice(4));
  const accounts = owedAccounts.length ? await db.account.findMany({ where: { id: { in: owedAccounts } }, select: { id: true, upiId: true, payLink: true } }) : [];

  type Item = (typeof settleItems)[number];
  const amt = (it: Item, n: number) => `${it.converted ? "≈ " : ""}${formatMoney(Math.abs(n), common)}`;
  // The picture on the stub: the group of this person's biggest part (the first one listed).
  const coverOf = (it: Item): { cover?: StubCover; mark: ReturnType<typeof groupMark> } => {
    const g = all.find((x) => x.group.id === it.parts[0]?.groupId)?.group;
    return g ? { cover: { id: g.id, cover: coverFor(g), photo: tripPhotoSrc(g), name: g.name }, mark: groupMark(g.type) } : { mark: "dot" };
  };
  const payButtonsOf = (it: Item) => {
    if (it.net < 0 && !it.converted) {
      const a = accounts.find((x) => `acc:${x.id}` === it.key);
      return { ways: a ? { upiId: a.upiId, payLink: a.payLink } : null, buttons: payButtons(a, { amount: -it.net, currency: common, toName: it.name, note: "Loopin settle-up" }) };
    }
    return { ways: null, buttons: [] };
  };
  // Shows each group's part and the total first; only "Record in N groups" saves anything. `summaryClass` is how its opening button looks.
  const crossAction = (it: Item, summaryClass: string) => {
    const pv = crossPreview(it, common);
    return (
      <details className="group flex-1 basis-40 open:basis-full" data-cross-preview>
        <summary className={`${summaryClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>{crossActionLabel(it.net)}</summary>
        <div className="mt-3 rounded-[20px] border border-line bg-white px-4 py-3.5">
          <p className="text-sm font-semibold">This will record:</p>
          <ul className="mt-2 space-y-1 text-sm text-fg/80" data-cross-lines>
            {pv.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="mt-2 border-t border-line pt-2 text-sm font-semibold" data-cross-total>
            {pv.total}
          </p>
          <form action={settleAcrossGroups} className="mt-3">
            <FreshKey name="rid" />
            <input type="hidden" name="parts" value={JSON.stringify(it.parts.map((p) => ({ groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount })))} />
            <button type="submit" data-haptic="success" data-cross-record className={`${OUTLINE_PILL} w-full border-fg/60`}>
              {pv.button}
            </button>
          </form>
        </div>
      </details>
    );
  };

  // ---- Pay Nupur: the steps ----
  const payItem = pay ? settleItems.find((it) => it.net < 0 && it.key === pay) : undefined;
  if (payItem) {
    const { ways, buttons } = payButtonsOf(payItem);
    const c = coverOf(payItem);
    return (
      <>
        <PageHeader title={`Pay ${firstName(payItem.name)}`} back="/settle" />
        <PayView
          name={payItem.name}
          amount={amt(payItem, payItem.net)}
          cover={c.cover}
          groupName={payItem.parts.length === 1 ? payItem.parts[0].groupName : `${payItem.parts.length} groups`}
          ways={ways}
          payApp={buttons.length ? <PayAppButtons buttons={buttons} /> : undefined}
          tellButton={<div className="flex">{crossAction(payItem, buttons.length ? outlineButtonClass : filledActionClass)}</div>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settle up" back="/" />
      {settleItems.length > 0 && (
        <div className="-mt-2 mb-6">
          <p className="font-display text-[28px] font-semibold leading-[1.04] tracking-[-0.02em]">
            {settleItems.length === 1 ? "One payment" : `${settleItems.length} payments`}
            {skippedLinks.length ? " to settle here" : " and you’re all square"}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-fg/60">One payment per person, across all your groups. Each one clears itself when it’s marked paid.</p>
        </div>
      )}

      {notice === "done" && <Notice params={["settle"]} className="mb-3">Recorded in each group. Everyone’s notified.</Notice>}
      {notice === "changed" && <Notice params={["settle"]} className="mb-3">Balances just changed. Here’s the latest.</Notice>}
      {notice === "stale" && <Notice tone="error" params={["settle"]} className="mb-3">{STALE_KEY_ERROR}</Notice>}
      {notice === "error" && <Notice tone="error" params={["settle"]} className="mb-3">Couldn’t record that. Try again.</Notice>}

      {all.length === 0 ? (
        <p className="rounded-[20px] border border-line bg-white px-4 py-8 text-center text-sm text-fg/60">
          Once you add shared costs, you’ll see who to pay here.{" "}
          <Link href="/groups/new" className="text-fg underline underline-offset-4">Create a group</Link>, or open an invite link from a friend.
        </p>
      ) : settleItems.length === 0 && skippedLinks.length > 0 ? (
        // Nothing to add up here, but some groups are left out: never "All square" while they are.
        <div className="rounded-[20px] border border-line bg-white px-5 py-8 text-center">
          <p className="font-display text-2xl font-semibold">Nothing to add up yet</p>
          <p className="mt-1 text-sm text-fg/60">Some groups are waiting on an exchange rate. Settle those inside each group.</p>
        </div>
      ) : settleItems.length === 0 ? (
        <div className="rounded-[20px] border border-line bg-white px-5 py-10 text-center">
          <SquareSeal size={56} className="mx-auto" />
          <p className="mt-3 font-display text-2xl font-semibold">All square</p>
          <p className="mt-1 text-sm text-fg/60">You’re settled up with everyone.</p>
        </div>
      ) : (
        <>
          <h2 className="mb-2.5 px-1 text-[13px] font-semibold text-fg/55">Yours</h2>
          {(["in", "out"] as const).map((way) => {
            const list = settleItems.filter((it) => (way === "in" ? it.net > 0 : it.net <= 0));
            if (!list.length) return null;
            return (
              <section key={way} id={way === "in" ? "remind" : "pay"} className="mb-4 scroll-mt-6" aria-label={way === "in" ? "Coming to you" : "From you"}>
                <ul className="lp-rise space-y-3">
                  {list.map((it, li) => {
                    // One cream button on the screen: the first ticket's.
                    const first = li === 0 && (way === "in" || !settleItems.some((x) => x.net > 0));
                    const big = `${first ? CREAM : OUTLINE_PILL} w-full`;
                    // Remind about a part where they owe you (never one where you're the one paying).
                    const biggest = [...it.parts].filter((p) => !p.iPay).sort((a, b) => b.amount - a.amount)[0];
                    const c = coverOf(it);
                    const title = it.net < 0 ? `You pay ${it.name}` : it.net > 0 ? `${it.name} pays you` : `You and ${it.name} are even`;
                    const amount = it.net === 0 ? "Even" : amt(it, it.net);
                    return (
                      <PayTicket
                        key={it.key}
                        id={settleRowId(way === "in" ? "remind" : "pay", it.key)}
                        attrs={{ "data-transfer-row": "" }}
                        stub={c.cover ? { covers: [c.cover] } : { letter: it.name }}
                        from={it.net < 0 ? "You" : it.name}
                        to={it.net < 0 ? it.name : "You"}
                        mark={c.mark}
                        amount={amount}
                        tone={it.net < 0 ? "owe" : it.net > 0 ? "owed" : "plain"}
                        sr={`${title} ${amount}`}
                      >
                        <div className="mt-auto pt-3">
                          {it.net < 0 && (
                            <Link href={`/settle?pay=${encodeURIComponent(it.key)}`} className={big}>
                              Pay {firstName(it.name)}
                            </Link>
                          )}
                          {it.net > 0 && biggest && (
                            <Link href={`/groups/${biggest.groupId}/remind?from=${biggest.fromId}`} data-remind className={big}>
                              Remind {firstName(it.name)}
                            </Link>
                          )}
                          <div className="flex flex-wrap items-start justify-between gap-x-3">
                            {crossAction(it, QUIET)}
                            {it.parts.length === 1 && !it.converted ? (
                              <DifferentAmountLink href={differentAmountFor(it.parts[0].groupId, it.parts[0].fromId, it.parts[0].toId, toInputAmount(it.parts[0].amount, it.parts[0].currency), false)} />
                            ) : null}
                          </div>
                          {/* Which group each part is in. */}
                          <ul className="space-y-0.5 text-[12.5px] text-fg/55">
                            {it.parts.length === 1 ? (
                              <li>In {it.parts[0].groupName}</li>
                            ) : (
                              <>
                                <li>{`1 payment instead of ${it.parts.length}`}</li>
                                {it.parts.map((p) => (
                                  <li key={`${p.groupId}-${p.fromId}-${p.toId}`} className="flex flex-wrap items-center justify-between gap-x-3">
                                    <span>
                                      {p.groupName}: {p.iPay ? `you pay ${formatMoney(p.amount, p.currency)}` : `${it.name} pays you ${formatMoney(p.amount, p.currency)}`}
                                    </span>
                                    {/* Just this group for now (the trip today, the flat at month-end). */}
                                    <Link href={`/groups/${p.groupId}/settle`} className="inline-flex min-h-11 shrink-0 items-center font-medium text-fg underline underline-offset-2">
                                      Settle only here
                                    </Link>
                                  </li>
                                ))}
                              </>
                            )}
                          </ul>
                        </div>
                      </PayTicket>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </>
      )}
      {skippedLinks.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-fg/60">No exchange rate right now, so these aren’t in the total. Settle them inside the group:</p>
          <ul className="flex flex-wrap gap-2">
            {skippedLinks.map((g) => (
              <li key={g.id}>
                <Link href={`/groups/${g.id}/settle`} className="inline-flex min-h-11 items-center rounded-full border border-fg/25 px-3.5 text-sm active:bg-mist">
                  {g.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {othersPending.length > 0 && (
        <div className="mt-8">
          <p className="mb-2 text-sm text-fg/60">Others still settling between themselves</p>
          <ul className="flex flex-wrap gap-2">
            {othersPending.map((g) => (
              <li key={g.group.id}>
                <Link href={`/groups/${g.group.id}?tab=balances`} className="inline-flex min-h-11 items-center rounded-full border border-fg/25 px-3.5 text-sm active:bg-mist">
                  {g.group.name}, {g.transfers.length} {g.transfers.length === 1 ? "payment" : "payments"}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-8">
        <InfoNote>{PAYMENT_LINE} Remind sends a WhatsApp link where they can tap “I’ve paid” without signing in.</InfoNote>
      </div>
    </>
  );
}
