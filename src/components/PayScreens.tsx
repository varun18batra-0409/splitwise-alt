import Image from "next/image";
import Link from "@/components/Link";
import { GroupCover } from "@/components/GroupCover";
import { Amount, CREAM, PassFields, PassRoute, Route, TicketShell, type StubCover } from "@/components/HomeMoney";
import { amountTier, endCode, type GroupMark, type PassField } from "@/lib/home/money-card";
import type { PayWays } from "@/lib/pay-links";
import { maskPayWay } from "@/lib/pay-words";

// The payment screens, drawn as the same full boarding pass Home uses (HomeMoney's TicketShell, PassRoute, Amount and PassFields): a stub with
// a barcode, a perforation with notches, the route (From KAB, plane taking off, To YOU), the amount, small labelled fields and ONE cream action. This file only draws; every action, form field and amount is passed in by the page that owns it.
// Colour is only for money (orange you owe, green you're owed); everything else is off-white.

export const OUTLINE_PILL =
  "flex h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-full border border-fg/25 px-3.5 text-[15px] font-semibold text-fg transition-transform active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";
// A quiet text link or text button under a ticket's one big action.
export const QUIET = "inline-flex min-h-11 items-center text-[13.5px] font-medium text-fg/75 active:opacity-70";
const CARD = "rounded-[20px] border border-[#26262c] bg-[#16161a]";
const STEP = "grid h-6 w-6 shrink-0 place-items-center rounded-full bg-mist text-[13px] font-semibold text-fg";

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

const TONE = { owe: "text-owe", owed: "text-owed", plain: "text-fg" } as const;

function CoverFill({ c, sizes }: { c: StubCover; sizes: string }) {
  return (
    <>
      <GroupCover {...c.cover} uid={`ps-${c.id}`} letter={c.name} small sizes={sizes} quality={80} />
      {c.photo && <Image src={c.photo} alt="" aria-hidden fill sizes={sizes} quality={80} className="object-cover" />}
    </>
  );
}

export type TicketStub = { letter: string } | { covers: StubCover[] };

// One boarding pass for a payment. `stub`: the group's picture (all-groups Settle up, as on Home) or, inside a group whose picture is already
// on the page above, the person's initial on paper. `fields`: the small labelled fields (Group, Since, Items); none are drawn when empty.
// `sr` is the plain sentence for screen readers and tests ("Meera pays you ₹500"): the drawn route is hidden from them so it isn't read twice.
export function PayTicket({
  as: Tag = "li",
  id,
  attrs,
  stub,
  from,
  to,
  mark: _mark,
  amount,
  tone,
  sr,
  showSr = true,
  fields,
  plain = false,
  children,
}: {
  plain?: boolean; // inside a group: the card from before the mockups (initial, "Meera pays you", the amount), no boarding pass
  as?: "li" | "div";
  id?: string;
  attrs?: Record<string, string | undefined>;
  stub: TicketStub;
  from: string;
  to: string;
  mark?: GroupMark; // kept so callers don't change: the mark is always the plane taking off
  amount?: string;
  tone: keyof typeof TONE;
  sr: string;
  showSr?: boolean; // false when the ticket's own words already say it
  fields?: PassField[];
  children?: React.ReactNode;
}) {
  if (plain) {
    // Inside a group (founder, 15 Nov: "nothing to do with boarding pass inside the group"): the rounded card from before the
    // mockups: the other person's initial, who pays whom in words, the exact amount, then the same buttons as before.
    const pays = amount ? `${from === "You" ? "You pay" : `${firstName(from)} pays`} ${to === "You" ? "you" : firstName(to)}` : "";
    const other = from === "You" ? to : from;
    return (
      <Tag id={id} className="scroll-mt-6" {...attrs}>
        {showSr && <span className="sr-only">{sr}</span>}
        <div className="glass flex flex-col rounded-[22px] px-[18px] py-4" data-plain-card>
          {amount && (
            <div className="flex items-center gap-3" aria-hidden>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mist font-display text-sm font-semibold text-fg">{(other.trim().charAt(0) || "?").toUpperCase()}</span>
              <div className="min-w-0">
                <p className="truncate text-[14px] text-fg/75">{pays}</p>
                <p className={`money whitespace-nowrap font-display text-[22px] font-medium leading-tight tabular-nums ${TONE[tone]}`} data-net-balance>
                  {amount}
                </p>
              </div>
            </div>
          )}
          {children}
        </div>
      </Tag>
    );
  }
  return (
    <Tag id={id} className="scroll-mt-6" {...attrs}>
      {showSr && <span className="sr-only">{sr}</span>}
      <TicketShell stub={"covers" in stub ? stub.covers : []} paper={"letter" in stub ? [stub.letter.trim().charAt(0).toUpperCase() || "?"] : undefined} label={sr} attrs={{}} barcode>
        <div aria-hidden>
          <PassRoute from={endCode(from)} to={endCode(to)} />
        </div>
        {amount && <Amount text={amount} tone={tone} tier={amountTier(amount)} />}
        {fields && fields.length > 0 && <PassFields fields={fields} />}
        {children}
      </TicketShell>
    </Tag>
  );
}

// One slim bar filled to the share of the money already paid back ("25% settled"): the same number as its aria-label.
export function SettleProgress({ pct }: { pct: number }) {
  const p = Math.min(Math.max(pct, 0), 100);
  return (
    <div className="mt-4 flex items-center gap-3" role="img" aria-label={`${pct}% settled`} data-settled-pct={pct}>
      <span aria-hidden className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-fg/15">
        <i className="absolute inset-y-0 left-0 rounded-full bg-fg/80" style={{ width: `${p}%` }} />
      </span>
      <span aria-hidden className="shrink-0 text-[12.5px] text-fg/55">
        {pct}% settled
      </span>
    </div>
  );
}

