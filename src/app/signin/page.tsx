import Link from "next/link";
import { safePath } from "@/lib/paths";
import { redirect } from "next/navigation";
import { requestCode, verifyCode } from "@/app/actions";
import { getAccount } from "@/lib/identity";
import { mailConfigured } from "@/lib/mail";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass } from "@/components/ui";

// Optional sign-in: type your email, get a 6-digit code, type it here.
// Your groups then follow you to a new phone or the installed app.
export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; sent?: string; error?: string; back?: string; mode?: string; n?: string }>;
}) {
  const sp = await searchParams;
  const back = safePath(sp.back);
  if (await getAccount()) redirect("/account");
  const email = (sp.e ?? "").slice(0, 254);
  const sent = sp.sent === "1" && email;
  const error = sp.error?.slice(0, 200);
  const signup = sp.mode === "signup";
  const name = (sp.n ?? "").slice(0, 40);

  return (
    <>
      <PageHeader title={sent ? "Check your email" : signup ? "Sign up" : "Sign in"} back={back} />
      {error && <ErrorNote>{error}</ErrorNote>}

      {!sent ? (
        <>
          <p className="mb-6 text-gray-600">
            {signup
              ? "Create your Loopin account with just your email. Your groups get saved to it, so you can open them on any phone or in the installed app."
              : "Welcome back. Enter the email you used before and we’ll send you a code. Your groups come back on this phone."}{" "}
            No password needed.
          </p>
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-mist p-1 text-sm">
            <Link href={`/signin?${new URLSearchParams({ mode: "signup", back, ...(email ? { e: email } : {}) })}`} className={`rounded-lg py-2 text-center ${signup ? "bg-fg font-semibold text-canvas" : "text-gray-500"}`}>
              Sign up
            </Link>
            <Link href={`/signin?${new URLSearchParams({ back, ...(email ? { e: email } : {}) })}`} className={`rounded-lg py-2 text-center ${!signup ? "bg-fg font-semibold text-canvas" : "text-gray-500"}`}>
              Sign in
            </Link>
          </div>
          {!mailConfigured() && (
            <p className="mb-6 rounded-xl bg-mist px-4 py-3 text-sm text-gray-500">Email sign-in isn’t switched on yet. Check back soon.</p>
          )}
          <form action={requestCode} className="space-y-4">
            <input type="hidden" name="back" value={back} />
            {signup && <input type="hidden" name="mode" value="signup" />}
            {signup && (
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-600">Your name</span>
                <input name="name" required autoComplete="name" defaultValue={name} placeholder="e.g. Joey" maxLength={40} className={inputClass} />
              </label>
            )}
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-600">Your email</span>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                defaultValue={email}
                placeholder="you@example.com"
                maxLength={254}
                className={inputClass}
              />
            </label>
            <button type="submit" className={primaryButtonClass}>
              Email me a code
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="mb-6 text-gray-600">
            We sent a 6-digit code to <span className="text-fg">{email}</span>. It works for 15 minutes. Not there? Check spam.
          </p>
          <form action={verifyCode} className="space-y-4">
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="email" value={email} />
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-600">Code</span>
              <input
                name="code"
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                placeholder="123456"
                className={`${inputClass} text-center font-display text-2xl tracking-[0.4em]`}
              />
            </label>
            <button type="submit" className={primaryButtonClass}>
              Sign in
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-gray-500">
            <Link href={`/signin?${new URLSearchParams({ e: email, back })}`} className="underline underline-offset-4">
              Use a different email or send a new code
            </Link>
          </p>
        </>
      )}

      <p className="mt-10 text-center text-xs text-gray-400">
        We only use your email to sign you in. <Link href="/privacy" className="underline underline-offset-4">Privacy</Link>
      </p>
    </>
  );
}
