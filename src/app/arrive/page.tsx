import Link from "@/components/Link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { confirmArrival } from "./actions";
import { PageHeader, primaryButtonClass } from "@/components/ui";
import { peekMovePass } from "@/lib/move";
import { SESSION_COOKIE } from "@/lib/session";
import { safePath } from "@/lib/paths";
import { maskEmail } from "@/lib/stats";

// Where the hand-over from the old address lands. It asks for one tap instead of
// signing in straight away, and only looks at the pass (never uses it up).
export const dynamic = "force-dynamic";

export default async function Arrive({ searchParams }: { searchParams: Promise<{ t?: string; to?: string; gone?: string }> }) {
  const { t = "", to = "/", gone } = await searchParams;
  const next = safePath(to);
  if ((await cookies()).get(SESSION_COOKIE)?.value) redirect(next);
  const pass = gone ? null : await peekMovePass(t);

  return (
    <>
      <PageHeader title="Welcome to the new address" back="/" />
      {pass ? (
        <>
          <p className="mb-3 text-gray-600">
            Continue to Loopin{pass.email ? <> as <span className="text-fg">{maskEmail(pass.email)}</span></> : pass.firstName ? <> as <span className="text-fg">{pass.firstName}</span></> : null}?
          </p>
          <p className="mb-6 text-sm text-gray-500">Only continue if you came here from your own Loopin on the old address.</p>
          <form action={confirmArrival}>
            <input type="hidden" name="t" value={t} />
            <input type="hidden" name="to" value={next} />
            <button type="submit" className={primaryButtonClass}>
              Yes, continue
            </button>
          </form>
        </>
      ) : (
        <p className="text-gray-600">
          This link has run out or was already used. <Link href="/signin" className="underline underline-offset-4">Sign in again</Link> and you’ll be back in a moment.
        </p>
      )}
    </>
  );
}
