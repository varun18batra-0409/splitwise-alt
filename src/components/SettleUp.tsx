"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@/components/Link";
import { trapFocus } from "@/lib/focus-trap";
import { amountSize, BIG_CREAM, BIG_OUTLINE, TONE } from "@/lib/settle-ui";

// The all-groups Settle up cards (founder's design, 15 Nov): a card per person with a ⋮ menu, "View breakdown" that opens in place, one big
// button, and a "Record payment" bottom sheet. This file only draws and opens/closes things; the page that owns the data passes in every
// word, link and the server action (settleAcrossGroups) with its hidden fields. Colour is only for money (orange you owe, green you're owed).

export function Initial({ name, size = 48 }: { name: string; size?: 40 | 48 }) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-[#5a4033] font-display font-semibold text-fg ${size === 48 ? "h-12 w-12 text-[20px]" : "h-10 w-10 text-[17px]"}`}
    >
      {(name.trim().charAt(0) || "?").toUpperCase()}
    </span>
  );
}

export type MenuItem = { key: string; label: string; href?: string; opensSheet?: boolean; attrs?: Record<string, string> };

export type SheetSpec = {
  title: string; // "Record payment"
  subtitle: string; // "Confirm only after you’ve paid Nupur."
  from: string; // "You"
  to: string; // "Nupur"
  other: string; // the other person's name (for the avatar)
  groupLine: string;
  amount: string; // exact, formatted
  tone: "owe" | "owed" | "even";
  even?: boolean; // "Clear both": no payment is made, so no "from → to" line and no amount row
  partHref?: string; // where "Full balance" leads to enter a part amount (only when part payments are supported for this row)
  payWith?: { href: string; label: string; kind: string }; // the person's UPI / pay link, opening the same link as before
  confirmLabel: string;
  note: string;
};

type ServerAction = (formData: FormData) => void | Promise<void>;

function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="text-fg/70">
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </svg>
  );
}

