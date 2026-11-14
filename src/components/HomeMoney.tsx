import Image from "next/image";
import Link from "@/components/Link";
import { niceDate } from "@/lib/format";
import { ShareCountdown } from "@/components/ShareCountdown";
import { ExactAmount } from "@/components/ExactAmount";
import { GroupCover } from "@/components/GroupCover";
import { amountTier, routeCode, stripWords, type GroupMark, type Ticket, type TicketAction, type TicketLine } from "@/lib/home/money-card";
import type { CoverChoice } from "@/lib/covers";
import type { TripPhase } from "@/lib/countdown";

// Home's money card, as a boarding pass: a stub with the group's picture, a dashed perforation with two bites, then the route
// ("You ┄ ✈ Nupur"), the amount, the group's name and ONE cream button. Money both ways is two lines on the same ticket.
// No tinted wash and no coloured border: only the amount carries the colour (orange you owe, green you're owed).
// Below it, a quiet line for what waits on you. Lower down, the countdown line for a trip that is coming up.

export const CREAM = "pop flex h-11 min-w-0 items-center justify-center whitespace-nowrap bg-fg px-3 text-[15px] font-semibold text-canvas [--pop-edge:#6e6b63]";
const OUTLINE = "flex h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-full border border-fg/25 px-3.5 text-[15px] font-semibold text-fg transition-transform active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

const AMOUNT_SIZE = { xl: "text-[32px] min-[360px]:text-[38px]", l: "text-[26px] min-[360px]:text-[28px]", m: "text-[20px] min-[360px]:text-[22px]" } as const;

// What waits on you, as a quiet line under the card: the top one, or "2 payments to confirm · See them".
export type NeedLine = { text: React.ReactNode; action: string; href: string; count: number };

// A group's picture, filling its box (the box needs a size and `relative`). A trip with no picture of its own uses its place photo,
// the same as its polaroid. `sizes` is the shown width, so the phone gets a copy that is sharp at 2x.
export type StubCover = { id: string; cover: { kind: CoverChoice; src?: string }; photo?: string; name: string };
function CoverBox({ c, sizes }: { c: StubCover; sizes: string }) {
  return (
    <>
      <GroupCover {...c.cover} uid={`mc-${c.id}`} letter={c.name} small sizes={sizes} quality={80} />
      {c.photo && <Image src={c.photo} alt="" aria-hidden fill sizes={sizes} quality={80} className="object-cover" />}
    </>
  );
}

