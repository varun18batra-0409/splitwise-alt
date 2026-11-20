"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cancelGuestMove, confirmGuestMove, moveGuestGroups } from "@/app/actions";
import { GroupCover } from "@/components/GroupCover";
import type { CoverChoice } from "@/lib/covers";
import { Sheet } from "@/components/Sheet";

// "These groups will move to this account": the check before signing in on a phone that holds guest groups, for every
// way in (Google, fingerprint or face, a typed code, the email link). Cancel closes the sheet and nothing else happens:
// no sign-in, nothing moved. "Move them and continue" hands the listed groups on (their ids) and carries on.
export type GuestGroupRow = { memberId: string; groupId: string; name: string; people: number; cover: { kind: string; src?: string }; letter: string };

// The rows of groups that will move (the same markup is used by the sign-in sheet).
export function GuestGroupList({ groups }: { groups: GuestGroupRow[] }) {
  return (
    <ul className="mt-4 divide-y divide-line rounded-2xl border border-line" data-guest-list>
      {groups.map((g) => (
        <li key={g.memberId} className="flex items-center gap-3 px-3.5 py-3">
          <span className="relative block h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-mist">
            <GroupCover kind={g.cover.kind as CoverChoice} src={g.cover.src} uid={`gs-${g.memberId}`} letter={g.letter} small sizes="48px" />
          </span>
          <span className="min-w-0">
            <b className="block break-words font-display text-[17px] font-semibold leading-snug">{g.name}</b>
            <span className="block text-sm text-fg/65">{g.people === 1 ? "1 person" : `${g.people} people`}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function MoveSheet({ groups, onMove, onCancel, busy, error, signedIn }: { groups: GuestGroupRow[]; onMove: () => void; onCancel: () => void; busy: boolean; error: string; signedIn: boolean }) {
  return (
    <Sheet
      titleId="guest-sheet-title"
      title={signedIn ? "Move these groups to your account?" : "These groups will move to this account"}
      onClose={onCancel}
      guestMarker
      footer={
        <>
          <button type="button" onClick={onMove} disabled={busy} className="pop block min-h-12 w-full bg-fg px-5 py-3.5 text-center text-base font-semibold text-canvas disabled:opacity-60" data-guest-move>
            {busy ? "One moment…" : signedIn ? "Move them" : "Move them and continue"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="block min-h-12 w-full rounded-full border border-fg/25 bg-transparent px-5 py-3 text-center text-base font-semibold text-fg active:bg-fg/10"
            data-guest-cancel
          >
            Cancel
          </button>
        </>
      }
    >
      <p className="mt-2 text-[15px] leading-snug text-fg/65">{signedIn ? "This device holds these groups only as a guest. If you carry on, they join your account." : "This device already holds these groups as a guest. If you carry on, they join the account you sign in with."}</p>
      <GuestGroupList groups={groups} />
      <p className="mt-3 text-sm leading-snug text-fg/65">Not your groups? Tap Cancel and hand the device back.</p>
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert" data-guest-error>
          {error}
        </p>
      )}
    </Sheet>
  );
}

// Ask first when the phone holds guest groups. `then` runs only after "Move them and continue" (with the listed ids), or at once when
// there is nothing to ask about (then it gets an empty list: nothing to move). If `then` fails (throws or rejects), the sheet STAYS
// open with "Something went wrong. Try again." and nothing carries on. `signedIn`: the "only on this device" notice (already signed in).
export function useGuestCheck(groups: GuestGroupRow[], opts: { signedIn?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = useRef<{ then: (ids: string[]) => void | Promise<void>; onCancel?: () => void } | null>(null);
  const ids = groups.map((g) => g.memberId);
  function ask(then: (ids: string[]) => void | Promise<void>, o: { onCancel?: () => void } = {}) {
    if (!groups.length) return void then([]);
    next.current = { then, onCancel: o.onCancel };
    setError("");
    setOpen(true);
  }
  const cancel = () => {
    next.current?.onCancel?.(); // Cancel: nothing happens (a Google note, if one was left, is thrown away)
    next.current = null;
    setError("");
    setOpen(false);
  };
  const move = async () => {
    const f = next.current;
    if (!f || busy) return;
    setBusy(true);
    setError("");
    try {
      await f.then(ids);
      next.current = null;
      setOpen(false);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const sheet = open ? <MoveSheet groups={groups} onMove={move} onCancel={cancel} busy={busy} error={error} signedIn={Boolean(opts.signedIn)} /> : null;
  return { ask, sheet };
}

// "Continue with Google": the check shows before the phone leaves for Google's page. Without scripts the plain link still
// works, and then nothing is moved (no confirmation was given).
export function GoogleSignInLink({ href, groups, className, children }: { href: string; groups: GuestGroupRow[]; className: string; children: ReactNode }) {
  const { ask, sheet } = useGuestCheck(groups);
  return (
    <>
      <a
        href={href}
        className={className}
        onClick={(e) => {
          if (!groups.length) return;
          e.preventDefault();
          ask(
            async (ids) => {
              // If the note can't be left, do NOT carry on to Google: the groups would be left behind.
              const r = await confirmGuestMove(ids);
              if (!r?.ok) throw new Error("not saved");
              window.location.assign(href);
            },
            { onCancel: () => void cancelGuestMove().catch(() => undefined) },
          );
        }}
      >
        {children}
      </a>
      {sheet}
    </>
  );
}

// Next.js ends a server action that redirects by throwing a special error; that is a success, not a failure.
function isRedirect(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

// The typed-code form: the check shows when "Sign in" is pressed; the confirmed ids travel in the form's "move" field.
export function GuardedCodeForm({ action, groups, className, children }: { action: (fd: FormData) => void | Promise<void>; groups: GuestGroupRow[]; className?: string; children: ReactNode }) {
  const { ask, sheet } = useGuestCheck(groups);
  const form = useRef<HTMLFormElement>(null);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (!groups.length) return; // nothing on this phone to move: the form's own action runs as usual
    e.preventDefault();
    // Read what was typed now (the code), then, once the person confirms, send it with the confirmed groups straight to the
    // server action. (A second, script-made submit of the same form did not reliably reach the action.)
    const typed = form.current ? new FormData(form.current) : null;
    // The callback waits for the action, so the sheet shows "One moment…" meanwhile and "Something went wrong. Try again." if it fails.
    // A redirect (the normal way the action ends) is not a failure.
    ask(async (ids) => {
      if (!typed) return;
      typed.set("move", ids.join(","));
      try {
        await action(typed);
      } catch (err) {
        if (isRedirect(err)) return;
        throw err;
      }
    });
  }
  return (
    <>
      <form ref={form} action={action} onSubmit={onSubmit} className={className}>
        <input type="hidden" name="move" defaultValue="" />
        {children}
      </form>
      {sheet}
    </>
  );
}

// Already signed in, but guest groups are still only on this device (the check was skipped, or they came later): opens the same
// sheet; "Move them" links exactly the listed groups to the account.
export function GuestMoveButton({ groups, className, children }: { groups: GuestGroupRow[]; className: string; children: ReactNode }) {
  const router = useRouter();
  const { ask, sheet } = useGuestCheck(groups, { signedIn: true });
  return (
    <>
      <button
        type="button"
        className={className}
        data-guest-open
        onClick={() =>
          ask(async (ids) => {
            const r = await moveGuestGroups(ids);
            if (!r?.ok) throw new Error("not moved");
            router.refresh();
          })
        }
      >
        {children}
      </button>
      {sheet}
    </>
  );
}

// The quiet line on Home: "{N} groups are only on this device. Move them to your account?"
export function GuestMoveNotice({ groups }: { groups: GuestGroupRow[] }) {
  if (!groups.length) return null;
  const n = groups.length;
  return (
    <section aria-label="Groups only on this device" className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl border border-line px-4 py-2" data-guest-notice>
      <p className="min-w-0 flex-1 basis-48 text-sm leading-snug text-fg/75">
        {n === 1 ? "1 group is" : `${n} groups are`} only on this device. Move {n === 1 ? "it" : "them"} to your account?
      </p>
      <GuestMoveButton groups={groups} className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-fg underline underline-offset-4">
        Review
      </GuestMoveButton>
    </section>
  );
}
