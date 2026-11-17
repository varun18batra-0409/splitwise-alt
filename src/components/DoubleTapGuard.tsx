"use client";

import { useEffect } from "react";

// Stops a second tap from sending the same form twice (e.g. recording a
// payment twice on a slow connection). The form unlocks after a few seconds,
// or as soon as the page changes. The server double-checks money actions too.
const timers = new WeakMap<HTMLFormElement, number>();

// A form that stops its own send (a missing field, a failed upload) calls this so the next tap is not swallowed,
// and tells the loading bar to go away. Does not rely on `defaultPrevented`, because form actions prevent the default themselves.
export function releaseSubmit(form: HTMLFormElement | null | undefined) {
  if (!form) return;
  const t = timers.get(form);
  if (t) window.clearTimeout(t);
  timers.delete(form);
  delete form.dataset.busy;
  form.removeAttribute("aria-busy");
  window.dispatchEvent(new CustomEvent("loopin:submit-cancelled"));
}

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
      timers.set(
        form,
        window.setTimeout(() => {
          delete form.dataset.busy;
          form.removeAttribute("aria-busy");
          timers.delete(form);
        }, 4000),
      );
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);
  return null;
}
