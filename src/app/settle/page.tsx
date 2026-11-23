import { headers } from "next/headers";
import { visitorRegion } from "@/lib/region";
import Link from "@/components/Link";
import { getMemberships } from "@/lib/identity";
import { Notice } from "@/components/Notice";
import { loadOverview } from "@/lib/overview";
import { formatMoney, PAYMENT_LINE, toInputAmount } from "@/lib/money";
import { listMoney } from "@/lib/money-display";
import { differentAmountFor, filledActionClass, outlineButtonClass, PayAppButtons } from "@/components/SettleRow";
import { CLEAR_BOTH_NOTE, CLEAR_BOTH_SUBTITLE, crossActionLabel, crossPreview, clearBothLines, evenCaption, isEvenItem, settleRowId } from "@/lib/cross-settle";
import { settleAcrossGroups } from "@/app/actions";
import { STALE_KEY_ERROR } from "@/lib/once";
import { PAY_CHANGE_LIMIT_TEXT } from "@/lib/pay-limit";
import { FreshKey } from "@/components/FreshKey";
import { PageHeader } from "@/components/ui";
import { SquareSeal } from "@/components/DrawnIcons";
import { db } from "@/lib/db";
import { payButtons } from "@/lib/pay-links";
import { coverFor } from "@/lib/covers";
import { tripPhotoSrc } from "@/lib/places";
import { groupMark } from "@/lib/home/money-card";
import { type StubCover } from "@/components/HomeMoney";
import { firstName, InfoNote, OUTLINE_PILL, PayView } from "@/components/PayScreens";
import { BackIcon, iconButtonClass } from "@/components/icons";
import { Initial, SettleCard, type MenuItem } from "@/components/SettleUp";
import { BIG_CREAM } from "@/lib/settle-ui";
import { directEntryOn } from "@/lib/direct";
import { filterDirect, type DirectEntry } from "@/lib/direct-db";
import { PAYMENT_TOO_BIG_SHORT } from "@/lib/payments";

