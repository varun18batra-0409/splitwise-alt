"use client";

import { useRef } from "react";
import { hasOfflineData, openStore } from "@/lib/offline/idb";
import { draftsFor } from "@/lib/offline/store";
import { WIPE_FLAG, W } from "@/lib/offline/words";

// A submit button that asks "Are you sure?" first. Used for delete actions.
// `wipesOffline` (Sign out, Delete account): if this phone keeps anything for add-expenses-offline (even if that feature has since been
// switched off), the question says so first when expenses are still waiting, and the phone's offline data is removed AFTER the server has
// signed the person out / deleted the account (the next page does it: see OfflineSync). Nothing is wiped before that, so a failed sign-out
// loses nothing. With nothing stored this behaves exactly like any other confirm button.
export function ConfirmButton({ message, children, className, wipesOffline = false }: { message: string; children: React.ReactNode; className?: string; wipesOffline?: boolean }) {
  const passed = useRef(false); // the second submit, after the question was answered
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
          let stored = false;
          let waiting = 0;
          try {
            stored = await hasOfflineData();
            waiting = stored ? (await draftsFor(openStore())).length : 0;
          } catch {
            /* nothing kept here */
          }
          if (!window.confirm(waiting ? `${message}\n\n${W.signOutWarn(waiting)}` : message)) return;
          // The note for the next page: "wipe this phone's offline data if the sign-out really happened".
          if (stored) {
            try {
              localStorage.setItem(WIPE_FLAG, String(Date.now()));
            } catch {
              /* the browser won't keep a note: the data stays hidden, never shown to the next person */
            }
          }
          if (!form) return;
          passed.current = true;
          // Older iPhones have no requestSubmit: send the form the plain way (sign-out and delete need no button value).
          if (typeof form.requestSubmit === "function") form.requestSubmit(button);
          else form.submit();
          passed.current = false; // if the submit did not leave this page, the button works again
        })();
      }}
    >
      {children}
    </button>
  );
}
