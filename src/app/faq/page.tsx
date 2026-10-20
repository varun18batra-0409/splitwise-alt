import Link from "@/components/Link";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "FAQ · Loopin" };

// Frequently asked questions: short, plain answers, grouped. Each opens on tap.
type QA = { q: string; a: React.ReactNode };
const link = "underline underline-offset-4";

const SECTIONS: { title: string; items: QA[] }[] = [
  {
    title: "Getting started",
    items: [
      {
        q: "What is Loopin?",
        a: "A free way to split costs with friends on a trip, flatmates at home, or the two of you as a couple. Everyone adds what they paid, Loopin keeps the balances, and works out the fewest payments to settle up.",
      },
      {
        q: "Is it really free? Any limits or ads?",
        a: "Yes, it’s free: no ads, no daily limit on expenses, and nothing held back for a paid plan.",
      },
      {
        q: "Do my friends need to sign up?",
        a: "Yes, with an email (or Google), once. It takes about 30 seconds and there’s no password. It means everyone in a group is a real person, notifications reach the right phone, and friends can find each other.",
      },
      {
        q: "How do I sign in without a password?",
        a: (
          <>
            Three ways: <strong>Continue with Google</strong>; your email, where we send a 6-digit code; or, once you’ve turned it on in{" "}
            <strong>You</strong>, your <strong>fingerprint or face</strong> with one touch.
          </>
        ),
      },
      {
        q: "Can I use it on more than one phone, or install it as an app?",
        a: "Sign in on any phone and your groups are there. To put Loopin on your home screen, tap App on the Home screen and follow the two steps for your phone (no app store needed).",
      },
    ],
  },
  {
    title: "Splitting and settling",
    items: [
      {
        q: "How do I split unequally?",
        a: (
          <>
            When adding an expense, choose <strong>Only some</strong> (equally between the people you tick) or <strong>Custom</strong>: exact
            amounts, percentages, or shares (say 2 : 1 for a bigger room). You can also set a default split for the whole group in its
            settings.
          </>
        ),
      },
      {
        q: "Two people paid, or we got money back?",
        a: "Pick more than one payer and type what each paid. For a refund or returned item, switch to Money back; it’s shared the same way and the balances move back.",
      },
      {
        q: "We’re abroad. How do currencies and card fees work?",
        a: "Add the expense in the currency you paid. Loopin converts it at the day’s rate and, for card payments, can add your bank’s foreign-card fee (set it once in the group’s settings), so the person who paid isn’t out of pocket. Cash has no fee. You can type your own rate too.",
      },
      {
        q: "How does Settle up work? Does Loopin move money?",
        a: "Settle up shows the fewest payments that clear everything, even across all your groups at once. You pay each other however you like, then tap Mark paid. Loopin only records payments; it never holds or moves money and never asks for bank details.",
      },
      {
        q: "I made a mistake. Can I undo it?",
        a: "Yes. Edit or delete any expense or payment, and use Undo right after a change. Every change is kept in the group’s history, and everyone in the group is told.",
      },
    ],
  },
  {
    title: "Flats and couples",
    items: [
      {
        q: "How do rent and bills work for flatmates?",
        a: "Make a Home group and set up each bill once. Fixed ones (rent, Wi-Fi) add themselves on the day; ones that change (electricity) ask whoever pays to enter the amount; daily ones (milk) add up by the month. Anyone can skip or undo a month.",
      },
      {
        q: "Can a couple split by income instead of 50/50?",
        a: "Yes. A Couple group can use 50/50, a ratio you choose, or one worked out from your incomes (say 55/45). The incomes are only used on your phone to work out the ratio; they aren’t sent or saved.",
      },
    ],
  },
  {
    title: "Bringing groups over",
    items: [
      {
        q: "Can I bring my groups over from Splitwise or another app?",
        a: (
          <>
            Yes. Export the group as a spreadsheet (CSV) from the other app, then tap <strong>Bring a group over</strong> and pick the file.
            Splitwise exports and Loopin downloads are read as they are; for anything else, Loopin asks which column is which. Every
            expense and payment comes across, and the other app keeps its copy. <Link href="/import" className={link}>Bring a group over</Link>
          </>
        ),
      },
      {
        q: "Someone shows “not on Loopin yet”. What does that mean?",
        a: "They were added by name (for example, brought over from another app) and haven’t signed up yet. Tap their name on People and invite them by email: when they sign up, they take over that name with all its expenses.",
      },
    ],
  },
  {
    title: "Your data and privacy",
    items: [
      {
        q: "How do you handle my data?",
        a: (
          <>
            We keep only what the app needs: your email and name, your groups and their expenses, and a small sign-in cookie on your phone.
            No ads, no tracking, and we don’t sell or share your data. We never ask for bank or card details.{" "}
            <Link href="/privacy" className={link}>
              Full privacy details
            </Link>
          </>
        ),
      },
      {
        q: "Who can see my group?",
        a: "Only the people in it. Anyone else opening its address sees “Private group”, with no names or amounts. Share the group’s invite link or QR code only with the people who should join.",
      },
      {
        q: "Can I download my data?",
        a: (
          <>
            Yes. <strong>You → Download all my data</strong> gives one spreadsheet with every group, your share of each expense, and your
            account details. Each group’s settings also has Download spreadsheet for just that group.
          </>
        ),
      },
      {
        q: "How do I delete a group, or my account?",
        a: "A group can be deleted from its settings; anyone in it can restore it from Home → Recently deleted for 30 days. To remove your email and sign-in, go to You → Delete my email & sign-in. Your groups stay, under the name you used in them.",
      },
      {
        q: "What does fingerprint / face sign-in share with Loopin?",
        a: "Nothing about your fingerprint or face. Your phone checks it’s you and gives Loopin a key that proves it. You can remove it any time from the You page.",
      },
    ],
  },
];

export default function Faq() {
  return (
    <>
      <PageHeader title="FAQ" back="/" />
      <h1 className="font-display text-[28px] font-semibold leading-tight">Questions, answered</h1>
      <p className="mt-2 text-sm text-gray-500">
        Tap a question to open it. For a full tour, see <Link href="/how-it-works" className={link}>How Loopin works</Link>.
      </p>
      {SECTIONS.map((s) => (
        <section key={s.title} className="mt-8" aria-label={s.title}>
          <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">{s.title}</h2>
          <ul className="divide-y divide-line border-y border-line">
            {s.items.map((x) => (
              <li key={x.q}>
                <details className="group/faq">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3.5 font-medium [&::-webkit-details-marker]:hidden">
                    <span>{x.q}</span>
                    <span className="shrink-0 text-gray-400 transition-transform group-open/faq:rotate-45" aria-hidden>
                      +
                    </span>
                  </summary>
                  <div className="pb-4 text-[15px] leading-relaxed text-gray-600">{x.a}</div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