// The little mark on the route line: drawn, never an emoji.
export function Mark({ mark }: { mark: GroupMark }) {
  const common = { "aria-hidden": true, width: 14, height: 14, viewBox: "0 0 24 24", className: "shrink-0 text-fg/75" } as const;
  if (mark === "plane")
    return (
      <svg {...common} fill="currentColor" data-mark="plane">
        <path d="M21 15.5v-1.7l-7.6-4.7V3.8c0-.8-.6-1.5-1.4-1.5s-1.4.7-1.4 1.5v5.3L3 13.8v1.7l7.6-2.2v4.9l-2 1.5v1.4l3.4-.9 3.4.9v-1.4l-2-1.5v-4.9Z" />
      </svg>
    );
  if (mark === "house")
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" data-mark="house">
        <path d="M4 11 12 4l8 7M6.5 9.5V20h11V9.5M10 20v-5.5h4V20" />
      </svg>
    );
  if (mark === "heart")
    return (
      <svg {...common} fill="currentColor" data-mark="heart">
        <path d="M12 20.5C5 15.3 3 12 3 8.9 3 6.2 5 4.5 7.3 4.5c1.9 0 3.5 1 4.7 2.9 1.2-1.9 2.8-2.9 4.7-2.9C19 4.5 21 6.2 21 8.9c0 3.1-2 6.4-9 11.6Z" />
      </svg>
    );
  if (mark === "spade")
    return (
      <svg {...common} fill="currentColor" data-mark="spade">
        <path d="M12 2.5c3.2 3.6 7.5 6.3 7.5 10.3 0 2.4-1.8 4.1-4 4.1-1.1 0-2.1-.4-2.9-1.2.1 1.9.7 3.3 1.9 4.8h-5c1.2-1.5 1.8-2.9 1.9-4.8-.8.8-1.8 1.2-2.9 1.2-2.2 0-4-1.7-4-4.1C4.5 8.8 8.8 6.1 12 2.5Z" />
      </svg>
    );
  return (
    <svg {...common} fill="currentColor" data-mark="dot">
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

export function Route({ from, to, mark }: { from: string; to: string; mark: GroupMark }) {
  // Short codes ("KAB ✈ YOU"): the person's name is in the button below, so it is not said twice.
  const end = (t: string) => <span className="shrink-0 text-[13px] font-semibold tracking-[0.08em] text-fg/65" data-route-end>{routeCode(t)}</span>;
  return (
    <p className="flex items-center gap-2" data-route>
      {end(from)}
      <i aria-hidden className="h-px min-w-3 flex-1 [background:repeating-linear-gradient(90deg,#4a4a52_0_4px,transparent_4px_8px)]" />
      <Mark mark={mark} />
      {end(to)}
    </p>
  );
}

export function Amount({ text, exact, tone, tier }: { text: string; exact?: string; tone: "owe" | "owed" | "plain"; tier: "xl" | "l" | "m" }) {
  return (
    <p
      className={`mt-2.5 font-display font-medium leading-none tracking-[-0.03em] lining-nums tabular-nums [overflow-wrap:normal] ${AMOUNT_SIZE[tier]} ${tone === "owe" ? "text-owe" : tone === "owed" ? "text-owed" : "text-fg"}`}
      data-net-balance
      data-exact={exact && exact !== text ? exact : undefined}
      title={exact}
    >
      {exact && exact !== text ? <ExactAmount amount={text} exact={exact} /> : text}
    </p>
  );
}

export function ActionButton({ a, className }: { a: TicketAction; className: string }) {
  return (
    <Link href={a.href} aria-label={a.fullLabel !== a.label ? a.fullLabel : undefined} className={className} data-money-action={a.key} data-emphasis={a.bright ? "bright" : "quiet"}>
      <span className="min-w-0 truncate">{a.label}</span>
    </Link>
  );
}

function Faces({ line }: { line: TicketLine }) {
  return (
    <Link href={line.peopleHref} aria-label={`${line.phrase}. See who, in Settle up`} className="-my-0.5 mt-1 flex min-h-11 items-center self-start pr-2 active:opacity-70" data-money-people>
      <span aria-hidden className="flex">
        {line.faces.map((f, i) => (
          <span key={i} className="-ml-1.5 grid h-6 w-6 place-items-center rounded-full border-2 border-[#16161a] bg-[#2a2a31] text-[11px] font-bold text-fg/90 first:ml-0">
            {f}
          </span>
        ))}
      </span>
    </Link>
  );
}

// `action` is optional: on a group's own ticket the two lines carry no buttons (the one cream Settle up is below them).
export type BothLineData = Omit<TicketLine, "action"> & { action?: TicketAction };
// The amount on a "both sides" line shrinks with its length (like amountTier does for the one-sided ticket), so a lakh amount is never clipped.
export function bothAmountSize(text: string): string {
  const n = [...text].length;
  return n <= 9 ? "text-[24px]" : n <= 11 ? "text-[21px]" : n <= 13 ? "text-[18px]" : "text-[16px]";
}

export function BothLine({ line }: { line: BothLineData }) {
  const owe = line.side === "owe";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[#26262c] py-2 first:border-t-0 first:pt-0" data-ticket-line={line.side}>
      <Link href={line.peopleHref} aria-label={`${line.phrase} ${line.exact}. See who, in Settle up`} className="min-w-[7.5rem] flex-1 active:opacity-70" data-money-people>
        <span className="flex min-w-0 items-baseline gap-1 text-[14px] leading-tight text-fg/75">
          {owe ? (
            <>
              <span className="shrink-0">You owe</span>
              <b className="min-w-0 truncate font-semibold text-fg">{line.name}</b>
            </>
          ) : (
            <>
              <b className="min-w-0 truncate font-semibold text-fg">{line.name}</b>
              <span className="shrink-0">{line.count > 1 ? "owe" : "owes"} you</span>
            </>
          )}
        </span>
        <span className={`mt-0.5 block whitespace-nowrap font-display ${bothAmountSize(line.amount)} font-medium leading-tight tracking-[-0.02em] lining-nums tabular-nums [overflow-wrap:normal] ${owe ? "text-owe" : "text-owed"}`} data-net-balance title={line.exact}>
          {line.amount}
        </span>
      </Link>
      {line.action && <ActionButton a={line.action} className={`${line.action.bright ? CREAM : OUTLINE} h-11 min-w-[4.5rem]`} />}
    </div>
  );
}

// The ticket itself, shared by Home and a group's page: a stub with the group's picture(s), a dashed perforation with two bites,
// then `children` (the route, the amount and the one action). `attrs` are the data-* hooks the page's tests read.
export function TicketShell({ stub, label, attrs, children }: { stub: StubCover[]; label: string; attrs: Record<string, string | undefined>; children: React.ReactNode }) {
  const covers = stub.slice(0, 2);
  return (
    <section aria-label={label} className="relative flex min-h-[176px] overflow-hidden rounded-[20px] bg-[#16161a] text-fg shadow-[inset_0_0_0_1px_#26262c]" {...attrs}>
      {/* The stub: the group's picture (a small stack of two when the money is across groups). */}
      <div className="relative flex w-[84px] shrink-0 flex-col min-[360px]:w-[100px]" data-ticket-stub={covers.length}>
        {covers.length === 0 && <span aria-hidden className="absolute inset-0 bg-mist" />}
        {covers.map((c, i) => (
          <div key={c.id} className={`relative flex-1 overflow-hidden bg-mist ${i > 0 ? "border-t border-[#16161a]" : ""}`}>
            <CoverBox c={c} sizes="100px" />
          </div>
        ))}
      </div>
      {/* The perforation, with the two half-circle bites of a ticket. */}
      <span aria-hidden className="my-3.5 w-0 shrink-0 border-l-2 border-dashed border-[#34343b]" />
      <span aria-hidden className="absolute -top-[11px] left-[75px] h-5 w-5 rounded-full bg-canvas shadow-[inset_0_0_0_1px_#26262c] min-[360px]:left-[91px]" />
      <span aria-hidden className="absolute -bottom-[11px] left-[75px] h-5 w-5 rounded-full bg-canvas shadow-[inset_0_0_0_1px_#26262c] min-[360px]:left-[91px]" />
      <div className="flex min-w-0 flex-1 flex-col px-3.5 pb-3.5 pt-4 min-[360px]:pl-[18px] min-[360px]:pr-4">{children}</div>
    </section>
  );
}

export function MoneyCard({ ticket, mode, tone, stub, need }: { ticket: Ticket; mode: string; tone: "owed" | "owe" | "plain"; stub: StubCover[]; need?: NeedLine | null }) {
  // The route/amount block depends on the situation; the stub, perforation and notches are the same for all of them.
  return (
    <>
      <TicketShell
        stub={stub}
        label="Your money"
        attrs={{ "data-balance-card": "", "data-money-mode": mode, "data-tone": tone === "plain" ? "square" : tone, "data-ticket": ticket.kind }}
      >
          {ticket.kind === "both" ? (
            <div className="flex flex-1 flex-col justify-center" data-ticket-both>
              {ticket.lines.map((l) => (
                <BothLine key={l.side} line={l} />
              ))}
            </div>
          ) : ticket.kind === "one" ? (
            <>
              <Route from={ticket.from} to={ticket.to} mark={ticket.mark} />
              <Amount text={ticket.line.amount} exact={ticket.line.exact} tone={ticket.line.side} tier={amountTier(ticket.line.amount)} />
              <p className={ticket.line.faces.length > 0 ? "sr-only" : "mt-1 truncate text-[13.5px] text-fg/55"} data-ticket-context>{ticket.context}</p>
              {ticket.line.faces.length > 0 && <Faces line={ticket.line} />}
              <div className="mt-auto pt-3">
                <ActionButton a={ticket.line.action} className={`${CREAM} w-full`} />
              </div>
            </>
          ) : ticket.kind === "square" ? (
            // Nothing to do: "All square" and a quiet line, no button (the "+ New group" tile below is the only way to start one).
            <div className="my-auto">
              <Amount text={ticket.amount} tone="plain" tier="l" />
              <p className="mt-1.5 truncate text-[13.5px] text-fg/55" data-ticket-context>{ticket.label}</p>
            </div>
          ) : (
            <>
              <p className="truncate text-[13px] font-semibold text-fg/65">{ticket.label}</p>
              <Amount text={ticket.amount} exact={ticket.exact} tone="plain" tier={amountTier(ticket.amount)} />
              {ticket.context && <p className="mt-1 truncate text-[13.5px] text-fg/55" data-ticket-context>{ticket.context}</p>}
              <div className="mt-auto pt-3">
                <ActionButton a={ticket.action} className={`${CREAM} w-full`} />
              </div>
            </>
          )}
      </TicketShell>
      {need && (
        // What waits on you, as one quiet line under the card (a 44px link): grey words, the action in off-white. No dot, no box.
        <div className="mt-1 px-1" data-need-line data-need-count={need.count}>
          <Link href={need.href} className="flex min-h-11 items-center justify-between gap-3 text-[14px] active:opacity-70" data-need-link>
            <span className="min-w-0 flex-1 truncate font-medium text-fg/55">{need.text}</span>
            <span className="shrink-0 font-semibold text-fg" data-need-action>
              {need.action} <span aria-hidden>›</span>
            </span>
          </Link>
        </div>
      )}
    </>
  );
}

export function TripStrip({ groupId, place, phase, going, start, shareLine, thumb }: { groupId: string; place: string; phase: TripPhase; going: number; start: string; shareLine: string; thumb?: StubCover }) {
  const w = stripWords(place, phase);
  if (!w) return null;
  const thisYear = String(new Date().getFullYear());
  const date = start.startsWith(thisYear) ? niceDate(start).replace(/ \d{4}$/, "") : niceDate(start);
  const who = going > 0 ? (phase.kind === "before" ? `${going} going, ${date}` : `${going} ${going === 1 ? "person" : "people"}`) : phase.kind === "before" ? date : "";
  return (
    <section aria-label="Trip countdown" data-countdown={phase.kind === "before" ? String(phase.days) : phase.kind} data-trip-strip className="mt-3 flex items-center gap-2">
      <Link href={`/groups/${groupId}`} className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 rounded-[18px] border border-line bg-[#16161a] py-2.5 pl-2.5 pr-4 active:bg-mist">
        {/* The trip's own picture, small and rounded (the same one its polaroid shows). */}
        {thumb && (
          <span aria-hidden className="relative block h-11 w-16 shrink-0 overflow-hidden rounded-[10px] bg-mist" data-trip-thumb>
            <CoverBox c={thumb} sizes="64px" />
          </span>
        )}
        <span className="min-w-0 flex-1 leading-tight">
          <b className="block truncate text-[16px] font-semibold">
            {w.pre}
            {w.num !== undefined && <span data-countdown-big>{w.num}</span>}
            {w.post}
          </b>
          {who && <span className="mt-0.5 block truncate text-[13.5px] text-fg/55">{who}</span>}
        </span>
        <span aria-hidden className="text-fg/30">
          ›
        </span>
      </Link>
      {/* Share the countdown (WhatsApp, the trip's crew, other apps). */}
      <ShareCountdown groupId={groupId} line={shareLine} className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[0px]" />
    </section>
  );
}
