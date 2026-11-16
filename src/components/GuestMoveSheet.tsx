"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { confirmGuestMove } from "@/app/actions";
import { GroupCover } from "@/components/GroupCover";
import type { CoverChoice } from "@/lib/covers";
import { trapFocus } from "@/lib/focus-trap";

// "These groups will move to this account": the check before signing in on a phone that holds guest groups, for every
// way in (Google, fingerprint or face, a typed code, the email link). Cancel closes the sheet and nothing else happens:
// no sign-in, nothing moved. "Move them and continue" hands the listed groups on (their ids) and carries on.
export type GuestGroupRow = { memberId: string; groupId: string; name: string; people: number; cover: { kind: string; src?: string }; letter: string };

function Sheet({ groups, onMove, onCancel }: { groups: GuestGroupRow[]; onMove: () => void; onCancel: () => void }) {
  const box = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // onCancel only clears a ref and a flag, so the first copy is always right; keeping the focus trap from restarting on every render.
  useEffect(() => trapFocus(box.current, { onEscape: onCancel, start: heading.current }), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onCancel} data-guest-sheet>
      <section
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-sheet-title"
        onClick={(e) => e.stopPropagation()}
        className="sheet-enter flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-[28px] border border-b-0 border-line bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
      >
        <span aria-hidden className="mx-auto block h-1 w-10 shrink-0 rounded-full bg-fg/20" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <h2 id="guest-sheet-title" ref={heading} tabIndex={-1} className="mt-4 font-display text-[26px] font-semibold leading-tight tracking-tight outline-none">
            These groups will move to this account
          </h2>
          <p className="mt-2 text-[15px] leading-snug text-fg/65">This phone already holds these groups as a guest. If you carry on, they join the account you sign in with.</p>
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
          <p className="mt-3 text-sm leading-snug text-fg/65">Not your groups? Tap Cancel and hand the phone back.</p>
        </div>
        <div className="mt-4 space-y-2">
          <button type="button" onClick={onMove} className="pop block min-h-12 w-full bg-fg px-5 py-3.5 text-center text-base font-semibold text-canvas" data-guest-move>
            Move them and continue
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="block min-h-12 w-full rounded-full border border-fg/25 bg-transparent px-5 py-3 text-center text-base font-semibold text-fg active:bg-fg/10"
            data-guest-cancel
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

// Ask first when the phone holds guest groups. `then` runs only after "Move them and continue" (with the listed ids), or at
// once when there is nothing to ask about (then it gets an empty list: nothing to move).
export function useGuestCheck(groups: GuestGroupRow[]) {
  const [open, setOpen] = useState(false);
  const next = useRef<((ids: string[]) => void) | null>(null);
  const ids = groups.map((g) => g.memberId);
  function ask(then: (ids: string[]) => void) {
    if (!groups.length) return then([]);
    next.current = then;
    setOpen(true);
  }
  const cancel = () => {
    next.current = null; // Cancel: nothing happens
    setOpen(false);
  };
  const move = () => {
    const f = next.current;
    next.current = null;
    setOpen(false);
    f?.(ids);
  };
  const sheet = open ? <Sheet groups={groups} onMove={move} onCancel={cancel} /> : null;
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
          ask(async (ids) => {
            await confirmGuestMove(ids).catch(() => undefined);
            window.location.assign(href);
          });
        }}
      >
        {children}
      </a>
      {sheet}
    </>
  );
}

// The typed-code form: the check shows when "Sign in" is pressed; the confirmed ids travel in the form's "move" field.
export function GuardedCodeForm({ action, groups, className, children }: { action: (fd: FormData) => void | Promise<void>; groups: GuestGroupRow[]; className?: string; children: ReactNode }) {
  const { ask, sheet } = useGuestCheck(groups);
  const form = useRef<HTMLFormElement>(null);
  const move = useRef<HTMLInputElement>(null);
  const sure = useRef(false);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (!groups.length || sure.current) return;
    e.preventDefault();
    ask((ids) => {
      if (move.current) move.current.value = ids.join(",");
      sure.current = true;
      form.current?.requestSubmit();
    });
  }
  return (
    <>
      <form ref={form} action={action} onSubmit={onSubmit} className={className}>
        <input ref={move} type="hidden" name="move" defaultValue="" />
        {children}
      </form>
      {sheet}
    </>
  );
}
