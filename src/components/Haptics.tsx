"use client";

import { useEffect } from "react";
import { buzz, isBuzz } from "@/lib/haptics";

// Any button or link marked data-haptic="tap|success|warn" gives a small buzz when tapped,
// so server-rendered screens get haptics without becoming client components.
export function Haptics() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-haptic]");
      if (!el || (el as HTMLButtonElement).disabled) return;
      const kind = el.getAttribute("data-haptic");
      buzz(isBuzz(kind) ? kind : "tap");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
