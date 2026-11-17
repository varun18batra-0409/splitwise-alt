"use client";

import { useEffect, useState } from "react";

// The "Share the link" row. On Android this opens the normal share sheet
// (WhatsApp, SMS, etc.); elsewhere it copies the link.
export function ShareInvite({ code, groupName }: { code: string; groupName: string }) {
  const [link, setLink] = useState(`/join/${code}`);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLink(`${window.location.origin}/join/${code}`);
  }, [code]);

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: groupName, text: `✨ You’re invited to “${groupName}” on Loopin. Tap to join 👇`, url: link });
        return;
      } catch {
        // person closed the share sheet — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", link);
    }
  }

  // A row among "More ways to add people": icon, title, one quiet line, chevron.
  return (
    <button type="button" onClick={share} className="flex min-h-14 w-full items-center gap-3.5 px-4 py-3 text-left active:bg-fg/10" data-share-invite>
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-fg/25 text-fg/75">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{copied ? "Link copied" : "Share the link"}</span>
        <span className="block text-xs text-gray-400">Your phone’s share sheet</span>
      </span>
      <span aria-hidden className="text-fg/55">›</span>
    </button>
  );
}
