import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import Link from "@/components/Link";
import { Notice } from "@/components/Notice";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CopyButton, PaidForm, ShareCollection } from "@/components/CollectBits";
import { ErrorNote, PageHeader, inputClass, secondaryButtonClass } from "@/components/ui";
import { INK, INK_OWED } from "@/components/Polaroid";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { loadCollection, loopinFriends, personalReminder, progress, reminderText, upiLink, whatsappTo } from "@/lib/collect";
import { FriendPicker } from "@/components/FriendPicker";
import { PickContacts } from "@/components/PickContacts";
import { organiserActionForm, undoPaidAction } from "@/app/collect-actions";
import { whatsappLink } from "@/lib/whatsapp";

// One collection's page: the link people open from the WhatsApp group.
// Anyone with it can pay the organiser directly and tick their name; the
// organiser (signed in) also checks payments off, reminds, and closes it.

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ new?: string; ticked?: string; undone?: string; added?: string; reminded?: string; error?: string }> };

const when = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await loadCollection((await params).code);
  if (!c) return { title: "Collection", robots: { index: false } };
  const each = c.amount ? `${formatMoney(c.amount, c.currency)} each` : "Any amount";
  const description = `${each}${c.dueDate ? ` · by ${when(c.dueDate)}` : ""}. Pay ${c.organiser} and tick your name.`;
  return { title: c.title, description, robots: { index: false, follow: false }, openGraph: { title: `${c.organiser} is collecting: ${c.title}`, description } };
}

const PAY_NAMES: Record<string, string> = { "paypal.me": "PayPal", "www.paypal.me": "PayPal", "venmo.com": "Venmo", "account.venmo.com": "Venmo", "cash.app": "Cash App", "revolut.me": "Revolut", "monzo.me": "Monzo" };

