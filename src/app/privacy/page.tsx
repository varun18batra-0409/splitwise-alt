import { PageHeader } from "@/components/ui";

export const metadata = { title: "Privacy", description: "What Loopin keeps, what it never does, and how to download or delete your data.", alternates: { canonical: "/privacy" } };

// Fill these in before launch. While any contact detail still holds a {{...}} placeholder,
// the contact block stays hidden, so no placeholder can ever show on the live site.
const OPERATOR = {
  OPERATOR_NAME: "{{OPERATOR_NAME}}",
  POSTAL_ADDRESS: "{{POSTAL_ADDRESS}}",
  PRIVACY_EMAIL: "{{PRIVACY_EMAIL}}",
  COURTS_CITY: "{{COURTS_CITY}}",
  MIN_AGE: "{{MIN_AGE}}",
};
const filled = (v: string) => v.trim() !== "" && !v.includes("{{");
const contactReady = filled(OPERATOR.OPERATOR_NAME) && filled(OPERATOR.POSTAL_ADDRESS) && filled(OPERATOR.PRIVACY_EMAIL);
const minAge = filled(OPERATOR.MIN_AGE) ? OPERATOR.MIN_AGE : "18";

// Plain-English privacy page. Keep it honest and short.
export default function Privacy() {
  const h = "mt-8 mb-2 font-display text-lg font-semibold tracking-tight";
  const p = "text-gray-600";
  const ul = `list-disc space-y-1 pl-5 ${p}`;
  return (
    <>
      <PageHeader title="Privacy" back="/" />
      <p className={p}>Loopin keeps track of shared expenses. It never holds or moves money. Here is what we keep and why.</p>

      {contactReady && (
        <>
          <h2 className={h}>Who runs Loopin</h2>
          <p className={p}>
            Loopin is run by {OPERATOR.OPERATOR_NAME}, {OPERATOR.POSTAL_ADDRESS}. For anything about your data, write to{" "}
            <a href={`mailto:${OPERATOR.PRIVACY_EMAIL}`} className="underline underline-offset-4">
              {OPERATOR.PRIVACY_EMAIL}
            </a>
            .
          </p>
        </>
      )}

      <h2 className={h}>What we store</h2>
      <ul className={ul}>
        <li>Group names, people’s names (as typed in the group), expenses, notes, payments and the change history.</li>
        <li>
          Contacts: when you pick a person from your phone’s contacts, their name and phone number (just the one you picked) are saved to the group. Loopin never uploads your address book.
        </li>
        <li>A group’s own photo, if someone in the group adds one. It’s made small on the phone first, and only people in that group can see it.</li>
        <li>A photo of a bill, if someone adds one to an expense. Camera details and location are removed, and only people in that group can see it.</li>
        <li>Your email and name, from signing up (or from Google, if you use Continue with Google). We use the email to sign you in and to tell you about your groups. Nothing else.</li>
        <li>If you turn on fingerprint / face sign-in, a key your phone made for Loopin. Your fingerprint or face never leaves your phone.</li>
        <li>A small cookie on your phone that remembers which person you are in each group.</li>
        <li>If you switch on notifications, a browser address to send them to.</li>
        <li>Your time zone, sent by your phone, so reminders arrive in the daytime where you are.</li>
        <li>Your Trip passport details: the home country you pick and any places you add by hand. Its trips come from your trip groups.</li>
        <li>Postcards you send or get: the card, your message and, if you add one, your own photo.</li>
        <li>Your answer to “Let AI read bills and lines”, on your account (or on your phone, if you have no account).</li>
        <li>Messages you send to support: the message and any reply email you leave.</li>
        <li>Blocks you make, and reports you send about something another person sent you (what, why and your note).</li>
      </ul>

      <h2 className={h}>What we don’t do</h2>
      <ul className={ul}>
        <li>No ads, and we don’t sell or share your data.</li>
        <li>No tracking cookies. Usage counts are worked out from the app’s own data, not from tracking you.</li>
        <li>We never ask for bank or card details.</li>
      </ul>

      <h2 className={h}>Who can see what</h2>
      <ul className={ul}>
        <li>
          <strong>A group:</strong> only the people in it. Anyone with its invite link or QR code can ask to join after signing up, so share it only with
          the people who should be in it.
        </li>
        <li>
          <strong>Your Trip passport:</strong> hidden until you say yes. Loopin asks you once, the first time you open your passport. If you choose Show, anyone who is or was in a group with you can open it (not someone removed from a group).
          They see the countries and cities you’ve been to and when. They never see money, your groups or your email. You can change your mind any time:
          Passport → Who can see it.
        </li>
        <li>
          <strong>Postcards:</strong> only the person who sent a card and the people it was sent to. That includes the photo on it. Cards go only to
          people you share a group with.
        </li>
        <li>
          <strong>“I’ve paid” links:</strong> a link in a reminder opens without signing in. Whoever has it sees the group’s name, the two people’s
          names and the amount owed, and can tap “I’ve paid”. It works for that one debt only, and stops after 30 days, once it’s settled, or if the group is closed. Send it only to the person who owes.
        </li>
        <li>
          <strong>If you leave a group:</strong> you still see it as it was up to the day you left, plus any later change to your own share. Older expenses
          show as they are now, but if someone changes one after you left, its notes are hidden from you.
        </li>
      </ul>

      <h2 className={h}>Reporting and blocking</h2>
      <ul className={ul}>
        <li>On a postcard you got, on a friend’s passport, or on a person in a group’s People screen, you can <strong>Report</strong> it (spam, abusive or something else, with an optional note). Only Loopin sees a report, and we look at it within 24 hours.</li>
        <li><strong>Block</strong> stops their postcards, passport and nudges reaching you, hides yours from them, and stops notifications about their activity. You’ll still both see shared group expenses, because the money has to add up. You can unblock from You → Privacy and safety.</li>
      </ul>

      <h2 className={h}>Emails and notifications</h2>
      <ul className={ul}>
        <li>We email you sign-in codes you ask for, and invites or “you were added” notes when someone adds your email to a group.</li>
        <li>Every invite email has a link to stop these emails. Sign-in codes still arrive, because you ask for them.</li>
        <li>Phone notifications are off until you switch them on. You can switch them off in the app or in your phone’s settings.</li>
      </ul>

      <h2 className={h}>Other services that help us</h2>
      <p className={p}>We use these, and send each only what it needs:</p>
      <ul className={`mt-2 ${ul}`}>
        <li><strong>Vercel:</strong> runs the app (our servers are in Mumbai) and keeps your photos in its private file storage.</li>
        <li><strong>Turso:</strong> keeps the database: your groups, expenses, accounts and the rest.</li>
        <li><strong>Resend:</strong> sends our emails. It gets the address, and the words of the email (sign-in codes, invites).</li>
        <li><strong>Anthropic (Claude):</strong> reads a bill photo you scan, or a typed or spoken expense Loopin can’t follow on its own, but only after you say yes. Loopin asks you the first time. It gets that photo or line, and the first names in the group. Anthropic doesn’t use it to train its models. Say no, or change your mind any time, in You → Privacy and safety; then bill photos are only attached and lines stay as you typed them.</li>
        <li><strong>Google:</strong> if you choose Continue with Google, it tells us your email and name. Speaking an expense uses your browser’s own voice typing (Google’s in Chrome, Apple’s in Safari); Loopin only receives the words. Postcard lettering is loaded by your browser from Google Fonts.</li>
        <li><strong>Frankfurter:</strong> gives us currency exchange rates. It is only asked for rates, never about you.</li>
      </ul>
      <p className={`mt-2 ${p}`}>Some of these services are run from outside India, so your data can leave India when they’re used.</p>

      <h2 className={h}>Error records and speed numbers</h2>
      <ul className={ul}>
        <li>When something goes wrong, we keep a short error record: which screen, the error message and a reference code. We keep it 30 days.</li>
        <li>To keep Loopin fast, we keep speed numbers: which kind of screen and how many milliseconds it took. We keep them 14 days.</li>
      </ul>

      <h2 className={h}>Deleting things</h2>
      <ul className={ul}>
        <li>Expenses and payments can be deleted and restored; the history notes it.</li>
        <li>A whole group can be deleted from its settings. Whoever deleted it, or looks after it, can restore it for 30 days; after that it’s erased for good, with everything in it.</li>
        <li>
          “You → Delete my email &amp; sign-in” erases your email and sign-in, your passkeys, the postcards you sent or got (including their photos), your alerts, the collections you organised, your messages to support, and the blocks you made or that were made against you.
        </li>
        <li>Deleting your email also stops notifications on your other phones.</li>
        <li>
          What stays in shared groups: your name in their history, an invitation that holds your email, and a phone number someone else saved for you. They are other people’s shared records, so deleting your account doesn’t rewrite them.
        </li>
        <li>Reports stay with us so we can act on them: the ones you made, and reports made about you, including the reporter’s note, are kept even after you delete your account.</li>
        <li>“You → Download all my data” gives you your account details, your groups, expenses and payments, and your messages to support, in one spreadsheet. Reports you sent and reports about you are not in it.</li>
        <li>Encrypted backups are kept for 14 days and then removed. Something you delete can stay in a backup until then.</li>
      </ul>

      <h2 className={h}>Your rights</h2>
      <p className={p}>
        Under India’s Digital Personal Data Protection Act, 2023, you can see the data we hold about you, correct it, have it erased, and complain if
        something is wrong. The quickest way is in the app: “You → Download all my data” to see it, edit things in the app to correct them, and “You → Delete my
        email &amp; sign-in” to erase it.
        {contactReady ? (
          <>
            {" "}
            For anything else, or a complaint, write to{" "}
            <a href={`mailto:${OPERATOR.PRIVACY_EMAIL}`} className="underline underline-offset-4">
              {OPERATOR.PRIVACY_EMAIL}
            </a>
            . Postal address: {OPERATOR.POSTAL_ADDRESS}.
          </>
        ) : null}
      </p>
      <p className={`mt-2 ${p}`}>Loopin is for people aged {minAge} and over.</p>

      <h2 className={h}>Where it’s kept</h2>
      <p className={p}>
        The app runs on Vercel, in Mumbai, and the data is stored with Turso. Encrypted backups are kept for 14 days in case something goes wrong.
      </p>

      <h2 className={h}>Questions</h2>
      <p className={p}>
        Need help, or want to tell us something? <a href="/support" className="underline underline-offset-4">Contact support</a>. See the <a href="/faq" className="underline underline-offset-4">FAQ</a> and the{" "}
        <a href="/terms" className="underline underline-offset-4">
          Terms of use
        </a>
        , or ask the person who shared Loopin with you.
      </p>
      <p className="mt-10 text-xs text-gray-400">Last updated November 2026.</p>
    </>
  );
}
