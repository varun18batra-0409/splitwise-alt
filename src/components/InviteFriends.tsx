"use client";

import { useState } from "react";
import { whatsappLink } from "@/lib/whatsapp";

// "Invite friends to Loopin": no group needed. Opens the phone's share sheet
// (WhatsApp, Messages…) with a short note and the link; where there's no share
// sheet, copies it instead. When they sign up, they show up in "Add people" as
// someone already on Loopin.
export function InviteFriends({ name, className = "" }: { name?: string | null; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = `${location.origin}/`;
    const text = `${name ? `${name.split(" ")[0]} here. ` : ""}I use Loopin to split costs with friends: trips, flats, dinners. Free, no ads. Join me:`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Loopin", text, url });
        return;
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.open(whatsappLink(`${text} ${url}`), "_blank", "noopener");
    }
  }
  return (
    <button type="button" onClick={share} className={`lp-press flex w-full items-center gap-3 rounded-2xl border border-line px-4 py-3.5 text-left active:bg-mist ${className}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-owed/15 text-owed" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20c.9-3.4 3.4-5.5 6.5-5.5s5.6 2.1 6.5 5.5M18 8v6M15 11h6" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{copied ? "Link copied. Paste it to a friend" : "Invite friends to Loopin"}</span>
        <span className="block text-xs text-gray-400">No group needed. Share the app on WhatsApp or anywhere.</span>
      </span>
      <span className="text-gray-400" aria-hidden>
        ›
      </span>
    </button>
  );
}
