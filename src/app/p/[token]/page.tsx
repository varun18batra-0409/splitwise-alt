import type { Metadata } from "next";
import QRCode from "qrcode";
import Link from "@/components/Link";
import { CopyButton } from "@/components/CollectBits";
import { ErrorNote, secondaryButtonClass } from "@/components/ui";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { payButtons } from "@/lib/pay-links";
import { readPayLink, type PayLinkState } from "@/lib/pay-link";
import { iPaidAction, undoIPaidAction } from "@/app/pay-link-actions";
import { PAYMENT_LINE } from "@/lib/money";
import { ChevronDown } from "@/components/icons";

// The "I've paid" page: the link inside a Remind message. Whoever owes opens
// it (no sign-in), pays in their UPI app, and taps "I've paid". It counts straight
// away and the person who's owed is told. Only this one debt, only what's owed now.

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string; undone?: string; error?: string }> };

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = await readPayLink((await params).token);
  const robots = { index: false, follow: false };
  if (s.kind === "gone") return { title: "Loopin", robots };
  const amount = formatMoney(s.amount, s.currency);
  const title = s.kind === "owes" ? `${first(s.toName)} is asking for ${amount}` : `${s.group.name} · Loopin`;
  return { title, description: `For “${s.group.name}”. Pay, then tap I’ve paid. No sign-in needed.`, robots, openGraph: { title, description: `For “${s.group.name}”. Pay, then tap I’ve paid.` } };
}

function Mark({ tone }: { tone: "ok" | "rest" }) {
  const ring = tone === "ok" ? "text-owed" : "text-fg/60";
  return (
    <span aria-hidden className={`lp-pop-in relative mx-auto flex h-16 w-16 items-center justify-center rounded-full ${ring}`}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="32" cy="32" r="30" strokeOpacity="0.35" />
        <circle cx="32" cy="32" r="30" strokeDasharray="188.5" className="lp-draw-ring" />
      </svg>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" className="lp-draw-tick" />
      </svg>
    </span>
  );
}

export default async function PayLinkPage({ params, searchParams }: Props) {
  const { token } = await params;
  const sp = await searchParams;
  const s = await readPayLink(token);

  const header = (
    <header className="mb-6 flex items-center justify-between">
      <Link href="/" className="font-display text-xl font-semibold tracking-tight">
        loopin
      </Link>
      <span className="text-xs text-fg/55">No sign-in needed</span>
    </header>
  );

  if (s.kind === "gone") {
    return (
      <>
        {header}
        <section className="vault rounded-[20px] px-6 py-10 text-center" data-paylink="gone">
          <Mark tone="rest" />
          <h1 className="mt-5 font-display text-[clamp(22px,7vw,26px)] font-semibold leading-tight tracking-tight">This link has closed</h1>
          <p className="mx-auto mt-2 max-w-[19rem] text-sm text-fg/60">Payment links last 30 days and stop once you’re square. If you still owe something, ask for a fresh reminder.</p>
          <Link href="/" className="pop mt-7 inline-block bg-fg px-6 py-3 text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
            Open Loopin
          </Link>
        </section>
      </>
    );
  }

  const money = formatMoney(s.amount, s.currency);
  const to = first(s.toName);
  const from = first(s.fromName);

  return (
    <>
      {header}
      {sp.error && <ErrorNote>{sp.error}</ErrorNote>}
      {s.kind === "owes" ? <Owes s={s} money={money} to={to} from={from} token={token} undone={Boolean(sp.undone)} /> : <Done s={s} money={money} to={to} from={from} token={token} justPaid={Boolean(sp.paid)} />}
      <p className="mt-10 text-center text-xs leading-relaxed text-fg/55">
        {PAYMENT_LINE}
        <br />
        <Link href="/" className="font-medium text-fg/75 underline underline-offset-2">
          Split trips, flats and game nights with Loopin
        </Link>
      </p>
    </>
  );
}

type Shown = Exclude<PayLinkState, { kind: "gone" }>;

