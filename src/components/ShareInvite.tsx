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
        await navigator.share({ title: groupName, text: `Join "${groupName}" to split expenses`, url: link });
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
    <div className="border border-line bg-white p-4">
      <p className="truncate font-mono text-[13px] text-gray-500">{link.replace(/^https?:\/\//, "")}</p>
      <button
        type="button"
        onClick={share}
        className="pop mt-3 w-full bg-fg px-4 py-3 text-[15px] font-semibold tracking-wide text-canvas"
      >
        {copied ? "Link copied" : "Share invite link"}
      </button>
    </div>
  );
}