export function SettleCard({
  id,
  name,
  groupLine,
  amount,
  tone,
  main,
  menu,
  breakdown,
  sheet,
  action,
  fields,
  href,
  caption,
  lead,
}: {
  id: string;
  name: string;
  groupLine: string;
  amount: string;
  tone: "owe" | "owed" | "even";
  main: { kind: "sheet"; label: string } | { kind: "node"; node: React.ReactNode };
  menu: MenuItem[];
  breakdown: React.ReactNode;
  sheet: SheetSpec;
  action: ServerAction; // settleAcrossGroups
  fields: React.ReactNode; // its hidden inputs (the parts, and a fresh request key)
  href?: string; // when given, the name and picture open this page (a person you share expenses with directly)
  caption?: string; // one plain line under the amount, e.g. "Rohan owes you"
  // The person page's single card: a headline ("Rohan owes you ₹600") and a note replace the name row and the big amount, and `add`
  // (Add expense) is the main button, with `main` as the second one.
  lead?: { headline: string; note: string; add: React.ReactNode };
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // The ⋮ menu closes on a tap outside it, or Escape (focus goes back to its button).
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: Event) => {
      if (menuBox.current && !menuBox.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuBtn.current?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [menuOpen]);

  // While the sheet is open: focus moves in, Tab stays inside, Escape closes, focus goes back to where it was.
  useEffect(() => {
    if (!sheetOpen) return;
    return trapFocus(box.current, { onEscape: () => setSheetOpen(false), start: heading.current });
  }, [sheetOpen]);

  const owe = tone === "owe";
  return (
    <li id={id} className="scroll-mt-6" data-settle-card={name} data-transfer-row="">
      <div className="rounded-[22px] border border-line bg-white p-4">
        <div className="flex items-start gap-3">
          {lead ? (
            <p className={`min-w-0 flex-1 break-words pt-1 font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] ${TONE[tone]}`} data-balance-line>
              {lead.headline}
            </p>
          ) : href ? (
            <Link href={href} className="flex min-h-11 min-w-0 flex-1 items-start gap-3 active:opacity-80" data-settle-person>
              <Initial name={name} />
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="truncate font-display text-[20px] font-semibold leading-tight tracking-[-0.01em]">{name}</p>
                <p className="mt-0.5 truncate text-[14px] text-fg/60">{groupLine}</p>
              </div>
            </Link>
          ) : (
            <>
              <Initial name={name} />
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="truncate font-display text-[20px] font-semibold leading-tight tracking-[-0.01em]">{name}</p>
                <p className="mt-0.5 truncate text-[14px] text-fg/60">{groupLine}</p>
              </div>
            </>
          )}
          <div ref={menuBox} className="relative -mr-2 -mt-2 shrink-0">
            <button
              ref={menuBtn}
              type="button"
              aria-label={`More for ${name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              data-settle-menu
              className="flex h-11 w-11 items-center justify-center rounded-full text-fg/80 active:bg-mist"
            >
              <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5.5" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="12" cy="18.5" r="1.6" />
              </svg>
            </button>
            {menuOpen && (
              <ul role="menu" className="absolute right-0 top-11 z-30 w-60 max-w-[calc(100vw-3rem)] overflow-hidden rounded-2xl border border-line bg-mist py-1 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]" data-settle-menu-list>
                {menu.map((m) => (
                  <li key={m.key} role="none">
                    {m.opensSheet ? (
                      <button
                        type="button"
                        role="menuitem"
                        {...m.attrs}
                        onClick={() => {
                          setMenuOpen(false);
                          setSheetOpen(true);
                        }}
                        className="flex min-h-11 w-full items-center px-4 text-left text-[15px] text-fg active:bg-fg/10"
                      >
                        {m.label}
                      </button>
                    ) : (
                      <Link href={m.href ?? "#"} role="menuitem" {...m.attrs} className="flex min-h-11 items-center px-4 text-[15px] text-fg active:bg-fg/10">
                        {m.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {lead ? (
          <p className="mt-1 text-[14px] leading-snug text-fg/60">{lead.note}</p>
        ) : (
          <p className={`money mt-3 whitespace-nowrap font-display font-semibold leading-none tracking-[-0.02em] lining-nums tabular-nums ${amountSize(amount)} ${TONE[tone]}`} data-settle-amount>
            {amount}
          </p>
        )}
        {caption && <p className="mt-1.5 text-[14.5px] leading-snug text-fg/70" data-settle-caption>{caption}</p>}

        <details className="group mt-3" data-breakdown>
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-[14.5px] text-fg underline underline-offset-4 [&::-webkit-details-marker]:hidden" data-breakdown-toggle>
            View breakdown
            <Chevron className="transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          {breakdown}
        </details>

        <div className={lead ? "mt-2 space-y-2.5" : "mt-2"}>
          {lead?.add}
          {main.kind === "sheet" ? (
            <button type="button" onClick={() => setSheetOpen(true)} className={lead ? BIG_OUTLINE : BIG_CREAM} data-record-open>
              {main.label}
            </button>
          ) : (
            main.node
          )}
        </div>
      </div>

      {sheetOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={() => setSheetOpen(false)} data-record-sheet>
          <section
            ref={box}
            role="dialog"
            aria-modal="true"
            aria-label={sheet.title}
            onClick={(e) => e.stopPropagation()}
            className="sheet-enter max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] border border-b-0 border-line bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
          >
            <span aria-hidden className="mx-auto block h-1 w-10 rounded-full bg-fg/25" data-sheet-handle />
            <div className="flex items-start gap-3 pt-2">
              <div className="min-w-0 flex-1">
                <h2 ref={heading} tabIndex={-1} className="font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] outline-none">
                  {sheet.title}
                </h2>
                <p className="mt-1 text-[15px] leading-snug text-fg/70">{sheet.subtitle}</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setSheetOpen(false)} className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg/80 active:bg-mist" data-sheet-close>
                <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <Initial name={sheet.other} />
              <div className="min-w-0">
                <p className="truncate font-display text-[20px] font-semibold leading-tight" aria-label={sheet.even ? `You and ${sheet.other}` : `${sheet.from} to ${sheet.to}`} data-record-route>
                  {sheet.even ? `You and ${sheet.other}` : `${sheet.from} → ${sheet.to}`}
                </p>
                <p className="mt-0.5 truncate text-[14px] text-fg/60">{sheet.groupLine}</p>
              </div>
            </div>

            <p className={`money mt-3 whitespace-nowrap font-display font-semibold leading-none tracking-[-0.02em] lining-nums tabular-nums ${amountSize(sheet.amount)} ${TONE[sheet.tone]}`} data-record-amount>
              {sheet.amount}
            </p>

            <dl className="mt-4 border-t border-line text-[15px]">
              {!sheet.even && (
              <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line">
                <dt className="text-fg">Amount</dt>
                <dd className="text-fg">
                  {sheet.partHref ? (
                    <Link href={sheet.partHref} aria-label="Full balance. Tap to pay a different amount." className="-mr-2 inline-flex min-h-11 items-center gap-1 px-2 active:opacity-70" data-record-part>
                      Full balance
                      <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-fg/60">
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </Link>
                  ) : (
                    "Full balance"
                  )}
                </dd>
              </div>
              )}
              <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line">
                <dt className="text-fg">Date</dt>
                <dd className="flex items-center gap-2 text-fg">
                  <CalendarIcon />
                  Today
                </dd>
              </div>
            </dl>

            <p className="mt-4 text-[14px] leading-snug text-fg/65">{sheet.note}</p>

            <div className="mt-5 space-y-3">
              {sheet.payWith && (
                <a href={sheet.payWith.href} {...(sheet.payWith.kind === "upi" ? {} : { target: "_blank", rel: "noopener noreferrer" })} className={BIG_OUTLINE} data-pay={sheet.payWith.kind} data-record-pay>
                  Pay with {sheet.payWith.label}
                </a>
              )}
              <form action={action}>
                {fields}
                <button type="submit" data-haptic="success" data-record-confirm data-cross-record className={BIG_CREAM}>
                  {sheet.confirmLabel}
                </button>
              </form>
              <button type="button" onClick={() => setSheetOpen(false)} className="mx-auto flex min-h-11 items-center px-4 text-[16px] font-medium text-fg active:opacity-70" data-record-cancel>
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
    </li>
  );
}