// ---- Pay Nupur (step by step) ----

export function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2.5 text-[13px] leading-snug text-fg/55">
      <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="mt-px shrink-0">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16.5v.5" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

// `payApp`: the existing "Open payment app" link(s) (PayAppButtons), or nothing when the person has no saved way to be paid.
// `tellButton`: the "I've paid" button (it records the payment at once), already styled by the caller (outline, or cream when there is no payment app).
// `tellButton` is null when nothing can be recorded here (I left, or the group is closed): step 2 is hidden and `noClaimNote` says why.
export function PayView({ name, amount, cover, groupName, ways, payApp, tellButton, noClaimNote }: { name: string; amount: string; cover?: StubCover; groupName: string; ways: PayWays | null; payApp?: React.ReactNode; tellButton: React.ReactNode; noClaimNote?: string }) {
  const masked = maskPayWay(ways);
  const first = firstName(name);
  return (
    <div className="space-y-5" data-pay-view>
      <div className="relative h-[112px] overflow-hidden rounded-[20px] bg-mist">
        {cover && <CoverFill c={cover} sizes="448px" />}
        <span aria-hidden className="absolute inset-0 bg-black/35" />
        <p className="absolute bottom-3 left-4 right-4 truncate font-display text-[19px] font-semibold text-fg">{groupName}</p>
      </div>
      <p className="font-display text-[32px] font-medium leading-none tracking-[-0.03em] lining-nums tabular-nums text-owe" data-pay-amount>
        {amount}
      </p>
      <div className={`${CARD} flex items-center gap-3 px-4 py-3`}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-mist text-[15px] font-bold text-fg/80" aria-hidden>
          {name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{name}</span>
          {masked && <span className="block truncate text-[13px] text-fg/55">{masked}</span>}
        </span>
      </div>
      <ol className="space-y-5">
        <li>
          <p className="flex items-center gap-3 text-[15px] font-semibold">
            <span className={STEP}>1</span>Pay in your payment app
          </p>
          {payApp ? <div className="mt-3 flex flex-wrap gap-2">{payApp}</div> : <p className="mt-2 pl-9 text-[13.5px] text-fg/55">Pay {first} any way you both use.</p>}
        </li>
        {tellButton && (
          <li>
            <p className="flex items-center gap-3 text-[15px] font-semibold">
              <span className={STEP}>2</span>Return and record it
            </p>
            <div className="mt-3">{tellButton}</div>
          </li>
        )}
      </ol>
      {!tellButton && noClaimNote && <InfoNote>{noClaimNote}</InfoNote>}
      <InfoNote>Opening a payment app does not confirm payment.</InfoNote>
    </div>
  );
}

// ---- Payment recorded ----

// The ticket with its stub torn off: the stub is turned a little and carries the green "Paid" stamp. It drops 6px and turns, once
// (none with reduced motion: it simply sits turned).
export function RecordedView({
  from,
  to,
  mark,
  amount,
  groupName,
  headline,
  sub,
  stubName,
  stubLine,
  note,
  backHref,
  undo,
}: {
  from: string;
  to: string;
  mark: GroupMark;
  amount: string;
  groupName: string;
  headline: string;
  sub: string;
  stubName: string;
  stubLine: string;
  note?: string; // e.g. "Nupur now owes you ₹100" when more than what was owed was recorded
  backHref: string;
  undo: React.ReactNode; // the existing Undo form, or null when it can't be undone
}) {
  // Green means money coming to you: only when you are the person paid. If you paid, or you are neither, the amount and the stamp are off-white.
  const notPaidToMe = to !== "You";
  const hue = notPaidToMe ? "text-fg" : "text-owed";
  return (
    <div className="mx-auto max-w-sm pt-2" data-payment-recorded>
      <section aria-label="Payment recorded" className={`${CARD} px-4 pb-4 pt-4`}>
        <p className="sr-only">
          {from} paid {to === "You" ? "you" : to} {amount} in {groupName}
        </p>
        <div aria-hidden>
          <Route from={from} to={to} mark={mark} />
        </div>
        <p className={`mt-2.5 font-display text-[30px] font-medium leading-none tracking-[-0.03em] lining-nums tabular-nums ${hue}`}>{amount}</p>
        <p className="mt-1.5 truncate text-[13.5px] text-fg/55">{groupName}</p>
      </section>
      <div className="lp-stub relative mx-2 -mt-px flex items-center gap-3 rounded-b-[18px] border border-t-2 border-dashed border-[#34343b] bg-[#16161a] px-4 py-3.5">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-mist text-[15px] font-bold text-fg/80">
          {stubName.trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[15px] font-semibold">{stubName}</b>
          <span className="block truncate text-[13px] text-fg/55">{stubLine}</span>
        </span>
        <span aria-hidden className={`relative grid h-[60px] w-[60px] shrink-0 -rotate-12 place-items-center rounded-full border-[2.5px] ${notPaidToMe ? "border-fg" : "border-owed"} font-display text-[16px] font-semibold ${hue}`}>
          <span className={`absolute inset-[3px] rounded-full border ${notPaidToMe ? "border-fg/50" : "border-owed/50"}`} />
          Paid
        </span>
      </div>
      <h2 className="mt-8 text-center font-display text-[28px] font-semibold leading-tight tracking-[-0.02em]">{headline}</h2>
      {note && <p className="mt-2 text-center text-[14px] font-medium text-fg/80">{note}</p>}
      <p className="mt-2 text-center text-[14px] text-fg/60">{sub}</p>
      <Link href={backHref} className={`${CREAM} mt-6 w-full`}>
        Back to {groupName}
      </Link>
      {undo}
    </div>
  );
}
