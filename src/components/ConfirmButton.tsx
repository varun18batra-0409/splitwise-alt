"use client";

import { useRef } from "react";
import { openStore, wipePhone } from "@/lib/offline/idb";
import { draftsFor } from "@/lib/offline/store";
import { W } from "@/lib/offline/words";

// A submit button that asks "Are you sure?" first. Used for delete actions.
// `wipesOffline` (Sign out, Delete account): everything add-expenses-offline keeps on this phone goes too, before the form is sent.
// If expenses are still waiting on the phone, the question says so first.
export function ConfirmButton({ message, children, className, wipesOffline = false }: { message: string; children: React.ReactNode; className?: string; wipesOffline?: boolean }) {
  const passed = useRef(false); // the second, real submit (after the wipe)
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (passed.current) return;
        if (!wipesOffline) {
          if (!window.confirm(message)) e.preventDefault();
          return;
        }
        e.preventDefault();
        const button = e.currentTarget;
        const form = button.form;
        void (async () => {
          let waiting = 0;
          try {
            waiting = typeof indexedDB === "undefined" ? 0 : (await draftsFor(openStore())).length;
          } catch {
            /* nothing kept here */
          }
          if (!window.confirm(waiting ? `${message}\n\n${W.signOutWarn(waiting)}` : message)) return;
          await wipePhone();
          passed.current = true;
          form?.requestSubmit(button);
        })();
      }}
    >
      {children}
    </button>
  );
}
