"use client";

import { useEffect, useState } from "react";
import Link from "@/components/Link";
import { phoneOnlyText } from "@/lib/phone-only";

// Home's one sign-in banner: "These groups are saved on this phone. Sign in...". The "×" hides it on this phone (remembered, and if the
// phone won't remember, it simply comes back next time). Hidden until the saved choice is read, so it never flashes.
export const SIGNIN_BANNER_KEY = "loopin-signin-banner-hidden";

export function SignInBanner({ className = "" }: { className?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(localStorage.getItem(SIGNIN_BANNER_KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  const t = phoneOnlyText(true);
  return (
    <div className={`flex items-start gap-1 rounded-[20px] border border-line bg-white py-1 pl-4 pr-1 ${className}`} data-phone-only role="note">
      <p className="min-w-0 flex-1 py-2 text-sm leading-snug text-fg/70">
        {t.before}
        <Link href="/signin" className="font-semibold text-fg underline underline-offset-4">
          {t.link}
        </Link>
        {t.after}
      </p>
      <button
        type="button"
        aria-label="Hide this note"
        onClick={() => {
          setShow(false);
          try {
            localStorage.setItem(SIGNIN_BANNER_KEY, "1");
          } catch {
            /* the phone won't remember; it will show again next time */
          }
        }}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl leading-none text-fg/60 active:bg-mist"
      >
        ×
      </button>
    </div>
  );
}
