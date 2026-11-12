import Link from "@/components/Link";
import { phoneOnlyText } from "@/lib/phone-only";

// "This group is saved on this phone. Sign in to keep it..." for people who aren't signed in.
export function PhoneOnlyNote({ plural = false, back, className = "" }: { plural?: boolean; back?: string; className?: string }) {
  const t = phoneOnlyText(plural);
  return (
    <p className={`rounded-xl bg-mist px-4 py-3 text-sm leading-snug text-fg/70 ${className}`} data-phone-only role="note">
      {t.before}
      <Link href={back ? `/signin?${new URLSearchParams({ back })}` : "/signin"} className="font-semibold text-fg underline underline-offset-4">
        {t.link}
      </Link>
      {t.after}
    </p>
  );
}
