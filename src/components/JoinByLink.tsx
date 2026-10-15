"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "Got an invite?" Paste the link (or just the code) a friend sent.
export function JoinByLink() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    const code = /\/join\/([A-Za-z0-9_-]{4,40})/.exec(t)?.[1] ?? (/^[A-Za-z0-9_-]{4,40}$/.test(t) ? t : "");
    if (!code) return setError("Paste the whole invite link your friend sent.");
    router.push(`/join/${code}`);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="block w-full border border-fg/25 px-4 py-3.5 text-center font-semibold text-fg active:bg-fg/5">
        Join with an invite link
      </button>
    );
  }
  return (
    <form onSubmit={go} data-allow-repeat="1" className="space-y-2">
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError("");
        }}
        autoFocus
        inputMode="url"
        placeholder="Paste the invite link"
        aria-label="Invite link"
        className="w-full rounded-xl border border-line bg-mist px-4 py-3 text-base text-fg outline-none placeholder:text-gray-400 focus:border-accent"
      />
      {error && <p className="text-sm text-owe">{error}</p>}
      <button type="submit" className="block w-full border border-fg/25 px-4 py-3 text-center font-semibold text-fg active:bg-fg/5">
        Join
      </button>
    </form>
  );
}
