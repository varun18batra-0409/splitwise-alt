import Link from "@/components/Link";
import { niceDate } from "@/lib/format";
import { TakeOff } from "@/components/TripCountdown";
import { ShareCountdown } from "@/components/ShareCountdown";
import { ExactAmount } from "@/components/ExactAmount";
import { stripWords, type MoneyAction, type MoneyMode, type WhoLine } from "@/lib/home/money-card";
import type { TripPhase } from "@/lib/countdown";

// Home's money card (compact, so the money and both buttons fit the first screen of a small phone) and, lower down, the countdown
// line for a trip that is coming up.

const bright = "pop flex h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap bg-fg px-2.5 text-[14px] font-semibold text-canvas [--pop-edge:#6e6b63]";
const quiet = "flex h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-fg/25 bg-fg/[0.04] px-2.5 text-[14px] font-semibold text-fg transition-transform active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

// The card takes the colour of your position: warm orange when you owe, green when you're owed (the app's own owe / owed
// colours: about 20% at the top corner fading into the card surface, and a border at about 38%). Square keeps the plain card.
const TINT = {
  owe: "border-owe/[0.38] bg-[linear-gradient(155deg,color-mix(in_srgb,var(--color-owe)_20%,transparent)_0%,color-mix(in_srgb,var(--color-owe)_6%,transparent)_55%,transparent_100%)]",
  owed: "border-owed/[0.38] bg-[linear-gradient(155deg,color-mix(in_srgb,var(--color-owed)_20%,transparent)_0%,color-mix(in_srgb,var(--color-owed)_6%,transparent)_55%,transparent_100%)]",
  plain: "border-fg/10",
} as const;

// What waits on you, folded into the card: the top one as a line, or "2 payments to confirm · See them".
export type NeedLine = { text: React.ReactNode; action: string; href: string; count: number };

