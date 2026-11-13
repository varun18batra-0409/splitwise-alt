import Link from "@/components/Link";
import { PageHeader } from "@/components/ui";
import { supportHref } from "@/lib/support";

export const metadata = { title: "FAQ", description: "Answers about Loopin: getting started, adding expenses, settling up, groups, trips and flats, memories, privacy and your account.", alternates: { canonical: "/faq" } };

// Frequently asked questions: short, plain answers, grouped. Each opens on tap.
type QA = { q: string; a: React.ReactNode };
const link = "underline underline-offset-4";

const sections = (): { title: string; items: QA[] }[] => [
  {
    title: "Getting started",
    items: [
      { q: "What is Loopin?", a: "A free way to split costs with friends on a trip, flatmates at home, or the two of you as a couple. Everyone adds what they paid, Loopin keeps the balances, and works out a short list of payments to settle up." },
      { q: "Is it really free? Any limits or ads?", a: "Yes, Loopin is free to use right now: no ads and no limit on how many expenses you add." },
      { q: "Do my friends need to sign up?", a: "Yes, with an email (or Google), once. It takes about 30 seconds and there’s no password. It means everyone in a group has a checked email, so notifications reach the right phone." },
      {
        q: "What’s at the top of Home?",
        a: "Your money card first: where you stand across all your groups, who it’s with, and a button to Pay (when you owe) or Remind (when you’re owed). Under it, stories from your groups, then cards picked for right now, like a trip countdown, a bill due or a postcard waiting.",
      },
      {
        q: "Where are all my groups on Home?",
        a: "In a row of photos, most recently active first, with where you stand under each. Swipe sideways. With more than ten groups, tap See all at the end of the row to open the full list. Closed groups are tucked under Closed groups.",
      },
      {
        q: "Are there shortcuts for my thumb?",
        a: "Swipe an expense to the left for Edit and Delete. Drag any sheet down to close it. In stories, tap the right side for the next slide, hold or tap Pause to stop, and swipe down to close. In the installed app, pull down at the top of a screen to refresh.",
      },
    ],
  },
  {
    title: "Adding expenses",
    items: [
      {
        q: "How do I split unequally?",
        a: "When adding an expense, choose Only some (equal between the people you tick) or Custom: exact amounts, percentages, or shares like 2 : 1 for a bigger room. You can also set a default split for the whole group in its settings; it applies to new expenses, and ones already added keep their split.",
      },
      {
        q: "Can I just type an expense?",
        a: "Yes. Tap Type a line (or Speak) and write it the way you’d say it, like “Cab 600 except Dev”. Loopin fills in the form for you to check, and nothing saves until you tap Save.",
      },
      {
        q: "Does Loopin’s AI read my bills?",
        a: "Only if you say yes. The first time a bill photo or a line Loopin can’t follow could go to Anthropic, an AI company, Loopin asks. Anthropic doesn’t use it to train its models, and you can change your answer any time in You → Privacy and safety.",
      },
      { q: "Two people paid, or we got money back?", a: "Pick more than one payer and type what each paid. For a refund or returned item, switch to Money back; it’s shared the same way and the balances move back." },
      {
        q: "We’re abroad. How do currencies and card fees work?",
        a: "Add the expense in the currency you paid. Loopin converts it at the day’s rate and, for card payments, can add your bank’s foreign-card fee (set it once in the group’s settings). Cash has no fee, and you can type your own rate.",
      },
      { q: "I made a mistake. Can I undo it?", a: "Yes. Edit or delete any expense or payment, and use Undo right after a change. Undo works on the latest change to something, and it won’t change the balance of someone who has left." },
    ],
  },
  {
    title: "Settling up and payments",
    items: [
      {
        q: "How does Settle up work? Does Loopin move money?",
        a: "Settle up shows a short list, like “Just 3 payments”, that clears everything, even across all your groups at once. You pay each other however you like and tap I’ve paid. Loopin only records payments; it never holds or moves money.",
      },
      {
        q: "What happens when someone says they paid me?",
        a: "It shows as “says they paid, to be confirmed” and the balances don’t move. You’re asked to tap Confirm received or Not received, in Settle up and on your phone; Not received leaves everything as it was.",
      },
      {
        q: "Can someone tell me they paid without having Loopin?",
        a: "Yes. Tap Remind in Settle up and WhatsApp opens with a note and a link. They pay, tap I’ve paid with no sign-in, and you confirm. The link only works for that one debt, and stops once you’re square or after 30 days.",
      },
      {
        q: "Can people pay me in one tap?",
        a: "Yes. Add your UPI ID, or a PayPal or similar payment link, on the You page. Anyone who owes you gets a Pay button in Settle up that opens their payment app with the amount filled in. The money goes straight between you.",
      },
      {
        q: "Where is Collect, and what do “says paid” and “checked” mean?",
        a: "Tap New group and pick Collect: one link to gather money for a gift or a booking. People tick their name, which shows as says paid; you tap Got it once you see the money, and it becomes checked. Only checked money counts as collected.",
      },
    ],
  },
  {
    title: "Groups and people",
    items: [
      {
        q: "How do I invite friends?",
        a: "Share the group’s link or QR code, add people from your contacts, or invite them by email. To invite someone to Loopin without making a group, tap Invite friends to Loopin on Home or the You page.",
      },
      { q: "Can I give a group a picture, or use my own photo?", a: "Yes. In the group’s settings, pick a drawn picture or a photo, or tap Your photo to choose one from your gallery. Your own photo is made small on your phone first, and only people in the group can see it." },
      {
        q: "Someone shows “not on Loopin yet”. What does that mean?",
        a: "They were added by name and haven’t signed up yet. Tap their name on People and invite them by email: when they sign up, they take over that name with all its expenses.",
      },
      {
        q: "What does someone who left a group still see?",
        a: "The group as it was the day they left, plus any later change to their own share. Notes on expenses edited after they left aren’t shown to them.",
      },
      { q: "Can I use it on more than one phone, or install it as an app?", a: "Sign in on any phone and your groups are there. To put Loopin on your home screen, tap App on the Home screen and follow the steps for your phone." },
    ],
  },
  {
    title: "Trips, flats and couples",
    items: [
      {
        q: "How do rent and bills work for flatmates?",
        a: "Make a Home group and set each bill to repeat once. Fixed ones are added on the day, ones that change ask whoever pays for the amount, and daily ones add up by the month. Anyone can skip or undo a month, and nothing is read from your bank or messages.",
      },
      { q: "Can a couple split by income instead of 50/50?", a: "Yes. A Couple group can use 50/50, a ratio you choose, or one worked out from your incomes. The incomes are only used on your phone to work out the ratio; they aren’t sent or saved." },
      {
        q: "What is Game night?",
        a: "For cards, board games or any game you play together. Make a group and pick Game night, put chips in for everyone, count what everyone has at the end, and tap Calculate & settle: Loopin works out who came out ahead, who came out behind and the fewest payments to square up. Loopin keeps the score of games you play together. No betting happens in the app.",
      },
      { q: "Does Loopin hold the money or run the game?", a: "Neither. It only keeps the score, like a notebook at the table, and it never holds or moves money. You pay each other however you usually do." },
      { q: "The money doesn’t add up. What now?", a: "Loopin won’t finish the game until every rupee that went in has come back. Check the amounts, or the host can fix the difference with a reason everyone can see." },
      { q: "Do all the players need Loopin?", a: "No. Anyone else can just be a name, and they can join with the group’s link later and take over their name." },
    ],
  },
  {
    title: "Memories: stories, postcards and passport",
    items: [
      {
        q: "What are the little circles on Home?",
        a: "Stories from your groups: a trip countdown, today’s spend while you’re away, a game night result, a group that just got all square. Tap the right side for the next slide, and swipe down or press Back to close. A gold ring means you haven’t seen it yet.",
      },
      { q: "What is Wrapped?", a: "A trip told as a few posters: the total you spent together, where the money went, the biggest day and everyone’s title. Open it from a group’s Charts, and share it as a picture." },
      {
        q: "What is the trip passport?",
        a: "A card for every trip with its stamp on the place’s photo, and your countries, trips and days away on top. You can add countries you visited before Loopin with Add a visited place, share your passport to WhatsApp as a picture, and open the old passport book from a link at the bottom.",
      },
      {
        q: "Who can see my passport?",
        a: "Nobody, until you say yes. Loopin asks once whether to show your places to people in your groups, and you can keep it private (Only me) any time. Friends see stamps and countries only, never your money, groups or email, and trips still happening stay hidden until they’re over.",
      },
      { q: "How do postcards work?", a: "Pick a trip photo, write a few words and send it in Loopin to anyone you share a group with, or on WhatsApp to anyone. You can seal it until a day you choose, and every stamp you send or get is kept in your stamp album." },
      { q: "Who can see our moments?", a: "Only the people in that trip group. Someone who left sees the moments added before they left, and someone the group’s admin removed sees none. Block a person and you stop seeing their moments. Loopin looks at a moment only if someone reports it." },
      { q: "How do I remove a moment?", a: "Open it, tap the three dots, and choose Delete if you added it. Whoever looks after the group can remove any moment. The photo is erased for everyone and can’t be brought back. To report one, use the same menu." },
      { q: "Reactions, titles and the spinning wheel?", a: "Open any expense to react with an emoji. Once a group has a few expenses, everyone gets a title on Balances, for habits and never for who paid less. On Add expense, Spin for it lets the wheel decide who pays tonight." },
    ],
  },
  {
    title: "Your data and privacy",
    items: [
      {
        q: "How do you handle my data?",
        a: (
          <>
            We keep only what the app needs: your email and name, your groups and their expenses, and a small sign-in cookie. No ads and no tracking. We don’t sell your data or use it for ads. We share only what’s needed with the services that run Loopin. We never ask for bank or card details.{" "}
            <Link href="/privacy" className={link}>
              Full privacy details
            </Link>
          </>
        ),
      },
      { q: "Who can see my group?", a: "Only the people in it. Anyone else opening its address sees “Private group”, with no names or amounts." },
      {
        q: "Can I download my data?",
        a: "Yes. You → Download all my data gives you one spreadsheet with your account details, your groups, expenses and payments, postcards, passport, the moments you added, collections, notification settings and messages to support. Each group’s settings also has Download spreadsheet for just that group.",
      },
      {
        q: "How do I delete a group, or my account?",
        a: "A group can be deleted from its settings; whoever deleted it or looks after it can restore it from Your groups → Recently deleted for 30 days, and after that it’s erased for good. To remove your account, go to You → Delete my email & sign-in. Your name stays in shared groups’ history, because those are other people’s records too.",
      },
      { q: "Does Loopin upload my contacts?", a: "No. When you pick someone from your contacts, only that person’s name and number are saved to the group. Loopin never uploads your address book." },
      {
        q: "How do I report or block someone?",
        a: "On a postcard you got, a friend’s passport, a moment, or a person in People, tap Report or Block. Blocking stops their postcards, passport and nudges reaching you, and hides yours from them. You’ll both still see shared group expenses and balances, because the money has to add up. Unblock from You → Privacy and safety.",
      },
      {
        q: "How do I contact support?",
        a: (
          <>
            Open <strong>You → Privacy and safety → Contact support</strong>, or go straight to the{" "}
            <a href={supportHref()} className={link}>
              support page
            </a>
            . We look at reports within 24 hours.
          </>
        ),
      },
    ],
  },
  {
    title: "Account and sign-in",
    items: [
      {
        q: "How do I sign in without a password?",
        a: "Continue with Google, or use your email and we send a 6-digit code. Once you’ve turned it on in You, your fingerprint or face works with one touch.",
      },
      { q: "What does fingerprint or face sign-in share with Loopin?", a: "Nothing about your fingerprint or face. Your phone checks it’s you and gives Loopin a key that proves it. You can remove it any time from the You page." },
      {
        q: "Can I choose which notifications and emails I get?",
        a: "Yes. Open You, then Notifications & email, and switch each kind on or off; every change saves at once. A group can also be muted in its own settings. Sign-in codes and security emails are always sent.",
      },
      {
        q: "Can I bring my groups over from another app?",
        a: (
          <>
            Yes. Export the group as a spreadsheet (CSV) from the other app, then tap <strong>Bring a group over</strong> and pick the file. Loopin brings in the expenses and payments it can read and shows them for you to check before saving. The other app keeps its copy.{" "}
            <Link href="/import" className={link}>
              Bring a group over
            </Link>
          </>
        ),
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
      {sections().map((s) => (
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
