import { PageHeader } from "@/components/ui";

export const metadata = { title: "Privacy · Loopin" };

// Plain-English privacy page. Keep it honest and short.
export default function Privacy() {
  const h = "mt-8 mb-2 font-display text-lg font-semibold tracking-tight";
  const p = "text-gray-600";
  return (
    <>
      <PageHeader title="Privacy" back="/" />
      <p className={p}>Loopin keeps track of shared expenses. It never holds or moves money. Here is what we keep and why.</p>

      <h2 className={h}>What we store</h2>
      <ul className={`list-disc space-y-1 pl-5 ${p}`}>
        <li>Group names, people’s names (as typed in the group), expenses, notes, payments and the change history.</li>
        <li>Phone numbers only if someone adds them when inviting from contacts.</li>
        <li>Your email, only if you choose to sign in. We use it to send sign-in codes. Nothing else.</li>
        <li>A small cookie on your phone that remembers which person you are in each group.</li>
        <li>If you switch on notifications, a browser address to send them to.</li>
      </ul>

      <h2 className={h}>What we don’t do</h2>
      <ul className={`list-disc space-y-1 pl-5 ${p}`}>
        <li>No ads, and we don’t sell or share your data.</li>
        <li>No tracking cookies. Usage counts are worked out from the app’s own data, not from tracking you.</li>
        <li>We never ask for bank or card details.</li>
      </ul>

      <h2 className={h}>Who can see a group</h2>
      <p className={p}>Anyone with the group’s invite link or QR code can join it and see it. Only share it with the people in the group.</p>

      <h2 className={h}>Deleting things</h2>
      <ul className={`list-disc space-y-1 pl-5 ${p}`}>
        <li>Expenses and payments can be deleted and restored; the history notes it.</li>
        <li>A whole group can be deleted from its settings. Anyone in it can restore it for 30 days, then it’s erased for good.</li>
        <li>If you signed in, “You → Delete my email &amp; sign-in” removes your email from Loopin.</li>
      </ul>

      <h2 className={h}>Where it’s kept</h2>
      <p className={p}>
        The app runs on Vercel and the data is stored with Turso. Encrypted backups are kept for a short time in case something goes wrong.
      </p>

      <h2 className={h}>Questions</h2>
      <p className={p}>Ask the person who shared Loopin with you, or reply to any sign-in email.</p>
      <p className="mt-10 text-xs text-gray-400">Last updated October 2026.</p>
    </>
  );
}
