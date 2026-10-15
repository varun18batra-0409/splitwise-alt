import Link from "next/link";
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
  searchParams: Promise<{ e?: string; sent?: string; error?: string; back?: string }>;
}) {
  const sp = await searchParams;
  const back = sp.back && sp.back.startsWith("/") && !sp.back.startsWith("//") ? sp.back.slice(0, 200) : "/";
  if (await getAccount()) redirect("/account");
  const email = (sp.e ?? "").slice(0, 254);
  const sent = sp.sent === "1" && email;
  const error = sp.error?.slice(0, 200);

  return (
    <>
      <PageHeader title={sent ? "Check your email" : "Sign in"} back={back} />
      {error && <ErrorNote>{error}</ErrorNote>}

      {!sent ? (
        <>
          <p className="mb-6 text-gray-600">
            Optional. Save your groups to your email so you can get them back on a new phone, or in the installed app.
            No password — we email you a code.
          </p>
          {!mailConfigured() && (
            <p className="mb-6 rounded-xl bg-mist px-4 py-3 text-sm text-gray-500">Email sign-in isn’t switched on yet. Check back soon.</p>
          )}
          <form action={requestCode} className="space-y-4">
            <input type="hidden" name="back" value={back} />
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
