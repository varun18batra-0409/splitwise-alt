"use client";

import { useEffect, useState } from "react";

// The one-time key a money form carries (the hidden "rid"). A phone's Back button
// can bring back a screen exactly as it was left, including a key that has already
// been used: tapping the button again would then be taken for a repeat and
// nothing would be saved. So the key is made fresh when the screen opens and again
// whenever the browser brings a saved copy of the screen back (pageshow, persisted).
// (The server checks the amount and people too, as a safety net.)

const makeKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 14)}-${Math.random().toString(36).slice(2, 14)}`);

// For forms that send the key from code (AddExpenseForm) or render their own input.
export function useRequestKey(): string {
  // Empty until the screen is up: the same on the server and in the browser, so nothing mismatches.
  const [key, setKey] = useState("");
  useEffect(() => {
    setKey(makeKey());
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setKey(makeKey());
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  return key;
}

// A hidden input with a fresh key: <FreshKey name="rid" />.
export function FreshKey({ name = "rid" }: { name?: string }) {
  const key = useRequestKey();
  return <input type="hidden" name={name} value={key} />;
}