export default async function CollectionPage({ params, searchParams }: Props) {
  const { code } = await params;
  const sp = await searchParams;
  const [c, account, jar, tz, h] = await Promise.all([loadCollection(code), getAccount(), cookies(), getTimeZone(), headers()]);
  if (!c) notFound();
  const isOrganiser = account?.id === c.accountId;
  // Loopin friends not on the list yet (to add, for in-app notifications).
  const friends = isOrganiser ? (await loopinFriends(c.accountId)).filter((f) => !c.entries.some((e) => e.accountId === f.id)) : [];
  const payer = jar.get("lp_payer")?.value ?? "";
  const mine = payer ? c.entries.filter((e) => e.payerKey === payer && e.status !== "due") : [];
  const due = c.entries.filter((e) => e.status === "due");
  const paid = c.entries.filter((e) => e.status !== "due").sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0));
  const p = progress(c.entries, c.amount);
  const pct = p.target > 0 ? Math.min(100, Math.round((p.collected / p.target) * 100)) : p.people > 0 ? Math.round((p.paidCount / p.people) * 100) : 0;
  const money = (n: number) => formatMoney(n, c.currency);
  const late = c.dueDate && c.dueDate < todayKey(new Date(), tz);
  const closed = Boolean(c.closedAt);

  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const path = `/c/${c.code}`;
  const link = `${proto}://${host}${path}`;
  const upi = c.currency === "INR" && c.upiId ? upiLink(c, c.amount) : "";
  const qr = upi ? await QRCode.toString(upi, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0d0d0f", light: "#f4f2ec" } }) : "";
  const payHost = c.payLink ? new URL(c.payLink).hostname : "";
  const remind = whatsappLink(reminderText(c, due.map((d) => d.name), link));
  const shareText = `${c.title}: ${c.amount ? `${money(c.amount)} each` : "chip in"}. Pay and tick your name here:`;

  const orgForm = (kind: string, entryId: string | undefined, label: React.ReactNode, cls: string, confirm?: string) => (
    <form action={organiserActionForm}>
      <input type="hidden" name="code" value={c.code} />
      <input type="hidden" name="kind" value={kind} />
      {entryId && <input type="hidden" name="entryId" value={entryId} />}
      {confirm ? (
        <ConfirmButton message={confirm} className={cls}>
          {label}
        </ConfirmButton>
      ) : (
        <button type="submit" className={cls}>
          {label}
        </button>
      )}
    </form>
  );
  const payBlock = (cls: string) => (
        <section aria-label="Pay and tick your name" className={cls}>
          <div>
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-fg text-xs text-canvas">1</span> Pay {c.organiser}
            </h2>
            {upi ? (
              <div className="space-y-3">
                <a href={upi} className="pop block w-full bg-fg px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63]">
                  {c.amount ? `Pay ${money(c.amount)} with UPI` : "Pay with UPI"}
                </a>
                <div className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] text-gray-400">UPI ID</span>
                    <span className="block truncate font-mono text-sm">{c.upiId}</span>
                  </span>
                  <CopyButton text={c.upiId} label="Copy" />
                </div>
                <details className="rounded-2xl border border-line px-4 py-3">
                  <summary className="cursor-pointer text-sm text-gray-500">On a laptop? Scan this with your phone</summary>
                  <div className="mx-auto mt-3 w-48 overflow-hidden rounded-xl" dangerouslySetInnerHTML={{ __html: qr }} />
                </details>
              </div>
            ) : c.payLink ? (
              <a href={c.payLink} target="_blank" rel="noopener noreferrer" className="pop block w-full bg-fg px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63]">
                Pay with {PAY_NAMES[payHost] ?? "their link"}
              </a>
            ) : (
              <p className="rounded-2xl border border-line px-4 py-3 text-sm text-gray-500">Pay {c.organiser} directly: cash, bank transfer, however you usually do.</p>
            )}
          </div>
          <div>
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-fg text-xs text-canvas">2</span> Tick your name
            </h2>
            <PaidForm code={c.code} due={due.map((d) => ({ id: d.id, name: d.name }))} anyAmount={!c.amount} amountHint={c.currency === "INR" ? "E.g. 300" : "E.g. 20"} />
          </div>
        </section>
  );
  const chip = "rounded-full border border-line px-3 py-1.5 text-xs font-semibold active:bg-mist";

  return (
    <>
      {isOrganiser ? (
        <PageHeader title="Collection" back="/" />
      ) : (
        <header className="mb-6 flex items-center justify-between">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight">
            Loopin
          </Link>
          <span className="text-xs text-gray-400">No sign-up needed</span>
        </header>
      )}

      {sp.error && <ErrorNote>{sp.error}</ErrorNote>}
      {sp.undone && (
        <Notice tone="info" params={["undone"]} className="mb-4">
          Done. Your name is back on “still to pay”.
        </Notice>
      )}
      {sp.reminded && (
        <Notice tone="success" params={["reminded"]} className="mb-4">
          Reminder sent in Loopin.
        </Notice>
      )}
      {sp.added && (
        <Notice tone="success" params={["added"]} className="mb-4">
          Added to the list.
        </Notice>
      )}

      {/* The jar: who's collecting, for what, and how far along it is */}
      <section aria-label="This collection" className="vault relative overflow-hidden rounded-[24px] px-5 pb-5 pt-5 text-fg">
        <span
          aria-hidden
          className="absolute right-4 top-4 rotate-[7deg] bg-[#f4f1e8] px-2.5 pb-1 pt-1.5 text-center shadow-[0_10px_20px_-8px_rgba(0,0,0,0.9)]"
          style={{ color: INK }}
        >
          <span className="block font-hand text-[26px] font-bold leading-none tabular-nums">
            {p.paidCount}
            {p.people > 0 && <span className="text-[18px]">/{p.people}</span>}
          </span>
          <span className="block text-[10px] font-semibold uppercase tracking-wide" style={{ color: INK_OWED }}>
            paid
          </span>
        </span>
        <p className="pr-20 font-hand text-[24px] font-bold leading-none text-fg/75">{c.organiser} is collecting</p>
        <h1 className="mt-2 pr-16 font-display text-[28px] font-semibold leading-[1.1] tracking-tight" data-collection-title>
          {c.title}
        </h1>
        {c.note && <p className="mt-2 text-sm text-fg/60">{c.note}</p>}
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-fg/[0.08] px-2.5 py-1 font-semibold">{c.amount ? `${money(c.amount)} each` : "Any amount"}</span>
          {c.dueDate && <span className={`rounded-full px-2.5 py-1 ${late && !closed ? "bg-owe/15 text-owe" : "bg-fg/[0.08] text-fg/70"}`}>{late ? `Was due ${when(c.dueDate)}` : `By ${when(c.dueDate)}`}</span>}
          {closed && <span className="rounded-full bg-fg/[0.08] px-2.5 py-1 text-fg/70">Closed</span>}
        </div>
        <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-fg/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="How much is in">
          <span className="lp-bar-x block h-full rounded-full bg-meter-up shadow-[0_0_16px_-2px_rgba(37,169,111,0.8)]" style={{ width: `${Math.max(pct, p.paidCount ? 4 : 0)}%` }} />
        </div>
        <p className="mt-2 flex items-baseline justify-between text-sm" data-collection-progress>
          <span className="text-fg/70">
            {p.paidCount} of {p.people || p.paidCount} paid
          </span>
          <span className="font-semibold tabular-nums">
            {money(p.collected)}
            {p.target > 0 && <span className="font-normal text-fg/45"> of {money(p.target)}</span>}
          </span>
        </p>
      </section>

      {/* The organiser: share, remind, add names */}
      {isOrganiser && (
        <section aria-label="Share and remind" className="mt-5 space-y-3">
          {sp.new && (
            <p className="rounded-xl bg-owed/10 px-4 py-3 text-sm text-owed">
              Your link is ready. Drop it in the group: people pay you, then tick their name here.
              {due.some((d) => d.phone) && " Or send it to each person with the WhatsApp button next to their name."}
            </p>
          )}
          <ShareCollection path={path} title={c.title} text={shareText} className="pop block w-full bg-fg px-4 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63]">
            Share the link
          </ShareCollection>
          {due.length > 0 && !closed && (
            <a href={remind} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass}>
              Remind the {due.length} still to pay on WhatsApp
            </a>
          )}
          <details className="rounded-2xl border border-line px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">Add names to the list</summary>
            <form action={organiserActionForm} className="mt-3 space-y-3">
              <input type="hidden" name="code" value={c.code} />
              <input type="hidden" name="kind" value="add" />
              <textarea name="names" rows={3} placeholder="One name per line, or with commas" className={`${inputClass} resize-y`} />
              <PickContacts />
              <FriendPicker friends={friends} />
              <button type="submit" className={secondaryButtonClass}>
                Add
              </button>
            </form>
          </details>
        </section>
      )}

      {/* You've ticked */}
      {!isOrganiser && mine.length > 0 && (
        <section aria-label="You're on the list" className="mt-5 space-y-2">
          {mine.map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-2xl bg-owed/10 px-4 py-3 text-owed">
              <span aria-hidden className="text-xl">
                {e.status === "confirmed" ? "✓✓" : "✓"}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-semibold">
                  {e.name} · {money(e.amount)}
                </span>
                <span className="block text-owed/80">{e.status === "confirmed" ? `${c.organiser} has checked it. All done.` : `You’re on the list. ${c.organiser} will check it off.`}</span>
              </span>
              {e.status === "paid" && (
                <form action={undoPaidAction}>
                  <input type="hidden" name="code" value={c.code} />
                  <input type="hidden" name="entryId" value={e.id} />
                  <button type="submit" className="text-xs font-semibold underline">
                    Undo
                  </button>
                </form>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Pay, then tick (folded away once this phone has ticked, for paying for someone else too) */}
      {!isOrganiser && !closed && (mine.length === 0 ? (
        payBlock("mt-6 space-y-5")
      ) : (
        <details className="mt-5 rounded-2xl border border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">Paying for someone else too?</summary>
          {payBlock("mt-4 space-y-5")}
        </details>
      ))}
      {!isOrganiser && closed && <p className="mt-5 rounded-xl bg-mist px-4 py-3 text-sm text-gray-500">{c.organiser} has closed this collection. Thanks, everyone!</p>}

      {/* Still to pay */}
      {due.length > 0 && (
        <section aria-label="Still to pay" className="mt-8">
          <h2 className="mb-2 flex items-baseline justify-between font-display text-lg font-semibold tracking-tight">
            Still to pay <span className="font-sans text-xs font-normal text-gray-400">{due.length}</span>
          </h2>
          <ul className="divide-y divide-line">
            {due.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2.5">
                <span aria-hidden className="h-5 w-5 shrink-0 rounded-full border-2 border-fg/25" />
                <span className="min-w-0 flex-1 truncate text-[15px]">
                  {e.name}
                  {isOrganiser && e.accountId && <span className="ml-2 rounded-md bg-owed/[0.12] px-1.5 py-[3px] align-middle text-[10px] font-semibold uppercase tracking-wide text-owed">on Loopin</span>}
                </span>
                {isOrganiser && (
                  <span className="flex shrink-0 items-center gap-2">
                    {e.accountId &&
                      !closed &&
                      orgForm(
                        "nudge",
                        e.id,
                        <>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                          </svg>
                          <span className="sr-only">Remind {e.name} in Loopin</span>
                        </>,
                        "flex h-8 w-8 items-center justify-center rounded-full border border-owed/40 text-owed active:bg-mist",
                      )}
                    {!e.accountId && e.phone && !closed && (
                      <a
                        href={whatsappTo(e.phone, personalReminder(c, e.name, link))}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Remind ${e.name} on WhatsApp`}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-owed/40 text-owed active:bg-mist"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
                        </svg>
                      </a>
                    )}
                    {c.amount > 0 && orgForm("cash", e.id, "Paid cash", chip)}
                    {orgForm("remove", e.id, "✕", "flex h-8 w-8 items-center justify-center rounded-full text-gray-400 active:bg-mist", `Take ${e.name} off the list?`)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Paid */}
      {paid.length > 0 && (
        <section aria-label="Paid" className="mt-8">
          <h2 className="mb-2 flex items-baseline justify-between font-display text-lg font-semibold tracking-tight">
            Paid <span className="font-sans text-xs font-normal text-gray-400">{paid.length}</span>
          </h2>
          <ul className="divide-y divide-line">
            {paid.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2.5">
                {/* Ticked by them: an outlined tick. Checked by the organiser: a filled one. */}
                <span
                  aria-hidden
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${e.status === "confirmed" ? "bg-meter-up text-canvas" : "border-2 border-meter-up text-owed"}`}
                >
                  ✓
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{e.name}</span>
                  <span className="block text-xs text-gray-400">
                    {money(e.amount)}
                    {e.method === "cash" ? " · cash" : ""} · {e.status === "confirmed" ? `checked by ${isOrganiser ? "you" : c.organiser}` : "says paid"}
                  </span>
                </span>
                {isOrganiser && (
                  <span className="flex shrink-0 items-center gap-2">
                    {e.status === "paid" ? orgForm("confirm", e.id, "Got it", `${chip} border-owed/40 text-owed`) : orgForm("unconfirm", e.id, "Uncheck", "text-xs text-gray-400 underline")}
                    {orgForm("remove", e.id, "✕", "flex h-8 w-8 items-center justify-center rounded-full text-gray-400 active:bg-mist", `Take ${e.name} off the list? Their tick goes too.`)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {isOrganiser && p.paidCount > p.checked && (
            <p className="mt-2 text-xs text-gray-400">“Says paid” means they ticked it. Tap Got it once you see the money.</p>
          )}
        </section>
      )}

      {c.entries.length === 0 && (
        <p className="mt-8 rounded-xl bg-mist px-4 py-3 text-sm text-gray-500">
          {isOrganiser ? "No names yet. Share the link: people add themselves when they tick, or add names above." : "Nobody has ticked yet. Be the first!"}
        </p>
      )}

      {/* The organiser's last controls */}
      {isOrganiser && (
        <section aria-label="Close or delete" className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          {closed ? orgForm("reopen", undefined, "Reopen collection", chip) : orgForm("close", undefined, "Close collection", chip, "Close it? People won’t be able to tick their name any more. You can reopen it.")}
          {orgForm("delete", undefined, "Delete", "text-xs text-red-500 underline", "Delete this collection for everyone? This can’t be undone.")}
        </section>
      )}

      {!isOrganiser && (
        <p className="mt-12 text-center text-xs text-gray-400">
          Loopin never touches the money: you pay {c.organiser} directly.
          <br />
          <Link href="/collect/new" className="mt-2 inline-block font-semibold text-fg underline">
            Collecting for your own group? Make a link
          </Link>
        </p>
      )}
    </>
  );
}
