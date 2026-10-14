"use client";

import { useEffect, useState } from "react";
import { addMembers } from "@/app/actions";
import { MemberInputs } from "./MemberInputs";
import { ShareInvite } from "./ShareInvite";
import { primaryButtonClass } from "./ui";

// "Invite" button in the group header. Opens a sheet from the bottom with both
// ways to bring people in: share the link, or pick them from your phone's contacts.
export function InviteSheet({
  groupId,
  groupName,
  inviteCode,
  memberCount,
}: {
  groupId: string;
  groupName: string;
  inviteCode: string;
  memberCount: number;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white active:bg-accent-dark"
      >
        Invite
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Invite people">
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 bg-ink/40" />
          <div className="sheet-enter relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-white px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-gray-200" aria-hidden />
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold tracking-tight">Invite to {groupName}</h2>
              <button type="button" onClick={() => setOpen(false)} className="py-1 text-sm font-medium text-gray-500">
                Done
              </button>
            </div>

            <h3 className="mb-2 text-sm font-medium text-gray-600">Send the invite link</h3>
            <ShareInvite code={inviteCode} groupName={groupName} />

            <h3 className="mb-2 mt-8 text-sm font-medium text-gray-600">Or add people yourself</h3>
            <form action={addMembers} className="space-y-4">
              <input type="hidden" name="groupId" value={groupId} />
              <MemberInputs firstPlaceholderNumber={memberCount + 1} />
              <button type="submit" className={primaryButtonClass}>
                Add to group
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
