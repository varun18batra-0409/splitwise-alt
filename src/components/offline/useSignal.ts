"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ping } from "@/lib/offline/client";

export type Signal = "checking" | "offline" | "online";

// Is there a signal? Never trusts navigator.onLine alone: it asks our own server (/api/ping). It asks again on `online`, `pageshow`,
// `focus` and when the app comes back to the front, and every few seconds while the answer is "offline" (an iPhone can keep saying
// "offline" after Airplane mode ends until something asks again). `check()` is the visible "Try again".
export function useSignal(everyMs = 4000): { signal: Signal; check: () => Promise<boolean>; checking: boolean } {
  const [signal, setSignal] = useState<Signal>("checking");
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);
  const check = useCallback(async () => {
    if (busy.current) return false;
    busy.current = true;
    setChecking(true);
    const ok = await ping();
    busy.current = false;
    setChecking(false);
    setSignal(ok ? "online" : "offline");
    return ok;
  }, []);
  useEffect(() => {
    void check();
    const again = () => void check();
    const visible = () => {
      if (document.visibilityState === "visible") again();
    };
    window.addEventListener("online", again);
    window.addEventListener("pageshow", again);
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", visible);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") again();
    }, everyMs);
    return () => {
      window.removeEventListener("online", again);
      window.removeEventListener("pageshow", again);
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", visible);
      clearInterval(t);
    };
  }, [check, everyMs]);
  return { signal, check, checking };
}
