"use client";

import { useRef } from "react";
import { hasOfflineData, openStore } from "@/lib/offline/idb";
import { allDraftsCount, applyMe } from "@/lib/offline/store";
import { WIPE_FLAG, W } from "@/lib/offline/words";

// A submit button that asks "Are you sure?" first. Used for delete actions.
// `wipesOffline` (Sign out, Delete account): if this phone keeps anything for add-expenses-offline (even if that feature has since been
// switched off), the question says so first when expenses are still waiting, and the phone's offline data is removed AFTER the server has
// signed the person out / deleted the account (the next page does it: src/lib/offline/signout.ts). Until then it is hidden. Nothing is wiped before that, so a failed sign-out
// loses nothing. With nothing stored this behaves exactly like any other confirm button.
export function ConfirmButton({ message, children, className, wipesOffline = false, deletes = false }: { message: string; children: React.ReactNode; className?: string; wipesOffline?: boolean; deletes?: boolean }) {
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
            // About 1.5 seconds for the storage check, then carry on with the normal question (older iPhones can be slow to open storage).
            const check = (async () => {
              const has = await hasOfflineData();
              return { has, n: has ? await allDraftsCount(openStore()) : 0 }; // every waiting expense on the phone, shown or hidden
            })();
            const r = await Promise.race([check, new Promise<null>((done) => setTimeout(() => done(null), 1500))]);
            if (r) ({ has: stored, n: waiting } = r);
          } catch {
            /* nothing kept here */
          }
          if (!window.confirm(waiting ? `${message}\n\n${(deletes ? W.deleteWarn : W.signOutWarn)(waiting)}` : message)) return;
          // The note for the next page: "wipe this phone's offline data if the sign-out really happened".
          if (stored) {
            // First, out of sight from this moment (kept, hidden: a sign-out that fails loses nothing). Its own step, so that a browser that
            // refuses the note below still hides everything.
            try {
              await applyMe(openStore(), {});
            } catch {
              /* nothing to hide */
            }
            try {
              localStorage.setItem(WIPE_FLAG, String(Date.now()));
            } catch {
              /* the browser won't keep a note: the data stays hidden, never shown to the next person */
            }
          }
          if (!form) return;
          if (stored) {
            // Tells the sign-out / delete action to leave its short "finished" note for this phone.
            const mark = document.createElement("input");
            mark.type = "hidden";
            mark.name = "offline_wipe";
            mark.value = "1";
            form.appendChild(mark);
          }
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
