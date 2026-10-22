import Link from "@/components/Link";
import photos from "@/generated/photos.json";
import { PageHeader } from "@/components/ui";
import { GetAppButton } from "@/components/GetApp";
import { headers } from "next/headers";
import { visitorRegion } from "@/lib/region";
import { decimalsOf, formatMoney } from "@/lib/money";

export const metadata = { title: "How Loopin works" };

type Slot = keyof typeof FALLBACK;
// A colour to show if a photo couldn't be fetched when the app was built.
const FALLBACK = {
  hero: "from-sky-900 to-teal-800",
  roadtrip: "from-stone-800 to-amber-900",
  dinner: "from-rose-950 to-orange-900",
  market: "from-indigo-950 to-fuchsia-900",
  train: "from-yellow-900 to-stone-800",
  sunset: "from-orange-900 to-purple-950",
  friends: "from-orange-800 to-rose-950",
  home: "from-emerald-950 to-stone-800",
};
const pic = (slot: Slot) => (photos as Record<string, { src: string } | undefined>)[slot]?.src;

function Photo({ slot, children, tall }: { slot: Slot; children?: React.ReactNode; tall?: boolean }) {
  const src = pic(slot);
  return (
    <div className={`relative -mx-5 overflow-hidden bg-gradient-to-br ${FALLBACK[slot]} ${tall ? "h-[340px]" : "h-[200px]"}`}>
      {src && <img src={src} alt="" loading="eager" decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
      <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/30 to-transparent" />
      {children && <div className="absolute inset-x-5 bottom-5">{children}</div>}
    </div>
  );
}

function Section({ slot, title, children }: { slot?: Slot; kicker?: string; title: string; children: React.ReactNode }) {
  const heading = <h2 className="mt-1 font-display text-[26px] font-semibold leading-tight tracking-tight text-fg">{title}</h2>;
  return (
    <section className="mt-12">
      {slot ? <Photo slot={slot}>{heading}</Photo> : heading}
      <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-gray-600">{children}</div>
    </section>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fg text-xs font-semibold text-canvas">{i + 1}</span>
          <span className="text-fg/85">{it}</span>
        </li>
      ))}
    </ol>
  );
}

// A real screen from the app, in a phone-shaped frame.
function Screen({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="mx-auto w-[78%] max-w-[300px]">
      <div className="overflow-hidden rounded-[26px] border-[5px] border-[#2b2b31] bg-canvas shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
        <img src={src} alt={alt} loading="lazy" decoding="async" width={600} height={900} className="block h-auto w-full" />
      </div>
      <figcaption className="mt-2 text-center text-xs text-gray-500">{caption}</figcaption>
    </figure>
  );
}

