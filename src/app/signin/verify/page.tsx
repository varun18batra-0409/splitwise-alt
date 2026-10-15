import Link from "next/link";
import { verifyCode } from "@/app/actions";
import { PageHeader, primaryButtonClass } from "@/components/ui";

// Where the link in the sign-in email lands. It asks for one tap instead of
// signing in straight away, so email scanners that open links can't use up
// the code before you do.
export default async function VerifyLink({ searchParams }: { searchParams: Promise<{ e?: string; c?: string }> }) {
  const { e = "", c = "" } = await searchParams;
  const email = e.slice(0, 254);
  const code = c.replace(/\D/g, "").slice(0, 6);

  return (
    <>
      <PageHeader title="Sign in" back="/" />
      {email && code.length === 6 ? (
        <>
          <p className="mb-6 text-gray-600">
            Sign in as <span className="text-fg">{email}</span> on this phone?
          </p>
          <form action={verifyCode}>
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="code" value={code} />
            <input type="hidden" name="back" value="/" />
            <button type="submit" className={primaryButtonClass}>
              Yes, sign me in
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
