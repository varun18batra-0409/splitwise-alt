import { ErrorNote, PageHeader, inputClass, primaryButtonClass } from "@/components/ui";
import { contactSupportAction } from "@/app/safety-actions";
import { supportEmail } from "@/lib/support";

export const metadata = { title: "Contact support", robots: { index: false } };

// Where "Contact support" lands when no support email is set: a short message that goes to the person who runs Loopin.
export default async function SupportPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const sp = await searchParams;
  const email = supportEmail();
  return (
    <>
      <PageHeader title="Contact support" back="/account" />
      {email ? (
        <div className="rounded-[20px] border border-line px-5 py-6">
          <p className="font-display text-xl font-semibold">Write to us</p>
          <a href={`mailto:${email}`} className="mt-2 block break-all text-base underline underline-offset-4">
            {email}
          </a>
        </div>
      ) : sp.sent ? (
        <div className="rounded-[20px] border border-line px-5 py-6" role="status">
          <p className="font-display text-xl font-semibold">Thanks, we’ve got it.</p>
          <p className="mt-2 text-sm text-gray-500">We’ll write back if you left an email.</p>
        </div>
      ) : (
        <form action={contactSupportAction} className="space-y-4">
          {sp.error && <ErrorNote>{sp.error.slice(0, 160)}</ErrorNote>}
          <p className="text-sm text-gray-500">Something wrong, or a question? Tell us and we’ll look.</p>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-600">Your message</span>
            <textarea name="message" rows={5} required minLength={5} maxLength={1500} className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-600">Your email, so we can reply (optional)</span>
            <input name="reply" type="email" inputMode="email" maxLength={120} autoComplete="email" className={inputClass} />
          </label>
          <button type="submit" className={primaryButtonClass}>
            Send
          </button>
        </form>
      )}
    </>
  );
}
