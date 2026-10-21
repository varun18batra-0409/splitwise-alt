"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// On a screen that isn't there any more (say, swiping back to a deleted
// group): quietly swap it for Home, so swiping back again keeps going.
export function GoHome({ after = 1200 }: { after?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.replace("/"), after);
    return () => clearTimeout(t);
  }, [router, after]);
  return null;
}
