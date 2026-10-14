"use client";

import { useState } from "react";
import type { Person } from "@/lib/names";
import { ContactPickerButton } from "./ContactPickerButton";
import { inputClass } from "./ui";

// A growing list of people to add: type names, or pick them from the phone's contacts.
// Sends "member" (name) and "memberPhone" fields in the same order.
export function MemberInputs({ firstPlaceholderNumber = 2 }: { firstPlaceholderNumber?: number }) {
  const [rows, setRows] = useState<Person[]>([{ name: "", phone: "" }]);

  function addFromContacts(people: Person[]) {
    setRows((current) => {
      const filled = current.filter((r) => r.name.trim());
      const known = new Set(filled.map((r) => r.name.trim().toLowerCase()));
      const fresh = people.filter((p) => !known.has(p.name.toLowerCase()));
      return [...filled, ...fresh, { name: "", phone: "" }];
    });
  }

  return (
    <div className="space-y-3">
      <ContactPickerButton onPick={addFromContacts} />
      {rows.map((row, i) => (
        <div key={i} className="relative">
          <input
            name="member"
            value={row.name}
            onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            placeholder={`Person ${i + firstPlaceholderNumber}`}
            autoComplete="off"
            className={`${inputClass} ${row.phone ? "pr-36" : ""}`}
          />
          <input type="hidden" name="memberPhone" value={row.phone} />
          {row.phone && (
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-400">
              📱 {row.phone}
            </span>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows((r) => [...r, { name: "", phone: "" }])}
        className="py-1 text-sm font-medium text-accent"
      >
        + Add another person
      </button>
    </div>
  );
}
