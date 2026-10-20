import Link from "@/components/Link";
import { PageHeader, primaryButtonClass } from "@/components/ui";

export const metadata = { title: "Switching from Splitwise?" };

const POINTS: [string, string][] = [
  ["Free, no ads, no limits", "Add as many expenses as you like, every day. Nothing is held back for a paid plan."],
  ["Your groups come with you", "Bring a group over from Splitwise’s spreadsheet export: every expense, every payment, the same balances."],
  ["Made for trips abroad", "Spend in any currency. Loopin uses the day’s rate and can add your card’s foreign-transaction fee, so the totals match your bank."],
  ["Flats that run themselves", "Rent and bills add themselves each month, a shared shopping list turns into one Groceries expense, and moving in or out mid-month is handled."],
  ["Couples, your own split", "55/45 by income, or any split you choose, with a running “who’s ahead” and savings goals."],
  ["Fewest payments to settle", "Loopin works out the smallest number of payments, across all your groups at once if you like."],
  ["Nothing is lost", "Every change is in the history, and almost anything can be undone, including deleting a whole group (for 30 days)."],
];

// "Switching from Splitwise?": what's different, and how to bring groups over.
export default function Switching() {
  return (
    <>
      <PageHeader title="Switching from Splitwise?" back="/" />
      <h1 className="font-display text-[30px] font-semibold leading-tight tracking-tight">Bring your groups. Keep your balances.</h1>
      <p className="mt-2 text-[15px] text-gray-500">It takes about a minute per group, and your friends can join when they’re ready.</p>

      <ul className="mt-6 space-y-4">
        {POINTS.map(([title, text]) => (
          <li key={title} className="rounded-[18px] border border-line bg-white px-5 py-4">
            <p className="font-semibold">{title}</p>
            <p className="mt-1 text-sm text-gray-500">{text}</p>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 font-display text-[24px] font-semibold">How it works</h2>
      <ol className="mt-3 space-y-2 text-[15px] text-gray-600">
        <li>
          <b>1.</b> In Splitwise, open a group → gear → <b>Export as spreadsheet</b>.
        </li>
        <li>
          <b>2.</b> In Loopin, tap <b>Bring a group over</b> and pick that file. Check the balances, say which person is you.
        </li>
        <li>
          <b>3.</b> Everyone else comes across by name. Invite them by email from People and they take over their name, with all their history.
        </li>
      </ol>

      <Link href="/import" className={`mt-8 ${primaryButtonClass}`}>
        Bring a group over
      </Link>
      <p className="mt-4 text-center text-sm text-gray-500">
        <Link href="/how-it-works" className="underline">
          How Loopin works
        </Link>
      </p>
    </>
  );
}
