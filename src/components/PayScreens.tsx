import Image from "next/image";
import Link from "@/components/Link";
import { GroupCover } from "@/components/GroupCover";
import { CREAM, Mark, Route, TicketShell, type StubCover } from "@/components/HomeMoney";
import type { GroupMark } from "@/lib/home/money-card";
import type { PayWays } from "@/lib/pay-links";
import { maskPayWay, progressSegments } from "@/lib/pay-words";

// The payment screens, drawn as the same boarding-pass ticket Home uses: a stub, a perforation, then the route ("Meera ┄ ✈ You"),
// the amount and ONE cream action. This file only draws; every action, form field and amount is passed in by the page that owns it.
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

// A calm amount: steps down for very long figures so it never gets cut.
function amountSize(text: string): string {
  const n = [...text].length;
  return n <= 10 ? "text-[26px]" : n <= 13 ? "text-[22px]" : "text-[19px]";
}
const TONE = { owe: "text-owe", owed: "text-owed", plain: "text-fg" } as const;

export function TicketAmount({ text, tone }: { text: string; tone: keyof typeof TONE }) {
  return <p className={`mt-2.5 font-display font-medium leading-none tracking-[-0.03em] lining-nums tabular-nums [overflow-wrap:normal] ${amountSize(text)} ${TONE[tone]}`}>{text}</p>;
}

function CoverFill({ c, sizes }: { c: StubCover; sizes: string }) {
  return (
    <>
      <GroupCover {...c.cover} uid={`ps-${c.id}`} letter={c.name} small sizes={sizes} quality={80} />
      {c.photo && <Image src={c.photo} alt="" aria-hidden fill sizes={sizes} quality={80} className="object-cover" />}
    </>
  );
}

export type TicketStub = { letter: string } | { covers: StubCover[] };

// One ticket for a payment. `stub`: the group's picture (all-groups) or the person's initial (inside a group).
// `sr` is the plain sentence for screen readers and tests ("Meera pays you ₹500"): the drawn route is hidden from them so it isn't read twice.
export function PayTicket({
  as: Tag = "li",
  id,
  attrs,
  stub,
  from,
  to,
  mark,
  amount,
  tone,
  sr,
  showSr = true,
  children,
}: {
  as?: "li" | "div";
  id?: string;
  attrs?: Record<string, string | undefined>;
  stub: TicketStub;
  from: string;
  to: string;
  mark: GroupMark;
  amount?: string;
  tone: keyof typeof TONE;
  sr: string;
  showSr?: boolean; // false when the ticket's own words already say it
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <div aria-hidden>
        <Route from={from} to={to} mark={mark} />
      </div>
      {amount && <TicketAmount text={amount} tone={tone} />}
      {children}
    </>
  );
  return (
    <Tag id={id} className="scroll-mt-6" {...attrs}>
      {showSr && <span className="sr-only">{sr}</span>}
      {"covers" in stub ? (
        <TicketShell stub={stub.covers} label={sr} attrs={{}}>
          {body}
        </TicketShell>
      ) : (
        <section aria-label={sr} className="relative flex min-h-[176px] overflow-hidden rounded-[20px] bg-[#16161a] text-fg shadow-[inset_0_0_0_1px_#26262c]">
          <div className="relative flex w-[84px] shrink-0 items-center justify-center bg-mist min-[360px]:w-[100px]" data-ticket-stub="letter">
            <span aria-hidden className="font-display text-[38px] font-medium text-fg/75">
              {stub.letter.trim().charAt(0).toUpperCase()}
            </span>
          </div>
          <span aria-hidden className="my-3.5 w-0 shrink-0 border-l-2 border-dashed border-[#34343b]" />
          <span aria-hidden className="absolute -top-[11px] left-[75px] h-5 w-5 rounded-full bg-canvas shadow-[inset_0_0_0_1px_#26262c] min-[360px]:left-[91px]" />
          <span aria-hidden className="absolute -bottom-[11px] left-[75px] h-5 w-5 rounded-full bg-canvas shadow-[inset_0_0_0_1px_#26262c] min-[360px]:left-[91px]" />
          <div className="flex min-w-0 flex-1 flex-col px-3.5 pb-2 pt-4 min-[360px]:pl-[18px] min-[360px]:pr-4">{body}</div>
        </section>
      )}
    </Tag>
  );
}

