"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Tells the server this phone's time zone, so "today" and dates are right
// wherever you are. Refreshes once if it changed (e.g. after landing abroad).
export function TimeZoneSync() {
  const router = useRouter();
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      const current = document.cookie.split("; ").find((c) => c.startsWith("tz="))?.slice(3);
      if (current && decodeURIComponent(current) === tz) return;
      document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      router.refresh();
    } catch {
      /* keep the default */
    }
  }, [router]);
  return null;
}
