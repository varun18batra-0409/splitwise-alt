import Image from "next/image";
import Link from "@/components/Link";
import { niceDate } from "@/lib/format";
import { ShareCountdown } from "@/components/ShareCountdown";
import { ExactAmount } from "@/components/ExactAmount";
import { GroupCover } from "@/components/GroupCover";
import { PassStack } from "@/components/PassStack";
import { amountTier, orderPasses, passFields, routeCode, sideFacts, stripWords, type GroupFacts, type GroupMark, type Ticket, type TicketAction, type TicketLine } from "@/lib/home/money-card";
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

// The mark on every boarding-pass route line: ONE drawn plane taking off (side view, nose up about 30 degrees, a ground line under it),
// whatever the group type, so every ticket in the app reads the same. Line style like the other icons; never an emoji.
// `mark` is kept so callers don't change; it is always "plane" (see groupMark).
export function Mark({ mark: _mark }: { mark?: GroupMark }) {
  return (
    <svg aria-hidden width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg/75" data-mark="plane" data-takeoff>
      <path d="M3 21h18" />
      <g transform="translate(12 11) rotate(60) scale(0.8) translate(-12 -12)">
        <path d="M21 15.5v-1.7l-7.6-4.7V3.8c0-.8-.6-1.5-1.4-1.5s-1.4.7-1.4 1.5v5.3L3 13.8v1.7l7.6-2.2v4.9l-2 1.5v1.4l3.4-.9 3.4.9v-1.4l-2-1.5v-4.9Z" />
      </g>
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
export type BothLineData = Omit<TicketLine, "action" | "fromCode" | "toCode" | "groupIds" | "groupNames" | "weight"> & { action?: TicketAction };
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

// A thin barcode along the stub's bottom edge: decorative only (bars of different widths, ~20% off-white).
const BARS = [2, 1, 3, 1, 1, 2, 3, 1, 2, 1, 1, 3, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 3, 1, 1, 2, 1];
function Barcode() {
  let x = 0;
  const rects = BARS.map((w, i) => {
    const r = <rect key={i} x={x} y={0} width={w} height={14} />;
    x += w + 1.5;
    return r;
  });
  return (
    <span aria-hidden data-barcode className="pointer-events-none absolute inset-x-0 bottom-0 flex h-7 items-center justify-center bg-[#16161a]/80 px-2.5">
      <svg viewBox={`0 0 ${x} 14`} preserveAspectRatio="none" className="h-3.5 w-full fill-fg/20">
        {rects}
      </svg>
    </span>
  );
}

// The ticket itself, shared by Home and a group's page: a stub with the group's picture(s), a dashed perforation with a half-circle
// notch at the top and the bottom, then `children`. `attrs` are the data-* hooks the page's tests read. `barcode`: the thin barcode strip.
export function TicketShell({ stub, label, attrs, barcode = false, children }: { stub: StubCover[]; label: string; attrs: Record<string, string | undefined>; barcode?: boolean; children: React.ReactNode }) {
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
        {barcode && <Barcode />}
      </div>
      {/* The perforation (a dashed line, ~25% off-white) with the two 16px half-circle notches of a ticket. */}
      <span aria-hidden className="my-3.5 w-0 shrink-0 border-l-2 border-dashed border-fg/25" data-perforation />
      <span aria-hidden data-notch className="absolute -top-2 left-[77px] h-4 w-4 rounded-full bg-canvas shadow-[inset_0_0_0_1px_#26262c] min-[360px]:left-[93px]" />
      <span aria-hidden data-notch className="absolute -bottom-2 left-[77px] h-4 w-4 rounded-full bg-canvas shadow-[inset_0_0_0_1px_#26262c] min-[360px]:left-[93px]" />
      <div className="relative flex min-w-0 flex-1 flex-col px-3.5 pb-3.5 pt-4 min-[360px]:pl-[18px] min-[360px]:pr-4">{children}</div>
    </section>
  );
}

// The route as printed on a boarding pass: small "From" and "To" labels (sentence case), under them the big codes with the plane
// taking off between. Codes never truncate; the line between them gives way instead.
function PassRoute({ from, to }: { from: string; to: string }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-x-2" data-route data-pass-route>
      <span className="text-[11px] leading-none text-fg/50">From</span>
      <span aria-hidden />
      <span className="text-right text-[11px] leading-none text-fg/50">To</span>
      <span className="mt-1 shrink-0 whitespace-nowrap font-display text-[22px] font-semibold leading-none tracking-[0.04em] min-[360px]:text-[24px]" data-route-end data-route-from>
        {from}
      </span>
      <span aria-hidden className="flex min-w-0 items-center gap-1.5 self-center pb-0.5">
        <i className="h-px min-w-1 flex-1 [background:repeating-linear-gradient(90deg,rgb(244_242_236/0.3)_0_4px,transparent_4px_8px)]" />
        <Mark />
        <i className="h-px min-w-1 flex-1 [background:repeating-linear-gradient(90deg,rgb(244_242_236/0.3)_0_4px,transparent_4px_8px)]" />
      </span>
      <span className="mt-1 shrink-0 whitespace-nowrap font-display text-[22px] font-semibold leading-none tracking-[0.04em] min-[360px]:text-[24px]" data-route-end data-route-to>
        {to}
      </span>
    </div>
  );
}

