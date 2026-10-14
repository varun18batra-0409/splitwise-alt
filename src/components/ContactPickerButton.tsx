"use client";

import { useEffect, useState } from "react";
import type { Person } from "@/lib/names";
import { InviteIcon } from "./icons";

// Opens the phone's own contacts list (with its search box) so people can be
// picked instead of typed. Uses the browser's Contact Picker, available in
// Chrome on Android. Only the contacts you tick are shared with the app —
// it never sees the rest of your address book.

type PickedContact = { name?: string[]; tel?: string[] };
type ContactsManager = {
  select: (props: ("name" | "tel")[], options?: { multiple?: boolean }) => Promise<PickedContact[]>;
};

function contactsApi(): ContactsManager | null {
  if (typeof window === "undefined" || !("ContactsManager" in window)) return null;
  const c = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
  return c && typeof c.select === "function" ? c : null;
}

export function ContactPickerButton({ onPick }: { onPick: (people: Person[]) => void }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => setSupported(contactsApi() !== null), []);

  async function pick() {
    const api = contactsApi();
    if (!api) return;
    setMessage("");
    try {
      const picked = await api.select(["name", "tel"], { multiple: true });
      const people = picked
        .map((c) => {
          const phone = (c.tel?.[0] ?? "").trim();
          const name = (c.name?.[0] ?? "").trim() || phone;
          return { name, phone };
        })
        .filter((p) => p.name);
      if (people.length > 0) onPick(people);
    } catch {
      setMessage("Couldn't open your contacts. You can type names instead.");
    }
  }

  if (supported === null) return null; // still checking
  if (!supported) {
    return (
      <p className="text-xs text-gray-400">
        Picking from your phone’s contacts works in Chrome on Android. Here, type names instead.
      </p>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={pick}
        className="flex w-full items-center justify-center gap-2 border border-line px-4 py-3 text-[15px] font-medium text-fg active:bg-mist"
      >
        <InviteIcon size={18} /> Choose from contacts
      </button>
      {message && <p className="mt-1 text-xs text-red-600">{message}</p>}
    </div>
  );
}
