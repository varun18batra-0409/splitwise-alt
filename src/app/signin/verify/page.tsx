import Link from "@/components/Link";
import { verifyCode } from "@/app/actions";
import { PageHeader, primaryButtonClass } from "@/components/ui";
import { safePath } from "@/lib/paths";
import { getAccount } from "@/lib/identity";

// Where the link in the sign-in email lands. It asks for one tap instead of
// signing in straight away, so email scanners that open links can't use up
// the code before you do.
export default async function VerifyLink({ searchParams }: { searchParams: Promise<{ e?: string; c?: string; b?: string }> }) {
  const { e = "", c = "", b = "" } = await searchParams;
  const back = safePath(b || "/");
  const email = e.slice(0, 254);
  const code = c.replace(/\D/g, "").slice(0, 6);
  // Someone could send you a link for *their* account. Say plainly whose
  // account this is, and if you're already signed in as someone else, that
  // this switches you.
  const now = await getAccount();
  const other = now && now.email && now.email.toLowerCase() !== email.toLowerCase() ? now.email : "";

  return (
    <>
      <PageHeader title="Sign in" back="/" />
      {email && code.length === 6 ? (
        <>
          <p className="mb-3 text-gray-600">
            {other ? (
              <>
                You’re signed in as <span className="text-fg">{other}</span>. Switch to <span className="text-fg">{email}</span> on this phone?
              </>
            ) : (
              <>
                Sign in as <span className="text-fg">{email}</span> on this phone?
              </>
            )}
          </p>
          <p className="mb-6 text-sm text-gray-500">Only continue if you asked for this code just now and this is your email.</p>
          <form action={verifyCode}>
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="code" value={code} />
            <input type="hidden" name="back" value={back} />
            <button type="submit" className={primaryButtonClass}>
              {other ? "Yes, switch" : "Yes, sign me in"}
            </button>
          </form>
          <p className="mt-6 text-sm text-gray-500">
            Using the installed app? Open it and type the code <span className="font-display tracking-widest text-fg">{code}</span> instead.
          </p>
        </>
      ) : (
        <p className="text-gray-600">
          This link isn’t complete. <Link href="/signin" className="underline underline-offset-4">Ask for a new code</Link>.
        </p>
      )}
    </>
  );
}