// "3 payments and you're all square": the bar has one segment per payment (filled = paid); a long list shows at most eight, proportionally.
export function SettleProgress({ done, total, pct }: { done: number; total: number; pct: number }) {
  const { segments: segs, filled } = progressSegments(done, total);
  return (
    <div className="mt-4 flex items-center gap-3" role="img" aria-label={`${pct}% settled`} data-settled-pct={pct}>
      <span aria-hidden className="flex min-w-0 flex-1 gap-1.5">
        {Array.from({ length: segs }, (_, i) => (
          <i key={i} className={`h-1 flex-1 rounded-full ${i < filled ? "bg-fg/80" : "bg-fg/15"}`} />
        ))}
      </span>
      <span className="shrink-0 text-[12.5px] text-fg/55">
        {Math.min(done, total)} of {total} done
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
// `tellButton`: the existing "I've paid" button, already styled by the caller (outline, or cream when there is no payment app).
export function PayView({ name, amount, cover, groupName, ways, payApp, tellButton }: { name: string; amount: string; cover?: StubCover; groupName: string; ways: PayWays | null; payApp?: React.ReactNode; tellButton: React.ReactNode }) {
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
        <li>
          <p className="flex items-center gap-3 text-[15px] font-semibold">
            <span className={STEP}>2</span>Return and tell {first}
          </p>
          <div className="mt-3">{tellButton}</div>
        </li>
      </ol>
      <InfoNote>Opening a payment app does not confirm payment.</InfoNote>
    </div>
  );
}

// ---- Waiting for Nupur ----

function ClockIcon() {
  return (
    <svg aria-hidden width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="text-fg/75">
      <circle cx="12" cy="12" r="9.25" />
      <path d="M12 6.8V12l3.4 2" />
    </svg>
  );
}

export function WaitingView({
  name,
  amount,
  cover,
  groupName,
  groupHref,
  backHref,
  toId,
  undo,
}: {
  name: string;
  amount: string;
  cover?: StubCover;
  groupName: string;
  groupHref: string;
  backHref: string;
  toId: string;
  undo: React.ReactNode; // the existing "take it back" form (withdrawClaimAction), with a quiet link-style button inside
}) {
  const first = firstName(name);
  return (
    <div className="space-y-5 pt-2" data-claim-waiting={toId}>
      <div className="flex flex-col items-center text-center">
        <ClockIcon />
        <h2 className="mt-3 font-display text-[28px] font-semibold leading-tight tracking-[-0.02em]">Waiting for {first}</h2>
        <p className="mt-2 font-display text-[26px] font-medium leading-none tracking-[-0.03em] lining-nums tabular-nums text-owe">{amount}</p>
        <p className="mt-2 text-sm text-fg/60">Payment reported</p>
      </div>
      <ol className={`${CARD} space-y-4 px-4 py-4`}>
        <li className="flex items-start gap-3">
          <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-fg text-canvas">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </span>
          <span>
            <b className="block text-[15px] font-semibold">You marked it paid</b>
            <span className="block text-[13px] text-fg/55">Just now</span>
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span aria-hidden className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-fg/40" />
          <span>
            <b className="block text-[15px] font-semibold">{first} confirms receipt</b>
            <span className="block text-[13px] text-fg/55">Pending</span>
          </span>
        </li>
      </ol>
      <div className={`${CARD} px-4 py-3`}>
        <InfoNote>Your balance updates after {first} confirms.</InfoNote>
      </div>
      <Link href={groupHref} className={`${CARD} flex min-h-[64px] items-center gap-3 py-2 pl-2 pr-4 active:opacity-80`}>
        <span aria-hidden className="relative block h-12 w-16 shrink-0 overflow-hidden rounded-[10px] bg-mist">
          {cover && <CoverFill c={cover} sizes="64px" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{groupName}</span>
        <span aria-hidden className="text-fg/40">
          ›
        </span>
      </Link>
      <Link href={backHref} className={`${CREAM} w-full`}>
        Back to {groupName}
      </Link>
      <div className="flex justify-center text-[13.5px] text-fg/60">
        <span className="inline-flex min-h-11 items-center gap-1.5">
          Made a mistake? {undo}
        </span>
      </div>
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
  backHref: string;
  undo: React.ReactNode; // the existing Undo form, or null when it can't be undone
}) {
  return (
    <div className="mx-auto max-w-sm pt-2" data-payment-recorded>
      <section aria-label="Payment recorded" className={`${CARD} px-4 pb-4 pt-4`}>
        <div aria-hidden>
          <Route from={from} to={to} mark={mark} />
        </div>
        <p className="mt-2.5 font-display text-[30px] font-medium leading-none tracking-[-0.03em] lining-nums tabular-nums text-owed">{amount}</p>
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
        <span aria-hidden className="relative grid h-[60px] w-[60px] shrink-0 -rotate-12 place-items-center rounded-full border-[2.5px] border-owed font-display text-[16px] font-semibold text-owed">
          <span className="absolute inset-[3px] rounded-full border border-owed/50" />
          Paid
        </span>
      </div>
      <h2 className="mt-8 text-center font-display text-[28px] font-semibold leading-tight tracking-[-0.02em]">{headline}</h2>
      <p className="mt-2 text-center text-[14px] text-fg/60">{sub}</p>
      <Link href={backHref} className={`${CREAM} mt-6 w-full`}>
        Back to {groupName}
      </Link>
      {undo}
    </div>
  );
}
