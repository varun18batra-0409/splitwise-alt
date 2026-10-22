"use client";

import { useEffect, useRef, useState } from "react";

// "Pick from contacts" for a collection's list (Android Chrome; iPhones don't
// let websites read contacts, so the button only shows where it works).
// Adds the picked names to the form's names box and keeps their numbers in a
// hidden field, so the organiser can WhatsApp each person later. The numbers
// are only ever shown to the organiser.
type Picked = { name?: string[]; tel?: string[] };
type Api = { select: (props: string[], options?: { multiple?: boolean }) => Promise<Picked[]> };
const api = (): Api | null => {
  if (typeof window === "undefined" || !("ContactsManager" in window)) return null;
  const c = (navigator as Navigator & { contacts?: Api }).contacts;
  return c && typeof c.select === "function" ? c : null;
};

export function PickContacts({ namesField = "names", initial = "", className = "" }: { namesField?: string; initial?: string; className?: string }) {
  const [can, setCan] = useState(false);
  const [list, setList] = useState<{ name: string; tel: string }[]>(() => {
    try {
      const v = JSON.parse(initial || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  });
  const [msg, setMsg] = useState("");
  const here = useRef<HTMLSpanElement>(null);
  useEffect(() => setCan(api() !== null), []);

  async function pick() {
    const a = api();
    const box = here.current?.closest("form")?.elements.namedItem(namesField) as HTMLTextAreaElement | null;
    if (!a || !box) return;
    setMsg("");
    try {
      const rows = (await a.select(["name", "tel"], { multiple: true }))
        .map((c) => ({ name: (c.name?.[0] ?? "").trim().slice(0, 40), tel: (c.tel?.[0] ?? "").replace(/[^\d+]/g, "") }))
        .filter((c) => c.name);
      if (!rows.length) return;
      const have = box.value.split(/[\n,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      const add = rows.filter((r) => !have.includes(r.name.toLowerCase())).map((r) => r.name);
      box.value = [box.value.trim(), ...add].filter(Boolean).join("\n");
      setList((l) => [...l, ...rows].slice(-300));
      setMsg(`${rows.length} added${rows.some((r) => r.tel) ? ". You’ll get a WhatsApp button for each of them" : ""}.`);
    } catch {
      setMsg("Couldn’t open your contacts. Allow it, or type the names.");
    }
  }

  return (
    <span ref={here} className={`block ${className}`}>
      <input type="hidden" name="contacts" value={JSON.stringify(list)} />
      {can && (
        <button type="button" onClick={pick} className="inline-flex h-9 items-center gap-2 rounded-full border border-line px-3.5 text-sm font-medium active:bg-mist">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6" />
          </svg>
          Pick from contacts
        </button>
      )}
      {msg && <span className="mt-1.5 block text-xs text-gray-500">{msg}</span>}
    </span>
  );
}
