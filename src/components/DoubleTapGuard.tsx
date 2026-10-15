"use client";

import { useEffect } from "react";

// Stops a second tap from sending the same form twice (e.g. recording a
// payment twice on a slow connection). The form unlocks after a few seconds,
// or as soon as the page changes. The server double-checks money actions too.
export function DoubleTapGuard() {
  useEffect(() => {
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || form.dataset.allowRepeat === "1") return;
      if (form.dataset.busy === "1") {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      form.dataset.busy = "1";
      form.setAttribute("aria-busy", "true");
      window.setTimeout(() => {
        delete form.dataset.busy;
        form.removeAttribute("aria-busy");
      }, 4000);
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);
  return null;
}
