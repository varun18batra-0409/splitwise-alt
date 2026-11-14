import { neutralGameText } from "@/lib/game-words";
import { getCategory } from "@/lib/categories";
import { ExpenseGlyph } from "./ExpenseGlyph";
import { formatMoney } from "@/lib/money";
import type { ActivityItem } from "@/lib/activity";
import { GearIcon, SettleIcon } from "./icons";
import { paymentEffectLabel, paymentSubline, paymentTitle } from "@/lib/payment-words";

// Right-hand side: what it meant for you. The amount first (bold), what it is
// underneath; rows that weren't yours stay quiet.
function Effect({ label, amount, exact, sub, cls }: { label: string; amount?: string; exact?: string; sub?: string; cls: string }) {
  if (!amount) return <span className="shrink-0 whitespace-nowrap text-right text-[12px] leading-tight text-fg/60">{label}</span>;
  return (
    <span className="shrink-0 whitespace-nowrap text-right leading-tight">
      <span className={`block text-[15px] font-semibold tabular-nums tracking-tight ${cls}`} title={exact} data-exact={exact}>{amount}</span>
      <span className="mt-0.5 block text-[11px] text-fg/60">
        {label}
        {sub && <span className="whitespace-nowrap tabular-nums"> · {sub}</span>}
      </span>
    </span>
  );
}

// Up to two lines, so "Thailand trip, Today" isn't cut to "Thailand trip, T…".
const meta = "mt-0.5 line-clamp-2 break-words text-[13px] leading-snug text-fg/60";

