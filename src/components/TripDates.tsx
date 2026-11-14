"use client";

import { useState } from "react";
import { placeOf, tripRange } from "@/lib/countdown";
import { DateField } from "@/components/DateField";

// "When's the trip?": the start (and end) day, with a nudge to fill them in,
// because the dates are what start the countdown for everyone.
export function TripDates({ name, start = "", end = "", titleClass = "text-sm font-medium text-gray-600" }: { name: string; start?: string; end?: string; titleClass?: string }) {
  const place = placeOf(name.trim()) || "Goa";
  // The end can't be picked before the start (the phone's date picker greys those days out).
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  const bad = Boolean(from && to && to < from);
  return (
    <div id="trip" className="scroll-mt-6">
      <span className={`mb-2 block ${titleClass}`}>When’s the trip?</span>
      <p className="mb-3 rounded-[20px] border border-line bg-white px-3.5 py-2.5 text-[13px] leading-snug text-fg/80">
        Add the dates to <strong className="font-semibold text-fg underline underline-offset-4">start the countdown</strong>. Everyone in the group sees “{place} in 12 days” on their Home screen, and
        gets a fun nudge as the day gets closer. You can change them any time.
      </p>
      <span className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Starts</span>
          <DateField name="tripStart" defaultValue={start} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Ends (if you know)</span>
          <DateField name="tripEnd" defaultValue={end} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-invalid={bad || undefined} />
        </label>
      </span>
      {/* The dates in words, so a phone's dd/mm/yyyy can't be misread. */}
      {from && (
        <p role="status" className={`mt-2 text-[13px] ${bad ? "text-owe" : "text-fg/65"}`}>
          {bad ? "The trip can’t end before it starts." : tripRange(from, to)}
        </p>
      )}
    </div>
  );
}
