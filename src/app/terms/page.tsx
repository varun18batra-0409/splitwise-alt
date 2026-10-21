import Link from "@/components/Link";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Terms of use · Loopin" };

// Plain-English terms of use. Keep it honest, short and in step with Privacy and the FAQ.
export default function Terms() {
  const h = "mt-8 mb-2 font-display text-lg font-semibold tracking-tight";
  const p = "text-gray-600";
  const ul = `list-disc space-y-1 pl-5 ${p}`;
  return (
    <>
      <PageHeader title="Terms of use" back="/" />
      <p className={p}>
        These are the rules for using Loopin. They’re written to be read. By using Loopin you agree to them, together with the{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy
        </Link>{" "}
        page.
      </p>

      <h2 className={h}>What Loopin is (and isn’t)</h2>
      <ul className={ul}>
        <li>Loopin helps groups keep track of shared costs: who paid, who owes whom, and how to settle up.</li>
        <li>It never holds, sends or receives money. It isn’t a bank, a wallet or a payment service. “Mark as paid” only records that a payment happened.</li>
        <li>Balances are a record of what people in the group entered. Settling up is between you and the people you owe or who owe you.</li>
        <li>Loopin never reads your bank, cards, emails or messages. Repeating bills are added only because someone in the group set them up.</li>
      </ul>

      <h2 className={h}>Your account</h2>
      <ul className={ul}>
        <li>You sign in with your email (a code we send you), Google, or your phone’s fingerprint or face. Keep access to your email and phone safe.</li>
        <li>One account per person, in your own name. Don’t sign in as someone else.</li>
        <li>If you’re under 18, use Loopin with a parent’s or guardian’s permission.</li>
      </ul>

      <h2 className={h}>Groups and what you add</h2>
      <ul className={ul}>
        <li>What you add (expenses, notes, names, photos) stays yours. You let Loopin store it and show it to the people in that group, which is how the app works.</li>
        <li>Everyone in a group can see its expenses and change them. Every change is kept in the history, and almost anything can be undone.</li>
        <li>Only add people who want to be in the group, and only add photos you have the right to share.</li>
        <li>Check amounts before you rely on them. Loopin does the maths carefully, but it can only work with what was entered, and exchange rates come from outside services.</li>
      </ul>

      <h2 className={h}>Please don’t</h2>
      <ul className={ul}>
        <li>Use Loopin for anything illegal, or to harass, cheat or spam anyone.</li>
        <li>Upload anything harmful, offensive, or that isn’t yours to share.</li>
        <li>Try to get into groups or accounts that aren’t yours, or to overload or break the app.</li>
      </ul>
      <p className={`mt-2 ${p}`}>We may pause or remove an account or group that breaks these rules.</p>

      <h2 className={h}>Price</h2>
      <p className={p}>
        Loopin is free to use right now, with no ads. We may add paid extras in the future. If we do, we’ll say so clearly in the app first, and
        nothing you’ve already saved will be held back.
      </p>

      <h2 className={h}>The service</h2>
      <ul className={ul}>
        <li>We work hard to keep Loopin running and your data safe, with daily encrypted backups. Even so, it’s provided as it is, and there may be times it’s unavailable.</li>
        <li>As far as the law allows, Loopin isn’t responsible for disagreements between people in a group, or for losses from relying on what was entered.</li>
        <li>We may change or improve features. Anything that changes these terms in a way that matters to you will be shown in the app.</li>
      </ul>

      <h2 className={h}>Leaving</h2>
      <p className={p}>
        You can stop using Loopin any time. “You → Download all my data” gives you a copy, and “You → Delete my email &amp; sign-in” removes your
        sign-in. Groups can be deleted from their settings; they’re erased for good after 30 days.
      </p>

      <h2 className={h}>The law</h2>
      <p className={p}>These terms are governed by the laws of India.</p>

      <h2 className={h}>Questions</h2>
      <p className={p}>
        See the{" "}
        <Link href="/faq" className="underline underline-offset-4">
          FAQ
        </Link>
        .
      </p>
      <p className="mt-10 text-xs text-gray-400">Last updated October 2026.</p>
    </>
  );
}
