import Link from "next/link";
import photos from "@/generated/photos.json";
import { PageHeader } from "@/components/ui";
import { GetAppButton } from "@/components/GetApp";

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

function Section({ slot, title, children }: { slot: Slot; kicker?: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <Photo slot={slot}>
        <h2 className="mt-1 font-display text-[26px] font-semibold leading-tight tracking-tight text-fg">{title}</h2>
      </Photo>
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

function Example({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-line bg-mist px-4 py-3 text-sm text-fg">{children}</div>;
}

// "How Loopin works": the detailed guide, with real photos. The quick
// swipe-through tour is still at /welcome (linked at the top).
export default function HowItWorks() {
  return (
    <>
      <PageHeader title="How Loopin works" back="/" />

      <Photo slot="hero" tall>
        <p className="font-display text-[34px] font-semibold leading-[1.05] tracking-tight text-fg">
          Everyone’s in.
          <br />
          Everything adds up.
        </p>
        <p className="mt-2 text-sm text-fg/75">Split trips, flats and dinners with friends. Free, no ads, no limits.</p>
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
          ["#home", "Flatmates"],
          ["#safe", "Undo & privacy"],
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
            <>Tap <strong>Create a group</strong>: give it a name (“Euro trip”), your name and the currency.</>,
            <>Open <strong>Invite</strong> and share the link on WhatsApp, or let friends scan the QR code.</>,
            <>Friends tap their name and they’re in. No sign-up, no password.</>,
          ]}
        />
        <p>Added someone who hasn’t joined yet? You can still add expenses for them; they’ll see everything when they open the link.</p>
      </Section>

      <div id="add" className="scroll-mt-4" />
      <Section slot="dinner" kicker="2 · Add" title="Add an expense in seconds">
        <Steps
          items={[
            <>Tap the <strong>＋</strong> at the bottom.</>,
            <>Pick <strong>who paid</strong>, type what it was and how much. Loopin tags it for you (🍽️ Food, 🚕 Transport, 🏨 Stay…).</>,
            <>Choose how to split: <strong>Everyone equally</strong>, <strong>Only some</strong> people, or <strong>Custom</strong> (exact amounts or %).</>,
          ]}
        />
        <p>Change the date if it wasn’t today, and add a note if it helps (“Rahul paid the tip”). Next time, Loopin starts with the same split you used last.</p>
        <Example>
          Dinner ₹1,200 · Joey paid · Everyone equally (4)
          <br />
          <span className="text-gray-500">→ Rancho, Sheldon and Circuit each owe Joey ₹300.</span>
        </Example>
      </Section>

      <div id="abroad" className="scroll-mt-4" />
      <Section slot="market" kicker="3 · Abroad" title="Spend in yen. Settle in rupees.">
        <p>
          Pay in any of 150+ currencies. Loopin converts at today’s rate and adds your card’s foreign-transaction fee, the hidden
          cost most split apps ignore. Everyone pays their fair share of what it <strong className="text-fg">really</strong> cost you.
        </p>
        <Example>
          Ramen night in Shinjuku · paid by card
          <br />
          ¥6,000 → ₹3,390 + 3% card fee ₹102 = <strong>₹3,492</strong>
          <br />
          <span className="text-gray-500">Cash? No fee is added. Bank rate different? Type your own.</span>
        </Example>
        <p>Balances show in your home currency and in the local one, so nobody has to do maths at the table.</p>
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
        <p>Loopin only records payments. It never moves money and never asks for bank details. Trip over? Close the group; its history stays.</p>
      </Section>

      <div id="home" className="scroll-mt-4" />
      <Section slot="home" kicker="Living together" title="Flatmates and home bills">
        <p>
          Make a group for your flat and add rent, electricity, Wi-Fi, groceries and house help as they come. Everyone sees the same
          numbers, and you settle up whenever you like. Recurring bills are coming soon.
        </p>
      </Section>

      <div id="safe" className="scroll-mt-4" />
      <section className="mt-12 space-y-3 text-[15px] leading-relaxed text-gray-600">
        <h2 className="font-display text-[26px] font-semibold tracking-tight text-fg">Mistakes happen. Fix them.</h2>
        <p>Every change can be undone, and the history shows who changed what. Everyone in the group gets an alert.</p>
        <p>
          Your groups live on your phone. Optionally <Link href="/signin?mode=signup" className="font-medium text-fg underline underline-offset-4">sign up with your email</Link> to
          get them back on any phone. No ads, and your data isn’t sold. <Link href="/privacy" className="underline underline-offset-4">Privacy</Link>
        </p>
      </section>

      <GetAppButton variant="card" className="mt-10" />
      <Link href="/groups/new" className="pop mt-4 block bg-fg px-4 py-3.5 text-center font-semibold text-canvas [--pop-edge:#6e6b63]">
        Create a group
      </Link>
    </>
  );
}
