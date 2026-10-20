import Link from "@/components/Link";
import { safePath } from "@/lib/paths";
import { redirect } from "next/navigation";
import { requestCode, verifyCode } from "@/app/actions";
import { getAccount } from "@/lib/identity";
import { mailConfigured } from "@/lib/mail";
import { googleConfigured } from "@/lib/google";
import { PasskeySignIn } from "@/components/Passkeys";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass } from "@/components/ui";
import { GroupCover } from "@/components/GroupCover";
import { coverOf } from "@/lib/covers";

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
  const name = (sp.n ?? "").slice(0, 40);

  return (
    <>
      <PageHeader title={sent ? "Check your email" : "Continue to Loopin"} back={back} />
      {error && <ErrorNote>{error}</ErrorNote>}

      {!sent ? (
        <>
          <div className="relative mb-6 h-[150px] overflow-hidden rounded-[22px] border border-line" aria-hidden>
            <GroupCover kind={coverOf({ cover: "photo-friends", type: "other" })} uid="signin" sizes="(max-width: 448px) 100vw, 448px" priority drift />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(13,13,15,0)_40%,rgba(13,13,15,0.7)_100%)]" />
            <p className="absolute bottom-3 left-4 font-display text-[22px] font-semibold">Everyone’s in.</p>
          </div>
          <p className="mb-6 text-gray-600">
            New here or coming back, it’s the same: we’ll get your groups on this phone, and on any other. No password needed.
          </p>
          <PasskeySignIn back={back} className="mb-3 flex w-full items-center justify-center border border-line px-4 py-3.5 text-base font-semibold text-fg active:bg-mist" />
          {googleConfigured() && (
            <>
              {/* A plain link: it leaves the app for Google's account picker. */}
              <a href={`/api/auth/google/start?${new URLSearchParams({ back })}`} className="flex w-full items-center justify-center gap-3 border border-line bg-white px-4 py-3.5 text-base font-semibold text-fg active:bg-mist">
                <GoogleMark />
                Continue with Google
              </a>
              <div className="my-6 flex items-center gap-3 text-xs text-gray-400" aria-hidden>
                <span className="h-px flex-1 bg-line" />
                or with your email
                <span className="h-px flex-1 bg-line" />
              </div>
            </>
          )}
          {!mailConfigured() && (
            <p className="mb-6 rounded-xl bg-mist px-4 py-3 text-sm text-gray-500">Email sign-in isn’t switched on yet. Check back soon.</p>
          )}
          <form action={requestCode} className="space-y-4">
            <input type="hidden" name="back" value={back} />
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-600">
                Your name <span className="font-normal text-gray-400">(if you’re new)</span>
              </span>
              <input name="name" autoComplete="name" defaultValue={name} placeholder="e.g. Joey" maxLength={40} className={inputClass} />
            </label>
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

// Google's "G", for the Continue with Google button.
function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
