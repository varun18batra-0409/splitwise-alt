import type { Metadata } from "next";
import QRCode from "qrcode";
import Link from "@/components/Link";
import { CopyButton } from "@/components/CollectBits";
import { ErrorNote } from "@/components/ui";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { payButtons } from "@/lib/pay-links";
import { readPayLink, type PayLinkState } from "@/lib/pay-link";
import { iPaidAction, undoIPaidAction } from "@/app/pay-link-actions";

// The "I've paid" page: the link inside a Remind message. Whoever owes opens
// it (no sign-in), pays in their UPI app, and taps "I've paid". The person
// who's owed is asked to confirm. Only this one debt, only what's owed now.

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string; undone?: string; error?: string }> };

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = await readPayLink((await params).token);
  const robots = { index: false, follow: false };
  if (s.kind === "gone") return { title: "Loopin", robots };
  const amount = formatMoney(s.amount, s.group.currency);
  const title = s.kind === "owes" ? `${first(s.toName)} is asking for ${amount}` : `${s.group.name} · Loopin`;
  return { title, description: `For “${s.group.name}”. Pay, then tap I’ve paid. No sign-in needed.`, robots, openGraph: { title, description: `For “${s.group.name}”. Pay, then tap I’ve paid.` } };
}

function Mark({ tone }: { tone: "ok" | "wait" | "rest" }) {
  const ring = tone === "ok" ? "text-owed" : tone === "wait" ? "text-[#d8bd7a]" : "text-fg/40";
  return (
    <span aria-hidden className={`lp-pop-in relative mx-auto flex h-16 w-16 items-center justify-center rounded-full ${ring}`}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="32" cy="32" r="30" strokeOpacity="0.35" />
        <circle cx="32" cy="32" r="30" strokeDasharray="188.5" className="lp-draw-ring" />
      </svg>
      {tone === "wait" ? (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      ) : (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" className="lp-draw-tick" />
        </svg>
      )}
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
      <span className="text-xs text-gray-400">No sign-in needed</span>
    </header>
  );

  if (s.kind === "gone") {
    return (
      <>
        {header}
        <section className="vault rounded-[24px] px-6 py-10 text-center" data-paylink="gone">
          <Mark tone="rest" />
          <h1 className="mt-5 font-display text-[26px] font-semibold leading-tight tracking-tight">This link has done its job</h1>
          <p className="mx-auto mt-2 max-w-[19rem] text-sm text-fg/60">Payment links last 30 days and stop once you’re square. If you still owe something, ask for a fresh reminder.</p>
          <Link href="/" className="pop mt-7 inline-block bg-fg px-6 py-3 text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
            Open Loopin
          </Link>
        </section>
      </>
    );
  }

  const money = formatMoney(s.amount, s.group.currency);
  const to = first(s.toName);
  const from = first(s.fromName);

  return (
    <>
      {header}
      {sp.error && <ErrorNote>{sp.error}</ErrorNote>}
      {s.kind === "owes" ? <Owes s={s} money={money} to={to} from={from} token={token} undone={Boolean(sp.undone)} /> : <Done s={s} money={money} to={to} from={from} token={token} />}
      <p className="mt-10 text-center text-xs leading-relaxed text-gray-400">
        Loopin keeps count. It never holds or moves money.
        <br />
        <Link href="/" className="font-medium text-fg/70 underline underline-offset-2">
          Split trips, flats and card nights with Loopin
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
    <h2 className="mb-3 flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight">
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-fg/30 text-xs font-sans">{n}</span> {text}
    </h2>
  );
  return (
    <>
      <section aria-label="What you owe" className="vault lp-rise relative overflow-hidden rounded-[24px] px-6 pb-6 pt-6" data-paylink="owes">
        <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-[radial-gradient(closest-side,rgba(111,227,168,0.18),transparent)]" />
        <p className="font-hand text-[24px] font-bold leading-none text-fg/75">{to} is asking</p>
        <p className="mt-3 font-display text-[52px] font-semibold leading-none tracking-tight tabular-nums" data-paylink-amount>
          {money}
        </p>
        <p className="mt-3 text-sm text-fg/60">
          for <span className="font-medium text-fg/85">{s.group.name}</span> · hi {from}
        </p>
      </section>

      {undone && <p className="mt-4 rounded-xl bg-mist px-4 py-3 text-sm text-gray-500">Done, it’s taken back. Tap I’ve paid again once you’ve paid.</p>}

      <section className="mt-7" aria-label={`Pay ${to}`}>
        {step(1, `Pay ${to}`)}
        {upi ? (
          <div className="space-y-3">
            <a href={upi.href} className="pop block w-full bg-fg px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63]" data-pay="upi">
              Pay {money} with UPI
            </a>
            <div className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] text-gray-400">UPI ID</span>
                <span className="block truncate font-mono text-sm">{acc?.upiId}</span>
              </span>
              <CopyButton text={acc?.upiId ?? ""} label="Copy" />
            </div>
            <details className="rounded-2xl border border-line px-4 py-3">
              <summary className="cursor-pointer text-sm text-gray-500">On a laptop? Scan this with your phone</summary>
              <div className="mx-auto mt-3 w-48 overflow-hidden rounded-xl" dangerouslySetInnerHTML={{ __html: qr }} />
            </details>
          </div>
        ) : other ? (
          <a href={other.href} target="_blank" rel="noopener noreferrer" className="pop block w-full bg-fg px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63]" data-pay={other.kind}>
            Pay {money} with {other.label}
          </a>
        ) : (
          <p className="rounded-2xl border border-line px-4 py-3 text-sm text-gray-500">Pay {to} the way you usually do: UPI, cash or a bank transfer.</p>
        )}
      </section>

      <section className="mt-7" aria-label="Tell them you paid">
        {step(2, `Tell ${to}`)}
        <form action={iPaidAction}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="pop block w-full bg-owed px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#1f6b4a]" data-i-paid>
            I’ve paid {money} ✓
          </button>
        </form>
        <p className="mt-2 text-center text-xs text-gray-400">
          Only if you’re {from}. {to} gets a note to confirm it.
        </p>
      </section>
    </>
  );
}

