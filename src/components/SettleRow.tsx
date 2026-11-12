import Link from "@/components/Link";
import { Avatar } from "@/components/ui";
import { differentAmountHref } from "@/lib/money";
import type { PayButton } from "@/lib/pay-links";

// ONE layout for a payment to make, used by a group's Settle up, the all-groups Settle up
// and a card night's "Money owed":
//   who pays whom + the amount
//   one FILLED main button  ("Open payment app" or "Remind"; other saved ways are quiet "or pay with PayPal" links),
//   one OUTLINED button      ("I've paid" / "Mark paid"),
//   a quiet text link        ("Paid a different amount?").
// If a row has no main button, its one action button becomes the filled one.

export const mainButtonClass = "pop inline-flex min-h-11 flex-1 basis-40 items-center justify-center gap-1.5 bg-fg px-4 text-sm font-semibold text-canvas";
// The action button sits inside a form (or a details): the form takes the width, the button fills it.
export const actionFormClass = "flex flex-1 basis-40";
export const outlineButtonClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-full border border-fg/25 bg-transparent px-4 text-sm font-semibold text-fg active:scale-[0.97]";
export const filledActionClass = "pop inline-flex min-h-11 w-full items-center justify-center bg-fg px-4 text-sm font-semibold text-canvas";

export function RemindIcon() {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 3 10 14M21 3l-7 18-4-7-7-4Z" />
    </svg>
  );
}

// ONE main "Open payment app" button: the first way the person likes to be paid (UPI first, and it only exists for
// rupees; outside India the saved link is the main one). Any other saved way is a small quiet link under the buttons,
// "or pay with PayPal", so a row never has two filled buttons.
export function PayAppButtons({ buttons }: { buttons: PayButton[] }) {
  const [first, ...rest] = buttons;
  if (!first) return null;
  const external = (b: PayButton) => (b.kind === "upi" ? {} : { target: "_blank", rel: "noopener noreferrer" });
  return (
    <>
      <a key={first.kind} href={first.href} {...external(first)} className={mainButtonClass} data-pay={first.kind}>
        Open payment app{first.kind === "upi" ? "" : ` (${first.label})`}
      </a>
      {rest.map((b) => (
        <a
          key={b.kind}
          href={b.href}
          {...external(b)}
          className="order-last inline-flex min-h-11 basis-full items-center text-sm font-medium text-fg/70 underline underline-offset-4"
          data-pay-alt={b.kind}
        >
          or pay with {b.label}
        </a>
      ))}
    </>
  );
}

// "Paid a different amount?" always goes to the Record a payment page, which asks if it's more than what's owed.
export function DifferentAmountLink({ href, label = "Paid a different amount?" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-fg/70 underline underline-offset-4" data-different-amount>
      {label}
    </Link>
  );
}

export function differentAmountFor(groupId: string, fromId: string, toId: string, amountInput: string, backToSettle = true): string {
  return backToSettle ? differentAmountHref(groupId, fromId, toId, amountInput) : `/groups/${groupId}/pay?${new URLSearchParams({ from: fromId, to: toId, amount: amountInput })}`;
}

export function SettleRow({
  avatarName,
  title,
  amount,
  tone,
  sub,
  main,
  hint,
  action,
  status,
  link,
  tint = "plain",
  dataRow,
  data,
}: {
  avatarName: string;
  title: string;
  amount: string; // already formatted
  tone: "owe" | "owed" | "neutral";
  sub?: React.ReactNode; // small grey text under the amount (e.g. each group's part)
  main?: React.ReactNode; // the one FILLED button(s): PayAppButtons or a Remind link
  hint?: string; // one short line under the buttons
  action?: React.ReactNode; // the one OUTLINED button (a form or a details), built with outlineButtonClass
  status?: React.ReactNode; // "Waiting for Asha to confirm", "Asha hasn't received it yet"...
  link?: React.ReactNode; // DifferentAmountLink
  tint?: "owe" | "plain" | "mine";
  dataRow?: string;
  data?: Record<string, string>; // e.g. { "data-transfer": "paid" }
}) {
  const border = tint === "owe" ? "border-owe/25 bg-[linear-gradient(180deg,rgba(255,171,107,0.07),rgba(255,171,107,0.02))]" : tint === "mine" ? "border-line bg-white" : "border-line";
  const amountColor = tone === "owed" ? "text-owed" : tone === "owe" ? "text-owe" : "text-fg/80";
  return (
    <li className={`rounded-[22px] border px-4 py-3.5 ${border}`} data-transfer-row={dataRow} {...data}>
      <div className="flex items-center gap-3">
        <Avatar name={avatarName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{title}</p>
          <p className={`money text-[22px] leading-tight ${amountColor}`}>{amount}</p>
        </div>
      </div>
      {sub && <div className="mt-2 pl-12 text-xs text-gray-500">{sub}</div>}
      {status && <div className="mt-3 pl-12">{status}</div>}
      {(main || action) && (
        <div className="mt-3 flex flex-wrap gap-2 pl-12" data-row-buttons>
          {main}
          {action}
        </div>
      )}
      {hint && <p className="mt-2 pl-12 text-xs text-gray-400">{hint}</p>}
      {link && <div className="pl-12">{link}</div>}
    </li>
  );
}
