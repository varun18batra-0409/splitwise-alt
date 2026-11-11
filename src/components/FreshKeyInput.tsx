"use client";

import { useEffect, useState } from "react";

// The one-time key a money form carries (the hidden "rid"). A phone's Back button
// can bring back a screen exactly as it was left, including a key that has already
// been used: tapping the button again would then be taken for a repeat and
// nothing would be saved. So the key is made fresh when the screen opens and again
// whenever the browser brings a saved copy of the screen back (pageshow, persisted).
// The first value is a real key from the start (made by the server, or here before the first
// paint), so a form sent before the screen finishes loading still carries one.
// (The server checks the amount and people too, as a safety net.)

export const makeKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 14)}-${Math.random().toString(36).slice(2, 14)}`);

// For forms that send the key from code (AddExpenseForm) or render their own input.
// `initial`: a key the server already made for this screen (so the server's and the browser's first value agree).
export function useRequestKey(initial?: string): string {
  const [key, setKey] = useState(() => initial || makeKey());
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

// A hidden input with a key: <FreshKeyInput name="rid" initial={newRequestKey()} /> (see FreshKey.tsx).
export function FreshKeyInput({ name = "rid", initial }: { name?: string; initial?: string }) {
  const key = useRequestKey(initial);
  // Without a server-made first key the browser makes its own, which can differ from the server's page by one attribute.
  return <input type="hidden" name={name} value={key} suppressHydrationWarning />;
}