// One line of history: an expense, a settle-up payment or a group change,
// and what it meant for you. Deleted items stay visible, crossed out.
export function ActivityRow({
  item,
  currency,
  nameOf,
  groupName,
  dateLabel,
  motion,
  delay = 0,
}: {
  item: ActivityItem;
  currency: string;
  nameOf: (id: string) => string; // returns "You" for me
  groupName?: string; // shown on the home screen, where groups are mixed
  dateLabel?: string; // "Today", "Yesterday": shown after the group name (Home)
  motion?: "loop" | "once"; // the icon moves: now and then (Home), or once when seen (a group's list)
  delay?: number; // seconds, so a list's icons take turns
}) {
  const money = (m: number) => formatMoney(m, currency);
  // Rows show the exact amount, paise included (the same figure as the expense and Settle up); never rounded.
  const short = money;
  // Third line: the group and the date. It may be cut; the names and amounts above never are.
  const where = [groupName, dateLabel].filter(Boolean).join(" · ");
  const whereLine = where ? (
    <p className="mt-0.5 truncate text-[13px] leading-snug text-fg/60" data-where-line>
      {where}
    </p>
  ) : null;

  if (item.kind === "event") {
    return (
      <div className="flex items-center gap-3 py-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center text-gray-400">
          <GearIcon size={18} />
        </span>
        <p className="min-w-0 flex-1 text-sm text-gray-500">
          <span className="font-medium text-ink">{nameOf(item.actorId)}</span> {neutralGameText(item.text)}
          {where && <span className="text-gray-400"> · {where}</span>}
        </p>
      </div>
    );
  }

  const deleted = item.deletedById !== null;
  const deletedNote = deleted ? `Deleted by ${item.deletedById ? nameOf(item.deletedById) : "someone"}` : "";

  if (item.kind === "payment") {
    const to = nameOf(item.toId);
    // A plain payment has nothing more to say than the title; its amount is on the right.
    const subRaw = paymentSubline(item.status, to, deleted, deletedNote);
    const sub = subRaw === "Payment" && !(deleted || item.effect === 0) ? "" : subRaw;
    // Wording lives in payment-words.ts: a payment only said (not yet confirmed) never reads "paid you" or "you received".
    return (
      <div className={`flex items-center gap-3.5 py-3.5 ${deleted ? "opacity-[.85]" : ""}`}>
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-mist text-fg/75">
          <SettleIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`line-clamp-2 break-words text-[15px] font-semibold leading-snug tracking-tight ${deleted ? "line-through decoration-gray-400" : ""}`}>
            {paymentTitle(nameOf(item.fromId), to, item.status, deleted)}
          </p>
          {sub && (
            <p className={meta}>
              {sub}
              {/* The amount sits on the right ("you received"); repeat it here only when it isn't yours or the row is deleted. */}
              {(deleted || item.effect === 0) && (
                <>
                  {" · "}
                  <span className="whitespace-nowrap" title={money(item.amount)} data-exact={money(item.amount)}>{short(item.amount)}</span>
                </>
              )}
            </p>
          )}
          {whereLine}
        </div>
        {deleted || item.effect === 0 ? (
          <Effect label={paymentEffectLabel(item.status, item.effect, deleted)} cls="" />
        ) : (
          <Effect label={paymentEffectLabel(item.status, item.effect, deleted)} amount={short(Math.abs(item.effect))} exact={money(Math.abs(item.effect))} cls={item.status === "waiting" ? "text-fg/70" : "text-fg"} />
        )}
      </div>
    );
  }

  // A game's result (Game night): who came out ahead, and how it went for you.
  if (item.pot) {
    return (
      <div className="flex items-center gap-3.5 py-3.5">
        <ExpenseGlyph title={item.title} category="activities" emoji="🃏" motion={motion} delay={delay} label="Game night" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold tracking-tight">{neutralGameText(item.title)}</p>
          <p className={meta}>
            Game result · {(item.payerIds ?? [item.paidById]).map(nameOf).join(" + ")} came out ahead by <span className="whitespace-nowrap" title={money(item.amount)} data-exact={money(item.amount)}>{short(item.amount)}</span>
          </p>
          {whereLine}
        </div>
        {item.effect > 0 ? (
          <Effect label="you were up" amount={short(item.effect)} exact={money(item.effect)} cls="text-owed" />
        ) : item.effect < 0 ? (
          <Effect label="you were down" amount={short(-item.effect)} exact={money(-item.effect)} cls="text-owe" />
        ) : (
          <Effect label="even" cls="" />
        )}
      </div>
    );
  }
  const cat = getCategory(item.category);
  // Foreign-currency expense: show the amount in its own currency first, then the group currency.
  const o = item.original;
  const shown = (orig: number, base: number) => {
    const exact = o ? formatMoney(orig, o.currency) : money(base);
    return (
      <span className="whitespace-nowrap" title={exact} data-exact={exact}>
        {exact}
      </span>
    );
  };
  return (
    <div className={`flex items-center gap-3.5 py-3.5 ${deleted ? "opacity-[.85]" : ""}`}>
      <ExpenseGlyph title={item.title} category={item.category} motion={deleted ? undefined : motion} delay={delay} label={cat.label} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5" title={cat.label}>
          <span className={`truncate text-[15px] font-semibold tracking-tight ${deleted ? "line-through decoration-gray-400" : ""}`}>{item.title}</span>
          {item.refund && <span className="shrink-0 rounded-md bg-owed/[0.14] px-1.5 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-wide text-owed">Back</span>}
          {item.notes && (
            <svg aria-label="Has notes" role="img" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg/60">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8" />
            </svg>
          )}
        </p>
        {deleted ? (
          <>
            <p className={meta}>
              {deletedNote} · {shown(o?.amount ?? 0, item.amount)}
            </p>
            {whereLine}
          </>
        ) : (
          // Line 2: "Kabir paid ₹1,180". The payer's name is never cut: it wraps. Line 3: group and date, which may be cut.
          <>
            <p className="mt-0.5 break-words text-[13px] leading-snug text-fg/60" data-paid-line>
              {(item.payerIds ?? [item.paidById]).map(nameOf).join(" + ")} {item.refund ? "got back" : "paid"} {shown(o?.amount ?? 0, item.amount)}
              {item.edited && " · edited"}
            </p>
            {whereLine}
          </>
        )}
      </div>
      {deleted ? (
        <Effect label="deleted" cls="" />
      ) : item.effect > 0 ? (
        <Effect label="you lent" amount={short(item.effect)} exact={money(item.effect)} sub={o ? formatMoney(o.effect, o.currency) : undefined} cls="text-owed" />
      ) : item.effect < 0 ? (
        <Effect label="you owe" amount={short(-item.effect)} exact={money(-item.effect)} sub={o ? formatMoney(-o.effect, o.currency) : undefined} cls="text-owe" />
      ) : (
        // Zero for you: either it wasn't yours at all, or you paid exactly your own part.
        <Effect
          label={[...(item.payerIds ?? [item.paidById]), ...item.people].some((id) => nameOf(id) === "You") ? "your own" : "not involved"}
          cls=""
        />
      )}
    </div>
  );
}