function Example({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-line bg-mist px-4 py-3 text-sm text-fg">{children}</div>;
}

// "How Loopin works": the detailed guide, with real photos. The quick
// swipe-through tour is still at /welcome (linked at the top).
export default async function HowItWorks() {
  // Examples in the visitor's own currency (₹ in India, dollars and similar elsewhere).
  const { currency, india } = visitorRegion(await headers());
  const m = (major: number) => formatMoney(Math.round(major * 10 ** decimalsOf(currency)), currency);
  const x = india
    ? { dinner: 1200, each: 300, yen: 3390, fee: 102, four: 873, gift: 100 }
    : { dinner: 120, each: 30, yen: 40.2, fee: 1.21, four: 10.35, gift: 5 };
  return (
    <>
      <PageHeader title="How Loopin works" back="/" />

      <Photo slot="hero" tall>
        <p className="font-display text-[34px] font-semibold leading-[1.05] tracking-tight text-fg">
          Everyone’s in.
          <br />
          Everything adds up.
        </p>
        <p className="mt-2 text-sm text-fg/75">Split trips, flats and life as a couple. Free, no ads.</p>
      </Photo>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Link href="/welcome" className="border border-line px-3 py-3 text-center text-sm font-medium text-fg active:bg-mist">
          ▶ 1-minute tour
        </Link>
        <Link href="/groups/new" className="pop bg-fg px-3 py-3 text-center text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
          Create a group
        </Link>
      </div>

      <nav className="mt-8 flex flex-wrap gap-2 text-sm" aria-label="On this page">
        {[
          ["#start", "Start a group"],
          ["#add", "Add expenses"],
          ["#abroad", "Abroad & card fees"],
          ["#balances", "Who owes what"],
          ["#settle", "Settle up"],
          ["#trips", "Trip report"],
          ["#home", "Flatmates"],
          ["#couples", "Couples"],
          ["#safe", "Undo & privacy"],
          ["#splitwise", "From another app"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="rounded-full border border-line px-3 py-1.5 text-gray-600 active:bg-mist">
            {label}
          </a>
        ))}
      </nav>

      <div id="start" className="scroll-mt-4" />
      <Section slot="roadtrip" kicker="1 · Start" title="Make a group, bring everyone in">
        <Steps
          items={[
            <>Tap <strong>New group</strong> and pick what it’s for: <strong>Trip</strong>, <strong>Home</strong>, <strong>Couple</strong> or <strong>Other</strong>. Give it a name (“Euro trip”) and a currency. First time? Sign in with Google or your email in 30 seconds (no password). Next time, one touch with your fingerprint or face.</>,
            <>Add people: friends already on Loopin, people from your contacts, or anyone by email.</>,
            <>Or share the group’s link or QR code. People confirm their email and they’re in, and show up on the People screen. From then on everyone is told about every change.</>,
          ]}
        />
        <p>
          Someone shows as <strong>not on Loopin yet</strong> (brought over from another app, say)? Tap their name on People and invite them by
          email. They sign up and take over that name, with all its expenses.
        </p>
      </Section>

      <div id="add" className="scroll-mt-4" />
      <Section slot="dinner" kicker="2 · Add" title="Add an expense in seconds">
        <Steps
          items={[
            <>Tap the <strong>＋</strong> at the bottom.</>,
            <>Pick <strong>who paid</strong>, type what it was and how much. Loopin tags it for you (🍽️ Food, 🚕 Transport, 🏨 Stay…).</>,
            <>Choose how to split: <strong>Everyone equally</strong>, <strong>Only some</strong> people, or <strong>Custom</strong> (exact amounts, % or shares, like 2 : 1 for a bigger room).</>,
          ]}
        />
        <p>Change the date if it wasn’t today, and add a note if it helps (“Sam paid the tip”). Next time, Loopin starts with the same split you used last.</p>
        <p>
          <strong>Two people paid?</strong> Choose <strong>More than one</strong> payer. <strong>Got money back</strong> (a refund, a returned
          item)? Switch to <strong>Money back</strong> and it’s shared the same way. Adding a few in a row? <strong>Save &amp; add another</strong>.
          The same thing again? Open it and tap <strong>Repeat</strong>. Loopin warns you if something looks like a duplicate.
        </p>
        <Example>
          Dinner {m(x.dinner)} · Maya paid · Everyone equally (4)
          <br />
          <span className="text-gray-500">→ Sam, Priya and Leo each owe Maya {m(x.each)}.</span>
        </Example>
        <Example>
          Small amounts work too: a class gift at {m(x.gift)} each, pizza after practice, a shared cab.
        </Example>
      </Section>

      <div id="abroad" className="scroll-mt-4" />
      <Section slot="market" title="Trip mode on. Maths mode off.">
        <p>
          Ramen in Shibuya, paid on your card in yen? Loopin converts it at today’s rate, adds the fee your bank quietly charges, and
          splits it. Nobody does maths at the table, and the person who paid isn’t secretly out of pocket.
        </p>
        <div className="rounded-2xl border border-line bg-mist px-4 py-3 text-sm text-fg">
          <p className="mb-2 font-medium">🍜 Ramen in Shibuya · paid by card</p>
          <dl className="space-y-1 tabular-nums">
            <div className="flex justify-between"><dt className="text-gray-500">¥6,000 at today’s rate</dt><dd>{m(x.yen)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Your bank’s 3% card fee</dt><dd>+ {m(x.fee)}</dd></div>
            <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>Split four ways</dt><dd>{m(x.four)} each</dd></div>
          </dl>
        </div>
        <p>150+ currencies. Cash? No fee added. Better rate from the exchange booth? Type it in.</p>
      </Section>

      <Section slot="train" kicker="Getting around" title="Trains, cabs and tickets">
        <p>
          Not everyone took the same train? Use <strong>Only some</strong> and tap the people who did. A ticket for one person? Choose
          <strong> Custom → One person</strong>. Everyone else’s balance stays untouched.
        </p>
      </Section>

      <div id="balances" className="scroll-mt-4" />
      <Section slot="friends" kicker="4 · Balances" title="Who owes what, and why">
        <p>
          Home shows your <strong>net balance</strong> across all groups, and a <strong>Needs attention</strong> list: who owes you,
          who you owe, and what changed.
        </p>
        <p>
          Not sure about a number? Tap <strong>Why?</strong> under any balance. You’ll see every expense and payment behind it, including card fees, and it always adds up exactly.
        </p>
        <p className="mt-4">
          Looking for something? <strong>Recap</strong> (in the bottom bar) charts your spending by week, month or year, shows where it went, and finds any expense across your groups. <strong>Charts</strong> show where the money went, with a
          few plain lines on top (“Food is 42% of all spending”). <strong>Download</strong> in a group’s settings gives you its expenses as a
          spreadsheet; <strong>Download all my data</strong> on the You page gives you every group in one file.
        </p>
      </Section>

      <div id="settle" className="scroll-mt-4" />
      <Section slot="sunset" kicker="5 · Settle" title="Settle up with the fewest payments">
        <Steps
          items={[
            <>In a group, tap <strong>Settle up</strong>. Loopin shows the fewest payments that clear everything.</>,
            <>Paid in full? Tap <strong>Mark paid</strong>. Paid part? Change the amount first.</>,
            <>Owe the same friend in two groups? The <strong>Settle</strong> tab combines them into one payment.</>,
          ]}
        />
        <p>Loopin only records payments. It never moves money and never asks for bank details.</p>
      </Section>

      <div id="trips" className="scroll-mt-4" />
      <Section title="Trip over? The trip in numbers">
        <p>
          Open <strong>Charts → Trip report</strong>: the total, per person and per day, where it went, the biggest expense, who paid most and
          what’s left to settle. <strong>Share to WhatsApp</strong> sends it as a picture with a short message. There’s no link to the group,
          so only what’s in the picture leaves your phone.
        </p>
        <Screen src="/guide/trip-report.webp" alt="A trip report: total, per person, per day, top categories and each person's part" caption="The trip report, ready to share" />
        <p>Then settle up and close the group. It stays in your history, and so does the report.</p>
      </Section>

      <div id="home" className="scroll-mt-4" />
      <Section slot="home" kicker="Living together" title="Flatmates: the flat runs itself">
        <p>
          Make a <strong>Home</strong> group. It opens on <strong>This month</strong>: your share, the flat’s total, who owes whom and what’s coming up.
        </p>
        <Steps
          items={[
            <><strong>Bills on repeat.</strong> Set rent and Wi-Fi{india ? ", the cook" : ", streaming"} to repeat monthly once, and Loopin adds each one on the day (anyone can undo or skip a month). Nothing is read from your bank or messages. Electricity changes? Whoever pays gets a nudge to enter the amount.{india ? " Milk and water cans are added up at month end; tap the days they didn’t come." : ""}</>,
            <><strong>Shopping list.</strong> Add what’s running low, tick what you bought, type what it cost: one Groceries expense, items in the note.</>,
            <><strong>Budgets and the deposit.</strong> A nudge when groceries reach 80%. The deposit is kept on record, never mixed into balances.</>,
            <><strong>Moving out or in.</strong> Loopin works out their share for the days they stayed, who takes over their deposit, and the final payments.</>,
          ]}
        />
        <Screen src="/guide/flat-month.webp" alt="A flat's This month screen: your share, what you're owed, and the bills coming up" caption="A flat’s “This month”: bills coming up, one tap to enter electricity" />
        <p>Reminders (the day before a bill, and on your settle-up day) are off until you switch them on in the group’s settings.</p>
      </Section>

      <div id="couples" className="scroll-mt-4" />
      <Section title="Couples: your split, not 50/50">
        <p>
          Make a <strong>Couple</strong> group and set your split once: equal, a ratio, or worked out from your incomes (say 55 / 45). Every
          expense uses it unless you change that one.
        </p>
        <p>
          <strong>This month</strong> shows what you spent together and whether you’re <strong>ahead</strong> or <strong>behind</strong> your
          share, with one tap to even out. Saving for something? Start a <strong>goal</strong> and each tap “I set money aside”. The money stays
          in your own accounts.
        </p>
        <Screen src="/guide/couple-month.webp" alt="A couple's This month screen: spent together, you're ahead, and a savings goal" caption="A couple’s month: who’s ahead, where it went, the Bali fund" />
      </Section>

      <div id="safe" className="scroll-mt-4" />
      <section className="mt-12 space-y-3 text-[15px] leading-relaxed text-gray-600">
        <h2 className="font-display text-[26px] font-semibold tracking-tight text-fg">Mistakes happen. Fix them.</h2>
        <p>Every change can be undone, and the history shows who changed what. Everyone in the group gets an alert; you choose which alerts per group in its settings.</p>
        <p>
          You sign in with Google, your email (a code, no password) or your fingerprint or face, so your groups come back on any phone. Only people in a group can see it.
          No ads, and your data isn’t sold. <Link href="/privacy" className="underline underline-offset-4">Privacy</Link>
        </p>
      </section>

      <div id="splitwise" className="scroll-mt-4" />
      <section className="mt-12 space-y-3 text-[15px] leading-relaxed text-gray-600">
        <h2 className="font-display text-[26px] font-semibold tracking-tight text-fg">Coming from another app?</h2>
        <p>
          Export the group as a spreadsheet (CSV) from the other app (in Splitwise: the group → gear → <strong>Export as spreadsheet</strong>).
          In Loopin, tap <strong>Bring a group over</strong> and pick that file: every expense and payment comes across. Splitwise files are
          checked against their own totals; for other apps, you say which column is which.{" "}
          <Link href="/switching" className="underline underline-offset-4">What’s different</Link>
        </p>
      </section>

      <GetAppButton variant="card" className="mt-10" />
      <Link href="/groups/new" className="pop mt-4 block bg-fg px-4 py-3.5 text-center font-semibold text-canvas [--pop-edge:#6e6b63]">
        Create a group
      </Link>
    </>
  );
}
