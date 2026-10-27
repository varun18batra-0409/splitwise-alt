"use client";

import { useEffect, useState } from "react";

// Shows the invite link. On Android this opens the normal share sheet
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
        await navigator.share({ title: groupName, text: `You’re invited to “${groupName}” on Loopin. Tap to join:`, url: link });
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

  return (
    <button type="button" onClick={share} className="block w-full rounded-none border border-line px-4 py-3 text-center text-sm font-semibold text-fg active:bg-mist" data-share-invite>
      {copied ? "Link copied" : "More ways to share"}
    </button>
  );
}
