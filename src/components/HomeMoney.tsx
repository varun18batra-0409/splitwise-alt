import Link from "@/components/Link";
import { niceDate } from "@/lib/format";
import { TakeOff } from "@/components/TripCountdown";
import { ShareCountdown } from "@/components/ShareCountdown";
import { moneyButtons, stripWords, type MoneyMode } from "@/lib/home/money-card";
import type { TripPhase } from "@/lib/countdown";

// The top of Home, as two small pieces: the money card (big net amount, two equal buttons) and, when a trip is coming up
// or on, one compact countdown line under it. Both are short so the money and both buttons fit the first screen of a small phone.

const bright = "pop flex h-12 flex-1 items-center justify-center gap-2 bg-fg text-[15px] font-semibold text-canvas [--pop-edge:#6e6b63]";
const quiet = "flex h-12 flex-1 items-center justify-center gap-2 rounded-full border border-fg/18 bg-fg/[0.07] text-[15px] font-semibold text-fg transition-transform active:scale-[0.97]";

export function MoneyCard({
  lead,
  amount,
  amountClass,
  tone,
  sub,
  mode,
}: {
  lead: string; // "Good evening, Varun. You owe"
  amount: string; // "₹3,450" or "All square"
  amountClass: string;
  tone: "owed" | "owe" | "plain";
  sub: string; // "across 2 groups, to 2 people"
  mode: MoneyMode;
}) {
  const [add, second] = moneyButtons(mode);
  const btn = (b: typeof add, key: string) => (
    <Link key={key} href={b.href} className={b.bright ? bright : quiet} data-money-action={key} data-emphasis={b.bright ? "bright" : "quiet"}>
      {b.label === "Add expense" && (
        <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      )}
      {b.label}
    </Link>
  );
  return (
    <section aria-label="Your money" className="vault rounded-[26px] px-[18px] pb-4 pt-[18px] text-fg" data-balance-card data-money-mode={mode}>
      <p className="text-sm text-fg/70">{lead}</p>
      <p className={`money mt-1 whitespace-nowrap font-display font-semibold leading-[1.1] tracking-tight ${amountClass} ${tone === "owed" ? "text-owed" : tone === "owe" ? "text-owe" : ""}`} data-net-balance>
        {amount}
      </p>
      <p className="mt-0.5 text-[13px] text-fg/55">{sub}</p>
      <div className="mt-4 flex gap-2.5">
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