export function MoneyCard({
  label,
  amount,
  amountClass,
  tone,
  mode,
  exact,
  who,
  whoHref = "/settle",
  actions,
  need,
}: {
  exact?: string; // the exact amount, when `amount` is rounded for display (tooltip)
  who?: WhoLine | null; // "Nupur ₹1,800 · Ravi ₹650": who the money is with, largest first, with amounts
  whoHref?: string; // where the line goes: Settle up, scrolled to the matching side
  label: string; // "Coming back to you", "You owe", "Nobody owes anybody"
  amount: string; // "₹3,450" or "All square"
  amountClass: string;
  tone: "owed" | "owe" | "plain";
  mode: MoneyMode;
  actions: [MoneyAction, MoneyAction];
  need?: NeedLine | null;
}) {
  const [first, second] = actions;
  const btn = (b: MoneyAction) => (
    <Link
      key={b.key}
      href={b.href}
      aria-label={b.fullLabel !== b.label ? b.fullLabel : undefined}
      className={b.bright ? bright : quiet}
      data-money-action={b.key}
      data-emphasis={b.bright ? "bright" : "quiet"}
    >
      {b.label === "Add expense" && (
        <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" className="shrink-0 max-[389px]:hidden">
          <path d="M12 5v14M5 12h14" />
        </svg>
      )}
      <span className="min-w-0 truncate">{b.label}</span>
    </Link>
  );
  const coloured = tone !== "plain";
  const buttons = (
    <div className={`${coloured ? "mt-2" : who ? "mt-0.5" : "mt-2.5"} grid ${first.key === "pay" || first.key === "remind" ? "grid-cols-[1.3fr_1fr]" : "grid-cols-2"} gap-2`}>
      {btn(first)}
      {btn(second)}
    </div>
  );
  return (
    <section
      aria-label="Your money"
      className={`rounded-[20px] border bg-[#16161a] px-3.5 pb-3 pt-3.5 text-fg ${TINT[tone]}`}
      data-balance-card
      data-money-mode={mode}
      data-tone={tone === "plain" ? "square" : tone}
    >
      {coloured ? (
        <div>
          <p className="truncate text-[13px] leading-4 text-fg/70">{label}</p>
          <p
            className={`font-display font-semibold leading-[1.05] tracking-[-0.02em] tabular-nums [overflow-wrap:normal] ${amountClass} ${tone === "owed" ? "text-owed" : "text-owe"}`}
            data-net-balance
            title={exact}
          >
            {exact ? <ExactAmount amount={amount} exact={exact} /> : amount}
          </p>
          {who && who.parts.length > 0 && (
            // One line, one 44px tap target to Settle up (where each person's row is). Names shorten first; amounts stay whole.
            <Link href={whoHref} aria-label={`${who.label}. Open Settle up`} className="-mb-2 -mt-1.5 flex min-h-11 items-center text-fg/85 active:text-fg" data-money-people>
              <span className="flex min-w-0 max-w-full items-baseline gap-1.5 whitespace-nowrap text-[13px]" data-who-line>
                {who.parts.map((p, i) => (
                  <span key={`${p.name}-${i}`} className="flex min-w-0 shrink items-baseline gap-1.5">
                    {i > 0 && <span aria-hidden className="shrink-0 text-fg/40">·</span>}
                    <span className="flex min-w-0 shrink items-baseline gap-1">
                      <b className="min-w-0 truncate font-semibold">{p.name}</b>
                      <span className="shrink-0" title={p.exact}>{p.amount}</span>
                    </span>
                  </span>
                ))}
                {who.tail && (
                  <>
                    <span aria-hidden className="shrink-0 text-fg/40">·</span>
                    <span className="shrink-0 text-fg/65">{who.tail}</span>
                  </>
                )}
                {who.opposite && (
                  // Money going the other way too: why the net amount is smaller than the names above. Shortens first, like a name.
                  <span className="flex min-w-0 shrink-[2] items-baseline gap-1.5 text-fg/65" data-who-opposite>
                    <span aria-hidden className="shrink-0 text-fg/40">·</span>
                    {/* Only the name shortens: the direction words always stay, so it never reads as a third person you owe. */}
                    {who.opposite.kind === "owes-you" ? (
                      <>
                        <b className="min-w-0 truncate font-semibold text-fg/85">{who.opposite.name}</b>
                        <span className="shrink-0">{who.opposite.phrase.slice(who.opposite.name.length + 1)}</span>
                      </>
                    ) : (
                      <>
                        <span className="shrink-0">you owe</span>
                        <b className="min-w-0 truncate font-semibold text-fg/85">{who.opposite.name}</b>
                      </>
                    )}
                    <span className="shrink-0" title={who.opposite.exact}>{who.opposite.amount}</span>
                  </span>
                )}
              </span>
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="min-w-0 max-w-full truncate text-[13px] text-fg/65">{label}</p>
          <p className={`ml-auto text-right font-display font-semibold leading-[1.1] tracking-tight tabular-nums [overflow-wrap:normal] ${amountClass}`} data-net-balance title={exact}>
            {exact ? <ExactAmount amount={amount} exact={exact} /> : amount}
          </p>
        </div>
      )}
      {buttons}
      {need && (
        // What waits on you, as one line at the bottom of the card (a 44px link), above a hairline.
        <div className="mt-2.5 border-t border-fg/10" data-need-line data-need-count={need.count}>
          <Link href={need.href} className="-mb-2 flex min-h-11 items-center gap-2.5 text-[13px] active:text-fg" data-need-link>
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[#e8c46a]" />
            <span className="min-w-0 flex-1 truncate text-fg/90">{need.text}</span>
            <span className="shrink-0 font-semibold" data-need-action>
              {need.action} <span aria-hidden>›</span>
            </span>
          </Link>
        </div>
      )}
    </section>
  );
}

export function TripStrip({ groupId, place, phase, going, start, shareLine }: { groupId: string; place: string; phase: TripPhase; going: number; start: string; shareLine: string }) {
  const w = stripWords(place, phase);
  if (!w) return null;
  const thisYear = String(new Date().getFullYear());
  const date = start.startsWith(thisYear) ? niceDate(start).replace(/ \d{4}$/, "") : niceDate(start);
  const who = going > 0 ? (phase.kind === "before" ? `${going} going, ${date}` : `${going} ${going === 1 ? "person" : "people"}`) : phase.kind === "before" ? date : "";
  return (
    <section aria-label="Trip countdown" data-countdown={phase.kind === "before" ? String(phase.days) : phase.kind} data-trip-strip className="mt-3 flex items-center gap-2">
      <Link href={`/groups/${groupId}`} className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 rounded-2xl border border-line bg-mist px-4 py-2.5 active:bg-line">
        {phase.kind === "before" ? (
          // The little plane taking off down its runway.
          <span className="flex w-11 shrink-0">
            <TakeOff className="text-fg" />
          </span>
        ) : (
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#d8bd7a]/45 text-[#e8d29a]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 13l18-8-6 15-3-6-6-1Z" />
            </svg>
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[15px]">
          <b className="font-semibold">
            {w.pre}
            {w.num !== undefined && <span data-countdown-big>{w.num}</span>}
            {w.post}
          </b>
          {who && <span className="text-fg/60"> · {who}</span>}
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
