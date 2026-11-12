import Link from "@/components/Link";
import { niceDate } from "@/lib/format";
import { TakeOff } from "@/components/TripCountdown";
import { ShareCountdown } from "@/components/ShareCountdown";
import { ExactAmount } from "@/components/ExactAmount";
import { avatarTone } from "@/components/ui";
import { moneyButtons, stripWords, type MoneyMode, type PeopleLine } from "@/lib/home/money-card";
import type { TripPhase } from "@/lib/countdown";

// Home's money card (slim, so the money and both buttons fit the first screen of a small phone) and, lower down, the countdown
// line for a trip that is coming up.

const bright = "pop flex h-11 items-center justify-center gap-2 bg-fg text-[14px] font-semibold text-canvas [--pop-edge:#6e6b63]";
const quiet = "flex h-11 items-center justify-center gap-2 rounded-full border border-fg/20 bg-fg/[0.04] text-[14px] font-semibold text-fg transition-transform active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

// The slim money card: what it means on the left, the amount on the right, two equal buttons underneath.
export function MoneyCard({
  label,
  amount,
  amountClass,
  tone,
  mode,
  exact,
  who,
  whoHref = "/settle",
}: {
  exact?: string; // the exact amount, when `amount` is rounded for display (tooltip)
  who?: PeopleLine | null; // initial circles and "Nupur, Ravi and 2 others": who the money is with, largest first (no amounts)
  whoHref?: string; // where the line goes: Settle up, scrolled to the matching side
  label: string; // "Coming back to you", "You owe", "Nobody owes anybody"
  amount: string; // "₹3,450" or "All square"
  amountClass: string;
  tone: "owed" | "owe" | "plain";
  mode: MoneyMode;
}) {
  const [add, second] = moneyButtons(mode);
  const btn = (b: typeof add, key: string) => (
    <Link key={key} href={b.href} className={b.bright ? bright : quiet} data-money-action={key} data-emphasis={b.bright ? "bright" : "quiet"}>
      {b.label === "Add expense" && (
        <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      )}
      {b.label}
    </Link>
  );
  return (
    <section
      aria-label="Your money"
      className={`rounded-[22px] border bg-[#16161a] px-4 py-3.5 text-fg ${tone === "owe" ? "border-owe/25" : "border-fg/10"}`}
      data-balance-card
      data-money-mode={mode}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="min-w-0 max-w-full truncate text-[13px] text-fg/65">{label}</p>
        <p
          className={`ml-auto text-right font-display font-semibold leading-[1.1] tracking-tight tabular-nums [overflow-wrap:normal] ${amountClass} ${tone === "owed" ? "text-owed" : tone === "owe" ? "text-owe" : ""}`}
          data-net-balance
          title={exact}
        >
          {exact ? <ExactAmount amount={amount} exact={exact} /> : amount}
        </p>
      </div>
      {who && who.names.length > 0 && (
        // One quiet line, one tap target (44px tall) to Settle up, where each person's amount is.
        <Link href={whoHref} aria-label={`${who.text}. Open Settle up`} className="flex min-h-11 items-center gap-2 text-fg/65 active:text-fg" data-money-people>
          <span aria-hidden className="flex shrink-0">
            {who.names.map((n, i) => (
              <span key={`${n}-${i}`} className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ring-2 ring-[#16161a] ${i > 0 ? "-ml-2" : ""} ${avatarTone(n)}`}>
                {n.trim().charAt(0).toUpperCase()}
              </span>
            ))}
          </span>
          <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[13px]">{who.text}</span>
        </Link>
      )}
      <div className={`${who && who.names.length > 0 ? "mt-0.5" : "mt-3"} grid grid-cols-2 gap-2`}>
        {btn(add, "add")}
        {btn(second, second.label === "Settle up" ? "settle" : "new-group")}
      </div>
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