// Small labelled fields, like GATE and SEAT: the label above, the value below. Values cut with "..." when long; the group's name gets the room.
function PassFields({ fields }: { fields: ReturnType<typeof passFields> }) {
  if (fields.length === 0) return null;
  return (
    <dl className="mt-3 flex min-w-0 gap-x-4" data-pass-fields>
      {fields.map((f) => (
        <div key={f.key} className={f.key === "group" ? "min-w-0 flex-1" : "shrink-0"} data-pass-field={f.key}>
          <dt className="text-[11px] leading-none text-fg/50">{f.label}</dt>
          <dd className="mt-1 truncate text-[13.5px] font-medium leading-tight text-fg/85">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type PassFacts = Record<string, GroupFacts | undefined>;

// One pass for one side: route, exact amount, the faces when several people, up to three fields and ONE button.
function PassBody({ line, facts, year, bright }: { line: TicketLine; facts: PassFacts; year: string; bright: boolean }) {
  const f = sideFacts(line.groupIds, facts);
  return (
    <>
      <PassRoute from={line.fromCode} to={line.toCode} />
      <Amount text={line.amount} exact={line.exact} tone={line.side} tier={amountTier(line.amount)} />
      {line.faces.length > 0 && <Faces line={line} />}
      <PassFields fields={passFields({ groupNames: line.groupNames, since: f.since, items: f.items, thisYear: year })} />
      <div className="mt-auto pt-3">
        <ActionButton a={line.action} className={`${bright ? CREAM : OUTLINE} w-full`} />
      </div>
    </>
  );
}

export function MoneyCard({ ticket, mode, tone, stub, sideStubs, facts = {}, need, year = String(new Date().getFullYear()) }: { ticket: Ticket; mode: string; tone: "owed" | "owe" | "plain"; stub: StubCover[]; sideStubs?: Record<"owe" | "owed", StubCover[]>; facts?: PassFacts; need?: NeedLine | null; year?: string }) {
  const attrs = { "data-balance-card": "", "data-money-mode": mode, "data-tone": tone === "plain" ? "square" : tone, "data-ticket": ticket.kind };
  return (
    <>
      {ticket.kind === "both" ? (
        // Money both ways: two passes in a swipeable stack, the larger first. Only the first pass has the cream button.
        <PassStack label="Your money, two passes" attrs={attrs}>
          {orderPasses(ticket.lines).map((l, i) => (
            <TicketShell key={l.side} stub={sideStubs?.[l.side]?.length ? sideStubs[l.side] : stub} label={l.side === "owe" ? "What you owe" : "What you are owed"} attrs={{ "data-ticket-line": l.side }} barcode>
              <PassBody line={l} facts={facts} year={year} bright={i === 0} />
            </TicketShell>
          ))}
        </PassStack>
      ) : (
        <TicketShell stub={stub} label="Your money" attrs={attrs} barcode>
          {ticket.kind === "one" ? (
            <PassBody line={ticket.line} facts={facts} year={year} bright />
          ) : ticket.kind === "square" ? (
            // Nothing to do: the same pass with a "SETTLED" stamp across it (stamp artwork, not green) and one quiet link.
            <div className="relative flex flex-1 flex-col">
              <p className="text-[11px] leading-none text-fg/50">Your money</p>
              <Amount text={ticket.amount} tone="plain" tier="l" />
              <p className="mt-1.5 truncate text-[13.5px] text-fg/55" data-ticket-context>{ticket.label}</p>
              <span aria-hidden data-settled-stamp className="pointer-events-none absolute right-0 top-[38%] -rotate-[14deg] rounded-md border-2 border-double border-fg/35 px-2 py-0.5 font-display text-[17px] font-semibold tracking-[0.16em] text-fg/35 min-[360px]:text-[20px]">
                SETTLED
              </span>
              <Link href="/add" className="mt-auto flex min-h-11 items-center self-start pt-2 text-[14px] font-medium text-fg/75 underline underline-offset-4 active:opacity-70" data-square-add>
                Add an expense
              </Link>
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
      )}
      {need && (
        // What waits on you, as one line under the pass (a 44px link): full contrast, up to two lines, a small off-white marker dot.
        <div className="mt-1 px-1" data-need-line data-need-count={need.count}>
          <Link href={need.href} className="flex min-h-11 items-center gap-2.5 py-1 text-[14px] leading-snug active:opacity-70" data-need-link>
            <span aria-hidden data-need-dot className="h-1.5 w-1.5 shrink-0 rounded-full bg-fg" />
            <span className="line-clamp-2 min-w-0 flex-1 font-medium text-fg">{need.text}</span>
            <span className="shrink-0 font-semibold text-fg" data-need-action>
              {need.action}
            </span>
          </Link>
        </div>
      )}
    </>
  );
}

export function TripStrip({ groupId, place, phase, going, start, shareLine, thumb, weather, also }: { groupId: string; place: string; phase: TripPhase; going: number; start: string; shareLine: string; thumb?: StubCover; weather?: string; also?: string }) {
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
          {weather && <span className="mt-0.5 block line-clamp-2 text-[13px] leading-snug text-fg/55" data-trip-weather>{weather}</span>}
          {also && <span className="mt-0.5 block truncate text-[13px] text-fg/55" data-trip-also>{also}</span>}
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