// Smart Settle across all your groups: one payment per person. Each person is a card (founder's design, 15 Nov): the exact amount, "View breakdown",
// one big button and a ⋮ menu. "Record payment" opens a bottom sheet; confirming it records the payment in each group (settleAcrossGroups, exactly as the old
// "Record in N groups" button did). Every part counts straight away and the other person is told; deleting any part takes all of them off together
// (payment-change.ts). (The group's own Settle up keeps its own look.)
export default async function SettlePage({ searchParams }: { searchParams: Promise<{ settle?: string; pay?: string; show?: string; q?: string }> }) {
  const { settle: notice, pay, show: showParam, q: qParam } = await searchParams;
  const { all, common, settleItems, skippedLinks, othersPending, direct, toCommon } = await loadOverview(await getMemberships(), visitorRegion(await headers()).currency);
  // Pay buttons for people you owe who added their UPI ID / pay link (people in groups, and people you share expenses with directly).
  const owedAccounts = [
    ...settleItems.filter((it) => it.netOwn < 0 && !it.converted && it.key.startsWith("acc:")).map((it) => it.key.slice(4)),
    ...direct.filter((e) => e.net < 0 && e.other.accountId).map((e) => e.other.accountId!),
  ];
  const accounts = owedAccounts.length ? await db.account.findMany({ where: { id: { in: owedAccounts } }, select: { id: true, upiId: true, payLink: true } }) : [];

  type Item = (typeof settleItems)[number];
  // A person who has cards in two currencies shows each card's exact own-currency amount (nothing converted, no "≈"); everyone else is as before.
  const amt = (it: Item, n: number, fmt: (minor: number) => string = (x) => formatMoney(x, common)) =>
    it.mixed ? formatMoney(Math.abs(it.netOwn), it.currency) : `${it.converted ? "≈ " : ""}${fmt(Math.abs(n))}`;
  // The TO PAY and TO RECEIVE cards: if any has paise, every amount keeps its two decimals so they line up (₹2,670.00 beside ₹30,723.44).
  const listFmt = listMoney(settleItems.map((it) => Math.abs(it.net)), common);
  // The picture on the stub: the group of this person's biggest part (the first one listed).
  const coverOf = (it: Item): { cover?: StubCover; mark: ReturnType<typeof groupMark> } => {
    const g = all.find((x) => x.group.id === it.parts[0]?.groupId)?.group;
    return g ? { cover: { id: g.id, cover: coverFor(g), photo: tripPhotoSrc(g), name: g.name }, mark: groupMark(g.type) } : { mark: "plane" };
  };
  const payButtonsOf = (it: Item) => {
    if (it.netOwn < 0 && it.currency === common) {
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
        <summary className={`${summaryClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>{crossActionLabel(it.netOwn)}</summary>
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

  // ---- Pay Rohan (directly): the steps ----
  const payPair = pay?.startsWith("direct:") ? direct.find((e) => e.groupId === pay.slice(7) && e.net < 0) : undefined;
  if (payPair) {
    const a = payPair.other.accountId ? accounts.find((x) => x.id === payPair.other.accountId) : undefined;
    const buttons = payButtons(a, { amount: -payPair.net, currency: payPair.currency, toName: payPair.other.name, note: "Loopin settle-up" });
    const money = formatMoney(-payPair.net, payPair.currency);
    return (
      <>
        <PageHeader title={`Pay ${firstName(payPair.other.name)}`} back="/settle" />
        <PayView
          name={payPair.other.name}
          amount={money}
          groupName="With a person"
          ways={a ? { upiId: a.upiId, payLink: a.payLink } : null}
          payApp={buttons.length ? <PayAppButtons buttons={buttons} /> : undefined}
          tellButton={
            <details className="group flex-1 basis-40 open:basis-full" data-cross-preview>
              <summary className={`${buttons.length ? outlineButtonClass : filledActionClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>Record payment</summary>
              <div className="mt-3 rounded-[20px] border border-line bg-white px-4 py-3.5">
                <p className="text-sm font-semibold">This will record:</p>
                <p className="mt-2 text-sm text-fg/80" data-cross-lines>{`You paid ${payPair.other.name} ${money}`}</p>
                <form action={settleAcrossGroups} className="mt-3">
                  <FreshKey name="rid" />
                  <input type="hidden" name="parts" value={JSON.stringify([{ groupId: payPair.groupId, fromId: payPair.myId, toId: payPair.other.id, amount: -payPair.net }])} />
                  <button type="submit" data-haptic="success" data-cross-record className={`${OUTLINE_PILL} w-full border-fg/60`}>
                    Confirm payment recorded
                  </button>
                </form>
              </div>
            </details>
          }
        />
      </>
    );
  }

  // ---- Pay Nupur: the steps ----
  const payItem = pay ? settleItems.find((it) => it.netOwn < 0 && it.id === pay) : undefined;
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

  // ---- The overview ----
  const evenList = settleItems.filter(isEvenItem);
  // People I pay. A person who is even in ONE currency is in the Even section instead; a mixed-currency person whose converted net is 0 stays here, as before.
  const outList = settleItems.filter((it) => it.netOwn <= 0 && !isEvenItem(it)); // even across groups: nothing to pay, "Clear both" cancels the two sides
  const inList = settleItems.filter((it) => it.netOwn > 0); // people who pay me
  const oweItems = settleItems.filter((it) => it.netOwn < 0);
  const sumOf = (xs: Item[]) => xs.reduce((t, it) => t + Math.abs(it.net), 0); // integer minor units in the common currency
  const approx = (xs: Item[]) => (xs.some((it) => it.converted) ? "≈ " : "");
  // People I share expenses with directly add to the same totals: the same currency exactly, another currency at the saved rate ("≈"),
  // and with no rate they are listed on their own ("Not in the total"). Each person is counted once, and a pair is never netted against a group.
  const pairsOpen = direct.filter((e) => e.net !== 0);
  const pairIn = (e: DirectEntry) => (e.currency === common ? Math.abs(e.net) : toCommon(Math.abs(e.net), e.currency));
  const pairsInTotal = pairsOpen.filter((e) => pairIn(e) !== null);
  const notInTotal = pairsOpen.filter((e) => pairIn(e) === null);
  const pairSum = (xs: DirectEntry[]) => xs.reduce((t, e) => t + (pairIn(e) ?? 0), 0);
  const pairApprox = (xs: DirectEntry[]) => (xs.some((e) => e.currency !== common) ? "≈ " : "");
  const owePairs = pairsInTotal.filter((e) => e.net < 0);
  const owedPairs = pairsInTotal.filter((e) => e.net > 0);
  const whoKey = (e: DirectEntry) => (e.other.accountId ? `acc:${e.other.accountId}` : `pair:${e.groupId}`);
  const oweCount = new Set([...oweItems.map((it) => it.key), ...owePairs.map(whoKey)]).size;
  const owedCount = new Set([...inList.map((it) => it.key), ...owedPairs.map(whoKey)]).size;
  const oweTotal = `${approx(oweItems) || pairApprox(owePairs)}${formatMoney(sumOf(oweItems) + pairSum(owePairs), common)}`;
  const owedTotal = `${approx(inList) || pairApprox(owedPairs)}${formatMoney(sumOf(inList) + pairSum(owedPairs), common)}`;
  const groupOwedTotal = `${approx(inList)}${formatMoney(sumOf(inList), common)}`; // the TO RECEIVE section is about groups only
  const showOwe = oweCount > 0 || owedCount === 0; // if I owe anyone, the summary is about that; the owed total sits in its own section
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  const notInTotalLine = notInTotal.length
    ? `Not in the total: ${notInTotal.map((e) => (e.net < 0 ? `you owe ${e.other.name} ${formatMoney(-e.net, e.currency)}` : `${e.other.name} owes you ${formatMoney(e.net, e.currency)}`)).join("; ")}`
    : "";
  const nothingOpen = settleItems.every(isEvenItem) && pairsOpen.length === 0; // even-across-groups people have their own small section below
  const evenNames = evenList.map((it) => firstName(it.name));
  const evenNamed = evenNames.length <= 1 ? evenNames.join("") : `${evenNames.slice(0, -1).join(", ")} and ${evenNames[evenNames.length - 1]}`;
  const otherRows = othersPending.map((g) => ({ id: g.group.id, name: g.group.name, n: g.transfers.filter((t) => t.from !== g.myId && t.to !== g.myId).length }));
  const otherCount = otherRows.reduce((t, r) => t + r.n, 0);
  const SHEET_NOTE = PAYMENT_LINE;

  const card = (it: Item, way: "in" | "out" | "even") => {
    const first = firstName(it.name);
    const parts = it.parts;
    // Part payments exist for one group in one currency ("Paid a different amount?" opens that group's Record a payment).
    const single = parts.length === 1 && !it.converted ? parts[0] : null;
    const partHref = single ? differentAmountFor(single.groupId, single.fromId, single.toId, toInputAmount(single.amount, single.currency), false) : undefined;
    const names = [...new Set(parts.map((p) => p.groupName))];
    const groupLine = names.length <= 2 ? names.join(" · ") : `${names.length} groups`;
    const even = way === "even";
    const tone = even ? ("even" as const) : it.netOwn > 0 ? ("owed" as const) : ("owe" as const);
    const amount = even ? "Even across groups" : it.netOwn === 0 ? "Even" : amt(it, it.net, listFmt);
    const pv = crossPreview(it, common);
    // Remind about a part where they owe you (never one where you're the one paying).
    const biggest = [...parts].filter((p) => !p.iPay).sort((a, b) => b.amount - a.amount)[0];
    const { buttons } = payButtonsOf(it);
    const b0 = buttons[0];
    const menu: MenuItem[] = [];
    if (way === "in") menu.push({ key: "received", label: "Mark received", opensSheet: true, attrs: { "data-mark-received": "" } });
    if (partHref) menu.push({ key: "part", label: way === "in" ? "Received a different amount" : "Pay part", href: partHref, attrs: { "data-different-amount": "" } });
    if (way === "out" && it.netOwn < 0) menu.push({ key: "details", label: "Payment details", href: `/settle?pay=${encodeURIComponent(it.id)}` });
    for (const p of parts) {
      menu.push(
        parts.length === 1
          ? { key: `open-${p.groupId}`, label: `Open ${p.groupName}`, href: `/groups/${p.groupId}?tab=balances` }
          : // Just this group for now (the trip today, the flat at month-end).
            { key: `only-${p.groupId}`, label: `Settle only in ${p.groupName}`, href: `/groups/${p.groupId}/settle` },
      );
    }
    return (
      <SettleCard
        key={it.id}
        id={settleRowId(way === "in" ? "remind" : "pay", it.id)}
        caption={even ? evenCaption(it) : undefined}
        name={it.name}
        groupLine={groupLine}
        amount={amount}
        tone={tone}
        main={
          way === "in" && biggest
            ? {
                kind: "node",
                node: (
                  <Link href={`/groups/${biggest.groupId}/remind?from=${biggest.fromId}`} data-remind className={BIG_CREAM}>
                    Remind {first}
                  </Link>
                ),
              }
            : { kind: "sheet", label: even ? "Clear both" : way === "in" ? "Mark received" : "Record payment" }
        }
        menu={menu}
        breakdown={
          <div className="mt-1 rounded-2xl bg-mist px-3.5 py-3 text-[13.5px] leading-snug text-fg/75" data-breakdown-body>
            <ul className="space-y-1" data-cross-lines>
              {pv.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {parts.length > 1 && (
              <p className="mt-2 border-t border-line pt-2 font-semibold text-fg" data-cross-total>
                {pv.total}
              </p>
            )}
            {parts.length > 1 && !even && <p className="mt-1 text-fg/60">{`1 payment instead of ${parts.length}`}</p>}
          </div>
        }
        sheet={
          even
            ? { title: "Clear both", subtitle: CLEAR_BOTH_SUBTITLE, from: "You", to: it.name, other: it.name, groupLine, amount, tone, even: true, lines: clearBothLines(it), confirmLabel: "Clear both", note: CLEAR_BOTH_NOTE }
            : way === "in"
            ? { title: "Mark received", subtitle: `Confirm only after ${first} has paid you.`, from: it.name, to: "You", other: it.name, groupLine, amount, tone, partHref, confirmLabel: "Confirm payment received", note: SHEET_NOTE }
            : {
                title: "Record payment",
                subtitle: `Confirm only after you’ve paid ${first}.`,
                from: "You",
                to: it.name,
                other: it.name,
                groupLine,
                amount,
                tone,
                partHref,
                // The person's UPI ID / pay link: the same link the Pay steps open.
                payWith: b0 ? { href: b0.href, label: b0.kind === "upi" ? "UPI" : b0.label, kind: b0.kind } : undefined,
                confirmLabel: "Confirm payment recorded",
                note: SHEET_NOTE,
              }
        }
        action={settleAcrossGroups}
        fields={
          <>
            <FreshKey name="rid" />
            <input type="hidden" name="parts" value={JSON.stringify(parts.map((p) => ({ groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount })))} />
          </>
        }
      />
    );
  };

  // ---- People I share expenses with directly ----
  const show = showParam === "all" ? "all" : showParam === "settled" ? "settled" : "open";
  const q = (qParam ?? "").trim().replace(/\s+/g, " ").slice(0, 60).toLowerCase();
  const directShown = filterDirect(direct, { show, q });
  const dOwe = directShown.filter((e) => e.net < 0);
  const dOwed = directShown.filter((e) => e.net > 0);
  const dSettled = directShown.filter((e) => e.net === 0);
  const showHref = (v: string) => `/settle?${new URLSearchParams({ ...(v !== "open" ? { show: v } : {}), ...(q ? { q } : {}) })}`;
  const directCard = (e: DirectEntry) => {
    const first = firstName(e.other.name);
    const iOwe = e.net < 0;
    const amount = formatMoney(Math.abs(e.net), e.currency);
    const line = e.shared ? "With a person" : "With a person · only you can see this";
    const from = iOwe ? e.myId : e.other.id;
    const to = iOwe ? e.other.id : e.myId;
    const part = { groupId: e.groupId, fromId: from, toId: to, amount: Math.abs(e.net) };
    const partHref = differentAmountFor(e.groupId, from, to, toInputAmount(Math.abs(e.net), e.currency), false);
    const a = iOwe && e.other.accountId ? accounts.find((x) => x.id === e.other.accountId) : undefined;
    const b0 = payButtons(a, { amount: -e.net, currency: e.currency, toName: e.other.name, note: "Loopin settle-up" })[0];
    const menu: MenuItem[] = [];
    if (!iOwe) menu.push({ key: "received", label: "Mark received", opensSheet: true, attrs: { "data-mark-received": "" } });
    menu.push({ key: "history", label: "View history", href: `/people/${e.groupId}` });
    menu.push({ key: "part", label: iOwe ? "Pay part" : "Received a different amount", href: partHref, attrs: { "data-different-amount": "" } });
    if (iOwe && a && (a.upiId || a.payLink)) menu.push({ key: "details", label: "Payment details", href: `/settle?pay=${encodeURIComponent(`direct:${e.groupId}`)}` });
    return (
      <SettleCard
        key={e.groupId}
        id={`direct-${e.groupId}`}
        name={e.other.name}
        groupLine={line}
        caption={iOwe ? `You owe ${e.other.name}` : `${e.other.name} owes you`}
        href={`/people/${e.groupId}`}
        amount={amount}
        tone={iOwe ? "owe" : "owed"}
        main={
          iOwe
            ? { kind: "sheet", label: "Record payment" }
            : {
                kind: "node",
                node: (
                  <Link href={`/groups/${e.groupId}/remind?from=${e.other.id}`} data-remind className={BIG_CREAM}>
                    Remind {first}
                  </Link>
                ),
              }
        }
        menu={menu}
        breakdown={
          <div className="mt-1 rounded-2xl bg-mist px-3.5 py-3 text-[13.5px] leading-snug text-fg/75" data-breakdown-body>
            <p>{`Only between you and ${e.other.name}. Not combined with any group.`}</p>
          </div>
        }
        sheet={
          iOwe
            ? {
                title: "Record payment",
                subtitle: `Confirm only after you’ve paid ${first}.`,
                from: "You",
                to: e.other.name,
                other: e.other.name,
                groupLine: "With a person",
                amount,
                tone: "owe",
                partHref,
                payWith: b0 ? { href: b0.href, label: b0.kind === "upi" ? "UPI" : b0.label, kind: b0.kind } : undefined,
                confirmLabel: "Confirm payment recorded",
                note: SHEET_NOTE,
              }
            : { title: "Mark received", subtitle: `Confirm only after ${first} has paid you.`, from: e.other.name, to: "You", other: e.other.name, groupLine: "With a person", amount, tone: "owed", partHref, confirmLabel: "Confirm payment received", note: SHEET_NOTE }
        }
        action={settleAcrossGroups}
        fields={
          <>
            <FreshKey name="rid" />
            <input type="hidden" name="parts" value={JSON.stringify([part])} />
          </>
        }
      />
    );
  };
  const settledCard = (e: DirectEntry) => (
    <li key={e.groupId} id={`direct-${e.groupId}`} className="scroll-mt-6" data-settle-card={e.other.name} data-direct-settled>
      <div className="rounded-[22px] border border-line bg-white p-4">
        <Link href={`/people/${e.groupId}`} className="flex min-h-11 flex-wrap items-start gap-x-3 gap-y-2 active:opacity-80" data-settle-person>
          <Initial name={e.other.name} />
          <div className="min-w-[9em] flex-1 basis-[9em] pt-0.5">
            <p className="break-words font-display text-[20px] font-semibold leading-tight tracking-[-0.01em] hyphens-auto">{e.other.name}</p>
            <p className="mt-0.5 break-words text-[14px] text-fg/60">{e.shared ? "With a person" : "With a person · only you can see this"}</p>
          </div>
        </Link>
        <p className="mt-3 font-display text-[24px] font-semibold leading-none tracking-[-0.02em] text-fg" data-settle-amount>
          All settled
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {directEntryOn() ? (
            <Link href={`/groups/${e.groupId}/add`} className={OUTLINE_PILL}>
              Add expense
            </Link>
          ) : (
            <span />
          )}
          <Link href={`/people/${e.groupId}`} className={OUTLINE_PILL}>
            View history
          </Link>
        </div>
      </div>
    </li>
  );
  const filterLink = (v: "open" | "all" | "settled", label: string) => (
    <Link key={v} href={showHref(v)} replace aria-current={show === v ? "page" : undefined} className={`flex min-h-11 flex-1 items-center justify-center rounded-full border-[1.5px] text-sm transition-colors ${show === v ? "border-fg font-semibold text-fg" : "border-transparent text-fg/55"}`} data-direct-filter={v}>
      {label}
    </Link>
  );

  const sectionHead = (label: string, n: number, right?: React.ReactNode) => (
    <h2 className="mb-2.5 mt-7 flex items-baseline justify-between gap-3 px-1 text-[13px] font-semibold tracking-[0.14em] text-fg/75">
      <span>{`${label} · ${n}`}</span>
      {right}
    </h2>
  );

  return (
    <>
      <header className="mb-5 flex items-center gap-3">
        <Link href="/" aria-label="Back" className={iconButtonClass}>
          <BackIcon size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.02em]">Settle up</h1>
          <p className="text-[15px] leading-snug text-fg/65">{direct.length > 0 ? "Across your groups and people" : "Across all your groups"}</p>
        </div>
      </header>

      {notice === "done" && <Notice params={["settle"]} className="mb-3">Recorded in each group. Everyone’s notified.</Notice>}
      {notice === "changed" && <Notice params={["settle"]} className="mb-3">Balances just changed. Here’s the latest.</Notice>}
      {notice === "stale" && <Notice tone="error" params={["settle"]} className="mb-3">{STALE_KEY_ERROR}</Notice>}
      {notice === "error" && <Notice tone="error" params={["settle"]} className="mb-3">Couldn’t record that. Try again.</Notice>}
      {notice === "toobig" && <Notice tone="error" params={["settle"]} className="mb-3">{PAYMENT_TOO_BIG_SHORT}</Notice>}
      {notice === "busy" && <Notice tone="error" params={["settle"]} className="mb-3">{PAY_CHANGE_LIMIT_TEXT}</Notice>}

      {all.length === 0 && direct.length === 0 ? (
        <p className="rounded-[20px] border border-line bg-white px-4 py-8 text-center text-sm text-fg/60">
          Once you add shared costs, you’ll see who to pay here.{" "}
          <Link href="/groups/new" className="text-fg underline underline-offset-4">Create a group</Link>, or open an invite link from a friend.
        </p>
      ) : nothingOpen && skippedLinks.length > 0 ? (
        // Nothing to add up here, but some groups are left out: never "All square" while they are.
        <div className="rounded-[20px] border border-line bg-white px-5 py-8 text-center">
          <p className="font-display text-2xl font-semibold">Nothing to add up yet</p>
          <p className="mt-1 text-sm text-fg/60">Some groups are waiting on an exchange rate. Settle those inside each group.</p>
        </div>
      ) : nothingOpen ? (
        <div className="rounded-[20px] border border-line bg-white px-5 py-10 text-center">
          <SquareSeal size={56} className="mx-auto" />
          {evenList.length > 0 ? (
            <>
              <p className="mt-3 font-display text-2xl font-semibold" data-nothing-to-pay>Nothing to pay</p>
              <p className="mt-1 text-sm text-fg/60">{`You’re even with ${evenNamed} across groups.`}</p>
            </>
          ) : (
            <>
              <p className="mt-3 font-display text-2xl font-semibold">All square</p>
              <p className="mt-1 text-sm text-fg/60">You’re settled up with everyone.</p>
            </>
          )}
        </div>
      ) : (
        <section aria-label="Summary" data-settle-summary className="rounded-[24px] border border-line bg-white px-5 py-5">
          <p className="text-[12.5px] font-medium tracking-[0.14em] text-fg/70">{showOwe ? "TOTAL YOU OWE" : "TOTAL OWED TO YOU"}</p>
          <p
            className={`money mt-2 whitespace-nowrap font-display font-semibold leading-none tracking-[-0.02em] lining-nums tabular-nums ${showOwe ? "text-owe" : "text-owed"} ${
              [...(showOwe ? oweTotal : owedTotal)].length <= 9 ? "text-[38px] min-[360px]:text-[44px]" : [...(showOwe ? oweTotal : owedTotal)].length <= 12 ? "text-[32px] min-[360px]:text-[38px]" : "text-[26px] min-[360px]:text-[30px]"
            }`}
            data-settle-total
          >
            {showOwe ? oweTotal : owedTotal}
          </p>
          <p className="mt-3 text-[16px] text-fg/80">{`${people(showOwe ? oweCount : owedCount)} to settle with`}</p>
          {notInTotalLine && <p className="mt-2 text-[14px] leading-snug text-fg/65" data-not-in-total>{notInTotalLine}</p>}
          <hr className="my-4 border-line" />
          <InfoNote>Pay outside Loopin, then record it here.</InfoNote>
        </section>
      )}

      {directEntryOn() && !(all.length === 0 && direct.length === 0) && (
        <Link href="/add/person" className="mt-3 flex min-h-12 items-center justify-center rounded-full border border-fg/25 px-5 text-[15px] font-semibold text-fg active:bg-fg/10" data-add-with-someone>
          Add expense with someone
        </Link>
      )}

      {direct.length > 0 && (
        <section id="direct" className="scroll-mt-6" aria-label="With a person" data-direct-section>
          <h2 className="mb-2.5 mt-7 px-1 text-[13px] font-semibold tracking-[0.14em] text-fg/75">WITH A PERSON</h2>
          <nav aria-label="Show" className="mb-3 flex gap-1 rounded-full border border-line p-1">
            {filterLink("open", "Open")}
            {filterLink("all", "All")}
            {filterLink("settled", "Settled")}
          </nav>
          <form method="get" action="/settle" role="search" className="mb-3 flex gap-2">
            {show !== "open" && <input type="hidden" name="show" value={show} />}
            <input name="q" defaultValue={qParam?.slice(0, 60) ?? ""} placeholder="Search by name" aria-label="Search people by name" autoComplete="off" className="min-h-11 min-w-0 flex-1 rounded-2xl border border-line bg-mist px-4 text-base text-fg outline-none placeholder:text-gray-400 focus:border-fg/40" />
            <button type="submit" className="min-h-11 shrink-0 rounded-full border border-fg/25 px-4 text-[15px] font-semibold active:bg-fg/10">
              Search
            </button>
          </form>
          {directShown.length === 0 && <p className="px-1 py-3 text-[15px] text-fg/65" data-direct-none>{q ? "Nobody by that name here." : show === "settled" ? "Nobody is settled yet." : "Nothing to settle with a person."}</p>}
          {dOwe.length > 0 && (
            <>
              {sectionHead("YOU OWE", dOwe.length)}
              <ul className="lp-rise space-y-3">{dOwe.map(directCard)}</ul>
            </>
          )}
          {dOwed.length > 0 && (
            <>
              {sectionHead("OWE YOU", dOwed.length)}
              <ul className="lp-rise space-y-3">{dOwed.map(directCard)}</ul>
            </>
          )}
          {dSettled.length > 0 && (
            <>
              {sectionHead("SETTLED", dSettled.length)}
              <ul className="lp-rise space-y-3">{dSettled.map(settledCard)}</ul>
            </>
          )}
        </section>
      )}

      {direct.length > 0 && settleItems.length > 0 && <h2 className="mb-1 mt-9 px-1 text-[13px] font-semibold tracking-[0.14em] text-fg/75" data-in-groups>IN GROUPS</h2>}

      {outList.length > 0 && (
        <section id="pay" className="scroll-mt-6" aria-label="To pay">
          {sectionHead("TO PAY", outList.length)}
          <ul className="lp-rise space-y-3">{outList.map((it) => card(it, "out"))}</ul>
        </section>
      )}
      {evenList.length > 0 && (
        <section id="even" className="scroll-mt-6" aria-label="Even across groups" data-even-section>
          {sectionHead("EVEN ACROSS GROUPS", evenList.length)}
          <ul className="lp-rise space-y-3">{evenList.map((it) => card(it, "even"))}</ul>
        </section>
      )}
      {inList.length > 0 && (
        <section id="remind" className="scroll-mt-6" aria-label="To receive">
          {sectionHead(
            "TO RECEIVE",
            inList.length,
            showOwe && outList.length > 0 ? (
              <span className="money text-[15px] font-semibold tracking-normal tabular-nums text-owed" data-settle-owed-total>
                {groupOwedTotal}
              </span>
            ) : undefined,
          )}
          <ul className="lp-rise space-y-3">{inList.map((it) => card(it, "in"))}</ul>
        </section>
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

      {/* Payments between other members of your groups: the row opens in place (each group links to its balances). */}
      {othersPending.length > 0 && (
        <details className="group mt-6 border-y border-line" data-others-pending>
          <summary className="flex min-h-[64px] cursor-pointer list-none items-center gap-3.5 py-3 [&::-webkit-details-marker]:hidden">
            <svg aria-hidden width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg/75">
              <circle cx="9" cy="8.5" r="3" />
              <path d="M3.5 19c.6-3 2.8-4.7 5.5-4.7s4.9 1.7 5.5 4.7" />
              <circle cx="17" cy="9.5" r="2.4" />
              <path d="M16.5 14.4c2.4.1 4 1.5 4.5 4.1" />
            </svg>
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-medium leading-snug">Other group payments</span>
              <span className="block text-[14px] leading-snug text-fg/60">{`${otherCount} ${otherCount === 1 ? "payment" : "payments"} between other members`}</span>
            </span>
            <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg/60 transition-transform group-open:rotate-90 motion-reduce:transition-none">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </summary>
          <div className="pb-4">
            <p className="mb-2 text-sm text-fg/60">Others still settling between themselves</p>
            <ul className="flex flex-wrap gap-2">
              {otherRows.map((r) => (
                <li key={r.id}>
                  <Link href={`/groups/${r.id}?tab=balances`} className="inline-flex min-h-11 items-center rounded-full border border-fg/25 px-3.5 text-sm active:bg-mist">
                    {r.name}, {r.n} {r.n === 1 ? "payment" : "payments"}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      <p className="mt-5 px-1 text-[13.5px] leading-snug text-fg/60" data-settle-footnote>
        {PAYMENT_LINE}
      </p>
    </>
  );
}
