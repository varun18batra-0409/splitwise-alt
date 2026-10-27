import Link from "@/components/Link";
import { safePath } from "@/lib/paths";
import { redirect } from "next/navigation";
import { requestCode, verifyCode } from "@/app/actions";
import { getAccount } from "@/lib/identity";
import { mailConfigured } from "@/lib/mail";
import { googleConfigured } from "@/lib/google";
import { PasskeySignIn } from "@/components/Passkeys";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass } from "@/components/ui";
import { BackIcon, iconButtonClass } from "@/components/icons";
import { GoogleG } from "@/components/GoogleG";
import { placePhoto } from "@/lib/places";

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
      {sent ? (
        <PageHeader title="Check your email" back={back} />
      ) : (
        <>
          {/* Three trips, as polaroids tossed on the table: what Loopin is for, before a word is read. */}
          <div className="relative -mx-5 -mt-[max(1.5rem,env(safe-area-inset-top))] h-[420px] overflow-hidden pt-[max(1.2rem,env(safe-area-inset-top))]" aria-hidden>
            <span className="absolute left-1/2 top-24 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,171,107,0.13),transparent_62%)]" />
            <p className="relative text-center font-display text-[26px] font-semibold leading-none tracking-tight">loopin</p>
            {SNAPS.map((p) => (
              <span key={p.caption} className={`lp-drop absolute block bg-[#f4f2ec] p-2 pb-9 shadow-[0_24px_50px_-10px_rgba(0,0,0,0.7)] ${p.spot}`} style={{ animationDelay: p.delay }}>
                <span className="relative block h-full w-full overflow-hidden bg-[#222]">
                  {placePhoto(p.place)?.src && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={placePhoto(p.place)!.src} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  )}
                </span>
                <span className="absolute inset-x-0 bottom-1.5 text-center font-hand text-[21px] font-bold text-[#1d1b17]">{p.caption}</span>
              </span>
            ))}
          </div>
          {back !== "/" && (
            <Link href={back} aria-label="Back" className={`glass absolute left-5 top-[max(1.1rem,env(safe-area-inset-top))] ${iconButtonClass}`}>
              <BackIcon size={20} />
            </Link>
          )}
          <p className="-mt-6 font-display text-[clamp(38px,11.5vw,46px)] font-semibold leading-[1.02] tracking-[-0.02em]">
            Split the trip.
            <br />
            Keep the story.
          </p>
          <p className="mt-3 text-[16px] leading-relaxed text-fg/65">Add costs as you go, settle up with UPI in one tap, and get every trip back as stories and stamps.</p>
          <h1 className="mb-3 mt-7 text-[15px] font-semibold text-fg/80">Continue to Loopin</h1>
        </>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}

      {!sent ? (
        <>
          {googleConfigured() && (
            <>
              {/* A plain link: it leaves the app for Google's account picker. */}
              <a href={`/api/auth/google/start?${new URLSearchParams({ back })}`} className="pop mb-3 flex h-14 w-full items-center justify-center gap-3 bg-fg text-base font-semibold text-canvas">
                <GoogleG />
                Continue with Google
              </a>
            </>
          )}
          <PasskeySignIn back={back} className="mb-3 flex h-14 w-full items-center justify-center rounded-full border border-fg/15 bg-fg/[0.06] text-base font-semibold text-fg transition-transform active:scale-[0.97]" />
          <div className="my-6 flex items-center gap-3 text-xs text-gray-400" aria-hidden>
            <span className="h-px flex-1 bg-line" />
            or with your email
            <span className="h-px flex-1 bg-line" />
          </div>
          {!mailConfigured() && (
            <p className="mb-6 rounded-xl bg-mist px-4 py-3 text-sm text-gray-500">Email sign-in isn’t switched on yet. Check back soon.</p>
          )}
          <form action={requestCode} className="space-y-4">
            <input type="hidden" name="back" value={back} />
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-600">
                Your name <span className="font-normal text-gray-400">(if you’re new)</span>
              </span>
              <input name="name" autoComplete="name" defaultValue={name} placeholder="e.g. Maya" maxLength={40} className={inputClass} />
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
        By continuing you agree to the{" "}
        <Link href="/terms" className="underline underline-offset-4">
          Terms
        </Link>
        . We only use your email to sign you in:{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy
        </Link>
      </p>
    </>
  );
}

// The three polaroids on the sign-in screen (photos from the app's own place pictures).
const SNAPS = [
  { place: "Manali", caption: "Manali", spot: "left-[6%] top-[86px] h-[200px] w-[160px] -rotate-[9deg]", delay: "0ms" },
  { place: "Jaipur", caption: "Jaipur", spot: "right-[5%] top-[72px] h-[200px] w-[160px] rotate-[7deg]", delay: "120ms" },
  { place: "Goa", caption: "Goa, all square", spot: "left-[27%] top-[176px] z-[2] h-[220px] w-[176px] -rotate-[1.5deg]", delay: "240ms" },
];
