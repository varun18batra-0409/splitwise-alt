"use client";

import { useEffect } from "react";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui";

// Something went wrong while showing a screen or saving (a dropped connection,
// the server busy for a moment). Say so in plain words and offer a retry,
// instead of the browser's bare "Application error".
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("screen error", error?.digest ?? "", String(error?.message ?? "").slice(0, 200));
  }, [error]);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return (
    <section className="flex min-h-[60dvh] flex-col items-center justify-center text-center">
      <p className="font-display text-[26px] font-semibold leading-tight">{offline ? "You’re offline" : "That didn’t load"}</p>
      <p className="mt-2 max-w-[300px] text-sm text-gray-500">
        {offline
          ? "Loopin needs the internet. Check your connection, then try again."
          : "Probably a weak connection or a hiccup on our side. Nothing you saved is lost. Try again."}
      </p>
      <button type="button" onClick={() => reset()} className={`mt-6 ${primaryButtonClass} !w-auto px-8`}>
        Try again
      </button>
      {/* A full page load, so it works even if the app itself got stuck. */}
      <a href="/" className={`mt-3 ${secondaryButtonClass} !w-auto px-8`}>
        Go to Home
      </a>
    </section>
  );
}
