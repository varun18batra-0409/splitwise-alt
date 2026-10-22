"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { markPaidAction } from "@/app/collect-actions";
import { inputClass, primaryButtonClass } from "./ui";

// The small moving parts of a collection's page.

// Copies a bit of text (the UPI ID), and says so.
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          window.prompt("Copy this", text);
          return;
        }
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
      className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-semibold active:bg-mist"
    >
      {done ? "Copied" : label}
    </button>
  );
}

// "Share link": the phone's share sheet (WhatsApp…), or copy.
export function ShareCollection({ path, title, text, className, children }: { path: string; title: string; text: string; className: string; children: React.ReactNode }) {
  const [link, setLink] = useState(path);
  const [copied, setCopied] = useState(false);
  useEffect(() => setLink(`${window.location.origin}${path}`), [path]);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        if (navigator.share) {
          try {
            await navigator.share({ title, text, url: link });
            return;
          } catch {
            // closed the share sheet: copy instead
          }
        }
        try {
          await navigator.clipboard.writeText(`${text} ${link}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this link", link);
        }
      }}
    >
      {copied ? "Link copied" : children}
    </button>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={primaryButtonClass}>
      {pending ? "Ticking…" : label}
    </button>
  );
}

// "I've paid": pick your name (or add it), and the amount when it's "any amount".
export function PaidForm({ code, due, anyAmount, amountHint }: { code: string; due: { id: string; name: string }[]; anyAmount: boolean; amountHint: string }) {
  const [who, setWho] = useState(due.length ? "" : "new");
  return (
    <form action={markPaidAction} className="space-y-3">
      <input type="hidden" name="code" value={code} />
      {due.length > 0 && (
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-600">I’m</span>
          <select name="entryId" required value={who} onChange={(e) => setWho(e.target.value)} className={inputClass}>
            <option value="" disabled>
              Pick your name
            </option>
            {due.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
            <option value="new">I’m not on the list</option>
          </select>
        </label>
      )}
      {who === "new" && (
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-600">Your name</span>
          <input name="name" required maxLength={40} placeholder="So they know who paid" autoComplete="name" className={inputClass} />
        </label>
      )}
      {anyAmount && (
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-600">I paid</span>
          <input name="amount" required inputMode="decimal" placeholder={amountHint} autoComplete="off" className={`${inputClass} tabular-nums`} />
        </label>
      )}
      <Submit label="I’ve paid ✓" />
    </form>
  );
}

