import Link from "@/components/Link";

// Not signed in: one quiet 44px line under a group's ticket, no box. "Saved on this phone only" (55%) on the left, the way out on the
// right ("Sign in to keep it ›", off-white). The full sentence stays on Home (PhoneOnlyNote) and in the screen-reader text here.
export function PhoneOnlyLine({ back, className = "" }: { back?: string; className?: string }) {
  return (
    <div className={`flex min-h-11 items-center justify-between gap-3 px-1 text-[13.5px] ${className}`} data-phone-only role="note">
      <span className="text-fg/55">Saved on this phone</span>
      <Link
        href={back ? `/signin?${new URLSearchParams({ back })}` : "/signin"}
        className="flex min-h-11 shrink-0 items-center font-semibold text-fg active:opacity-70"
        aria-label="Sign in to keep it if you clear your browser or change phones"
      >
        Sign in to keep it <span aria-hidden className="ml-1">›</span>
      </Link>
    </div>
  );
}
