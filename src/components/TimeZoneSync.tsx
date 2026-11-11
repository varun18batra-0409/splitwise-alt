"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const cookieValue = (name: string) => {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : "";
};

// Tells the server this phone's time zone, so "today" and dates are right
// wherever you are. Refreshes once if it changed (e.g. after landing abroad).
// Also tells it, quietly, so nudges arrive in the daytime where you are: only when the zone differs
// from the one last sent (the "tzs" cookie), and again after a week so new groups and sign-ins catch up.
export function TimeZoneSync() {
  const router = useRouter();
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      if (cookieValue("tzs") !== tz) {
        fetch("/api/tz", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tz }), keepalive: true })
          .then((r) => {
            if (r.ok) document.cookie = `tzs=${encodeURIComponent(tz)}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`;
          })
          .catch(() => undefined);
      }
      if (cookieValue("tz") === tz) return;
      document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      router.refresh();
    } catch {
      /* keep the default */
    }
  }, [router]);
  return null;
}