function Done({ s, money, to, from, token }: { s: Shown; money: string; to: string; from: string; token: string }) {
  const when = s.paidAt ? s.paidAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) : "";
  const view =
    s.kind === "said"
      ? { tone: "wait" as const, title: `Sent. ${to} will check it off.`, text: `You said you paid ${money}${when ? ` on ${when}` : ""}. As soon as ${to} taps Got it, you’re square.` }
      : s.kind === "closed"
      ? { tone: "rest" as const, title: "This group is closed", text: `${s.group.name} is closed, so there’s nothing to do here. Thanks, ${from}!` }
      : s.confirmed
      ? { tone: "ok" as const, title: `${to} got it. All square!`, text: `${money} for ${s.group.name}, confirmed. Nice one, ${from}.` }
      : { tone: "ok" as const, title: `Nothing to pay ${to} right now`, text: `You’re square with ${to} in ${s.group.name}.` };
  return (
    <section className="vault lp-rise rounded-[24px] px-6 py-9 text-center" data-paylink={s.kind}>
      <Mark tone={view.tone} />
      <h1 className="mt-5 font-display text-[26px] font-semibold leading-tight tracking-tight">{view.title}</h1>
      <p className="mx-auto mt-2 max-w-[20rem] text-sm text-fg/60">{view.text}</p>
      {s.kind === "said" && (
        <form action={undoIPaidAction} className="mt-6">
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="text-sm font-medium text-fg/70 underline underline-offset-4">
            Tapped by mistake? Take it back
          </button>
        </form>
      )}
    </section>
  );
}
