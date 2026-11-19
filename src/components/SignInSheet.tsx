"use client";

import { useState, type ReactNode } from "react";
import Link from "@/components/Link";
import { confirmGuestMove, cancelGuestMove } from "@/app/actions";
import { GoogleG } from "@/components/GoogleG";
import { Sheet } from "@/components/Sheet";
import { GuestGroupList, type GuestGroupRow } from "@/components/GuestMoveSheet";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { signinWords } from "@/lib/guest-words";

// "Sign in to do this": shown when someone with no account taps something that needs one (their phone knows beforehand), and whenever
// the server refuses one (a note in the address, signed by Loopin). It lists the guest groups this phone holds, because signing in
// moves them into the account, then goes to Google (which asks first, as the sign-in check does) or to the email sign-in page.
// Cancel closes it and nothing else happens.
export type SignInContext = { groups: GuestGroupRow[]; google: boolean; back: string };

function SignInSheetBody({ signin, ctx, onClose }: { signin: string; ctx: SignInContext; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { title, body } = signinWords(signin);
  const googleHref = `/api/auth/google/start?${new URLSearchParams({ back: ctx.back })}`;
  async function viaGoogle() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      // If the note can't be left, do NOT carry on to Google: the groups would be left behind.
      const r = await confirmGuestMove(ctx.groups.map((g) => g.memberId));
      if (!r?.ok) throw new Error("not saved");
      window.location.assign(googleHref);
    } catch {
      setError("Something went wrong. Try again.");
      setBusy(false);
    }
  }
  function cancel() {
    if (ctx.groups.length) void cancelGuestMove().catch(() => undefined);
    onClose();
  }
  return (
    <Sheet
      titleId="signin-sheet-title"
      title={title}
      onClose={cancel}
      signinMarker
      footer={
        <>
          {ctx.google && (
            <button type="button" onClick={viaGoogle} disabled={busy} className={`${primaryButtonClass} flex min-h-12 items-center justify-center gap-3`} data-signin-google>
              <GoogleG />
              {busy ? "One moment…" : "Continue with Google"}
            </button>
          )}
          <Link href={`/signin?${new URLSearchParams({ back: ctx.back })}`} className={ctx.google ? secondaryButtonClass : primaryButtonClass} data-signin-email>
            Continue with email
          </Link>
          <button type="button" onClick={cancel} className={secondaryButtonClass} data-signin-cancel>
            Cancel
          </button>
        </>
      }
    >
      <p className="mt-2 text-[15px] leading-snug text-fg/65">{body}</p>
      {ctx.groups.length > 0 && (
        <>
          <p className="mt-4 text-[15px] leading-snug text-fg/65">This device already holds these groups as a guest. If you carry on, they join the account you sign in with.</p>
          <GuestGroupList groups={ctx.groups} />
        </>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

// Opens by itself, from the note a refusal left in the address (the page checked the signature). Closing takes the note out of the
// address so a refresh does not bring it back.
export function SignInNoteSheet({ signin, ctx }: { signin: string; ctx: SignInContext }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <SignInSheetBody
      signin={signin}
      ctx={ctx}
      onClose={() => {
        setOpen(false);
        const u = new URL(window.location.href);
        for (const p of ["error", "signin", "et", "es"]) u.searchParams.delete(p);
        window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
      }}
    />
  );
}

// A button that opens the sheet (instead of a link or form that needs an account).
export function SignInTrigger({ signin, ctx, className, children, marker }: { signin: string; ctx: SignInContext; className: string; children: ReactNode; marker?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} data-signin-open={marker ?? ""}>
        {children}
      </button>
      {open && <SignInSheetBody signin={signin} ctx={ctx} onClose={() => setOpen(false)} />}
    </>
  );
}