async function Owes({ s, money, to, from, token, undone }: { s: Shown; money: string; to: string; from: string; token: string; undone: boolean }) {
  const acc = s.toAccountId ? await db.account.findUnique({ where: { id: s.toAccountId }, select: { upiId: true, payLink: true } }) : null;
  const buttons = acc ? payButtons({ upiId: acc.upiId, payLink: acc.payLink }, { amount: s.amount, currency: s.group.currency, toName: s.toName, note: s.group.name }) : [];
  const upi = buttons.find((b) => b.kind === "upi");
  const other = buttons.find((b) => b.kind !== "upi");
  const qr = upi ? await QRCode.toString(upi.href, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0d0d0f", light: "#f4f2ec" } }) : "";
  const step = (n: number, text: string) => (
    <h2 className="mb-3 flex items-center gap-3 font-display text-lg font-semibold tracking-tight">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-mist font-sans text-[13px] font-semibold text-fg">{n}</span> {text}
    </h2>
  );
  return (
    <>
      <section aria-label="What you owe" className="vault lp-rise rounded-[20px] px-5 pb-5 pt-5" data-paylink="owes">
        <p className="font-hand text-[22px] font-bold leading-none text-fg/75">{to} is asking</p>
        <p className="mt-3 break-words font-display text-[clamp(34px,10vw,40px)] font-semibold leading-none tracking-[-0.02em] text-owe lining-nums tabular-nums" data-paylink-amount>
          {money}
        </p>
        <p className="mt-3 text-sm text-fg/60">
          for <span className="font-medium text-fg/85">{s.group.name}</span> · hi {from}
        </p>
      </section>

      {undone && <p className="mt-4 rounded-2xl border border-[#26262c] bg-[#16161a] px-4 py-3 text-sm text-fg/70">Done, it’s taken back. Tap I’ve paid again once you’ve paid.</p>}

      <section className="mt-7" aria-label={`Pay ${to}`}>
        {/* The amount is said once (the header above) and the payee at most twice: no names or sums in these steps. */}
        {step(1, "Pay")}
        {upi ? (
          <div className="space-y-3">
            <a href={upi.href} className="pop block w-full bg-fg px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63]" data-pay="upi">
              Pay with UPI
            </a>
            <div className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] text-gray-400">UPI ID</span>
                <span className="block truncate font-mono text-sm">{acc?.upiId}</span>
              </span>
              <CopyButton text={acc?.upiId ?? ""} label="Copy" />
            </div>
            <details className="rounded-2xl border border-line px-4 py-3">
              <summary className="cursor-pointer text-sm text-gray-500">On a laptop? Scan this with your phone <ChevronDown size={14} className="chev ml-1.5 inline-block align-[-2px] text-fg/55" /></summary>
              <div className="mx-auto mt-3 w-48 overflow-hidden rounded-xl" dangerouslySetInnerHTML={{ __html: qr }} />
            </details>
          </div>
        ) : other ? (
          <a href={other.href} target="_blank" rel="noopener noreferrer" className="pop block w-full bg-fg px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63]" data-pay={other.kind}>
            Pay with {other.label}
          </a>
        ) : (
          <p className="rounded-2xl border border-line px-4 py-3 text-sm text-gray-500">Pay {to} the way you usually do: UPI, cash or a bank transfer.</p>
        )}
      </section>

      <section className="mt-7" aria-label="Tell them you paid">
        {step(2, "Then tell them")}
        <form action={iPaidAction}>
          <input type="hidden" name="token" value={token} />
          {/* The one cream button: "Open payment app" when there is one, otherwise this. */}
          <button type="submit" className={upi || other ? secondaryButtonClass : "pop block w-full bg-fg px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63]"} data-i-paid data-haptic="success">
            I’ve paid
          </button>
        </form>
        <p className="mt-3 text-center text-xs text-fg/55">
          Only if you’re {from}. It counts straight away, and {to} is told.
        </p>
      </section>
    </>
  );
}

function Done({ s, money, to, from, token, justPaid }: { s: Shown; money: string; to: string; from: string; token: string; justPaid: boolean }) {
  const when = s.paidAt ? s.paidAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) : "";
  const view =
    s.kind === "paid"
      ? justPaid
        ? { tone: "ok" as const, title: `Paid. ${to}’s been told`, text: `${money} for ${s.group.name}, recorded${when ? ` on ${when}` : ""}.` }
        : { tone: "ok" as const, title: `All square with ${to}!`, text: `${money} for ${s.group.name}, recorded. Nice one, ${from}.` }
      : s.kind === "closed"
      ? { tone: "rest" as const, title: "This group is closed", text: `${s.group.name} is closed, so there’s nothing to do here. Thanks, ${from}!` }
      : { tone: "ok" as const, title: `Nothing to pay ${to} right now`, text: `You’re square with ${to} in ${s.group.name}.` };
  return (
    <section className="vault lp-rise rounded-[20px] px-6 py-9 text-center" data-paylink={s.kind}>
      <Mark tone={view.tone} />
      <h1 className="mt-5 font-display text-[26px] font-semibold leading-tight tracking-tight">{view.title}</h1>
      <p className="mx-auto mt-2 max-w-[20rem] text-sm text-fg/60">{view.text}</p>
      {s.kind === "paid" && (
        <form action={undoIPaidAction} className="mt-6">
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="inline-flex min-h-11 items-center text-sm font-medium text-fg/70 underline underline-offset-4">
            Tapped by mistake? Take it back
          </button>
        </form>
      )}
    </section>
  );
}
